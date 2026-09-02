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
 * Every built-in preset (OpenAI, DeepSeek, Zhipu GLM, Moonshot/Kimi) and
 * virtually every other OpenAI-compatible server reports a failure as JSON
 * shaped `{"error": {"message": "...", ...}}` -- Zhipu additionally nests a
 * numeric `code` (e.g. 1113 for insufficient balance) alongside it, but
 * `message` is the one field common to all of them and already
 * human-readable (often in the provider's own language, as with Zhipu's
 * Chinese messages). Returns null when the body doesn't look like that
 * shape, so callers can fall back to something generic instead of quoting
 * `undefined`.
 */
export function extractProviderErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const message = (body as any)?.error?.message;
  return typeof message === "string" && message ? message : null;
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
  let xhr: any;
  try {
    xhr = await Zotero.HTTP.request("POST", provider.baseURL, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      // No `temperature` here -- it used to be hardcoded to 0 for more
      // deterministic screening decisions, but that's not universal across
      // OpenAI-compatible providers: some Moonshot/Kimi models reject
      // anything other than 1 outright ("invalid temperature: only 1 is
      // allowed for this model"), and the plugin has no reliable way to know
      // a given model's accepted range up front. Every AI suggestion here
      // already requires human confirmation before it counts for anything
      // (screening decisions, coding records, ...), so losing perfect
      // determinism is an acceptable tradeoff for actually working across
      // providers -- letting each provider apply its own default is safer
      // than guessing a single fixed value that's wrong for some of them.
      body: JSON.stringify({
        model: provider.model,
        messages,
      }),
      responseType: "json",
      // FT-Screening and Coding send full-text prompts (up to 40k chars) that
      // can take slow models well past a minute to answer -- 60s was cutting
      // those off before they finished.
      timeout: 300000,
      // Zotero.HTTP.request retries any 429/5xx response on its own, with
      // exponential backoff, for up to an HOUR by default -- fine for
      // Zotero's own (idempotent, internal) API calls, but wrong here: a
      // paid third-party provider's non-2xx status (insufficient balance,
      // bad key, a real rate limit) is not transient, and this is a
      // foreground call the user is actively waiting on (Test Connection,
      // Run AI, ...) with no progress indication during a silent retry
      // wait. Fail fast and let the caller's catch block above show the
      // real reason instead of leaving the UI stuck on "Testing..."/
      // "Loading..." for minutes with nothing happening.
      errorDelayMax: 0,
    });
  } catch (e: any) {
    // Zotero.HTTP.UnexpectedStatusException on any non-2xx response (wrong
    // API key, insufficient balance, rate limit, ...). Its own .message is
    // just "Unexpected status code NNN in response to POST ..." with no
    // detail: Zotero.HTTP only appends the raw body for a text/unset
    // responseType, and reading .responseText while responseType is "json"
    // throws -- so it deliberately leaves it out here. The already-parsed
    // body is still available on e.xmlhttp.response though, and that's
    // where the actually-useful reason lives.
    const providerMessage = extractProviderErrorMessage(e?.xmlhttp?.response);
    if (providerMessage) {
      throw new Error(
        `${provider.name} (HTTP ${e.status}): ${providerMessage}`,
      );
    }
    throw e;
  }

  const data = xhr.response as any;
  // Record even on a malformed response below (missing `content`) -- a call
  // that billed tokens but returned something this plugin couldn't parse
  // still happened and should count. Awaited (not fire-and-forget) so the
  // row is guaranteed written before this resolves -- there's no urgency to
  // beat here, the network call itself already dominates latency.
  await recordAIUsage(provider, purpose, parseUsageFromResponse(data));

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    // A 2xx response that still isn't a real completion -- some providers
    // report failures (content filtered, model overloaded, ...) this way
    // instead of a non-2xx status.
    const providerMessage = extractProviderErrorMessage(data);
    throw new Error(
      providerMessage
        ? `${provider.name}: ${providerMessage}`
        : "AI provider response did not contain choices[0].message.content",
    );
  }
  return content;
}
