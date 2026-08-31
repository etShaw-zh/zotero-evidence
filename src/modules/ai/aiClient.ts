import { AIProviderConfig } from "./providerConfig";
import {
  AIUsagePurpose,
  parseUsageFromResponse,
  recordAIUsage,
} from "./usageService";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Single non-streaming chat completion call against an OpenAI-compatible
 * endpoint. TA-Screening only needs one finished JSON answer per item, so
 * there's no need for SSE/streaming handling here.
 *
 * `purpose` tags which feature made the call, purely for the AI Usage
 * Statistics dialog's breakdown -- it never affects the request itself.
 * Every call site (TA/FT-Screening, Coding, Synthesis) goes through this one
 * function, so it's the single place usage gets recorded rather than each
 * of the four call sites doing it themselves.
 */
export async function callChatCompletion(
  provider: AIProviderConfig,
  messages: ChatMessage[],
  purpose: AIUsagePurpose,
): Promise<string> {
  const xhr = await Zotero.HTTP.request("POST", provider.baseURL, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0,
    }),
    responseType: "json",
    // FT-Screening and Coding send full-text prompts (up to 40k chars) that
    // can take slow models well past a minute to answer -- 60s was cutting
    // those off before they finished.
    timeout: 300000,
  });

  const data = xhr.response as any;
  // Record even on a malformed response below (missing `content`) -- a call
  // that billed tokens but returned something this plugin couldn't parse
  // still happened and should count. Awaited (not fire-and-forget) so the
  // row is guaranteed written before this resolves -- there's no urgency to
  // beat here, the network call itself already dominates latency.
  await recordAIUsage(provider, purpose, parseUsageFromResponse(data));

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      "AI provider response did not contain choices[0].message.content",
    );
  }
  return content;
}
