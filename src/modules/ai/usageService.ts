import { databaseService } from "../db/database";
import { AIProviderConfig } from "./providerConfig";

// Matches every call site of callChatCompletion() (aiClient.ts) -- kept as a
// plain string union rather than an enum so a new feature can add its own
// tag without touching this file.
export type AIUsagePurpose =
  | "ta_screening"
  | "ft_screening"
  | "coding"
  | "synthesis"
  | "connection_test";

export interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Pulls the OpenAI-compatible `usage` block out of a parsed chat/completions
 * response. Pure and HTTP-free on purpose (see aiClient.ts's own comment on
 * why callChatCompletion itself isn't unit-testable without a live network
 * call) so recording/aggregation logic can be tested without mocking
 * Zotero.HTTP. Returns null rather than zeros when a provider omits `usage`
 * entirely (some OpenAI-compatible endpoints do) -- recordAIUsage() then
 * still logs the call itself, just with zeroed token counts, instead of
 * silently dropping it from the call-count stats too.
 */
export function parseUsageFromResponse(data: unknown): ParsedUsage | null {
  const usage = (data as any)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = Number(usage.prompt_tokens) || 0;
  const completionTokens = Number(usage.completion_tokens) || 0;
  const totalTokens =
    Number(usage.total_tokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Records one callChatCompletion() call. provider fields are snapshotted
 * (see schema.ts's comment on ai_usage_log) rather than joined live, so
 * history survives the provider being renamed or deleted later.
 */
export async function recordAIUsage(
  provider: AIProviderConfig,
  purpose: AIUsagePurpose,
  usage: ParsedUsage | null,
): Promise<void> {
  await databaseService.init();
  await databaseService.queryAsync(
    `INSERT INTO ai_usage_log
      (created_at, provider_id, provider_name, model, purpose, prompt_tokens, completion_tokens, total_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      provider.id,
      provider.name,
      provider.model,
      purpose,
      usage?.promptTokens ?? 0,
      usage?.completionTokens ?? 0,
      usage?.totalTokens ?? 0,
    ],
  );
}

export interface AIUsageRow {
  purpose: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIUsageStats {
  byPurpose: AIUsageRow[];
  total: AIUsageRow;
}

function rowToUsageRow(row: any, purpose: string): AIUsageRow {
  return {
    purpose,
    calls: Number(row.calls) || 0,
    promptTokens: Number(row.prompt_tokens) || 0,
    completionTokens: Number(row.completion_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
  };
}

/**
 * Lifetime call-count and token-usage totals, overall and broken down by
 * feature (purpose). Used by the "AI Usage Statistics" dialog
 * (commands.ts).
 */
export async function getAIUsageStats(): Promise<AIUsageStats> {
  await databaseService.init();
  const byPurposeRows = (await databaseService.queryAsync(
    `SELECT purpose,
            COUNT(*) AS calls,
            SUM(prompt_tokens) AS prompt_tokens,
            SUM(completion_tokens) AS completion_tokens,
            SUM(total_tokens) AS total_tokens
     FROM ai_usage_log
     GROUP BY purpose
     ORDER BY purpose`,
  )) as any[];
  const totalRows = (await databaseService.queryAsync(
    `SELECT COUNT(*) AS calls,
            SUM(prompt_tokens) AS prompt_tokens,
            SUM(completion_tokens) AS completion_tokens,
            SUM(total_tokens) AS total_tokens
     FROM ai_usage_log`,
  )) as any[];
  return {
    byPurpose: (byPurposeRows || []).map((r) => rowToUsageRow(r, r.purpose)),
    total: rowToUsageRow((totalRows && totalRows[0]) || {}, "total"),
  };
}
