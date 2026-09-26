import { extractProviderErrorMessage } from "./aiClient";

/**
 * Derives an OpenAI-compatible `/models` listing URL from a stored
 * chat/completions URL (AIProviderConfig.baseURL is the FULL completions
 * endpoint, e.g. "https://api.openai.com/v1/chat/completions" -- see
 * providerConfig.ts and aiClient.ts) by swapping the trailing
 * "/chat/completions" for "/models". Every built-in preset (and most
 * OpenAI-compatible local servers) follows this convention.
 */
export function deriveModelsURL(chatCompletionsURL: string): string | null {
  const trimmed = chatCompletionsURL.trim().replace(/\/+$/, "");
  if (!/\/chat\/completions$/.test(trimmed)) return null;
  return trimmed.replace(/\/chat\/completions$/, "/models");
}

/**
 * Lists available model ids from a provider's `/models` endpoint. Used by
 * the AI Provider Settings dialog's "fetch models" button -- a convenience,
 * not a requirement, so any failure (network error, provider doesn't
 * support listing, bad key) should be caught by the caller and shown
 * inline rather than blocking manual model entry.
 */
export async function fetchAvailableModels(
  baseURL: string,
  apiKey: string,
): Promise<string[]> {
  const modelsURL = deriveModelsURL(baseURL);
  if (!modelsURL) {
    throw new Error(
      "Could not derive a /models URL from this base URL (expected it to end with /chat/completions).",
    );
  }
  let xhr: any;
  try {
    xhr = await Zotero.HTTP.request("GET", modelsURL, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      responseType: "json",
      timeout: 30000,
      // See aiClient.ts's callChatCompletion for why: without this,
      // Zotero.HTTP.request silently retries a non-2xx response (backoff up
      // to an hour by default) instead of failing fast for this
      // foreground, user-initiated "Fetch Models" call.
      errorDelayMax: 0,
    });
  } catch (e: any) {
    // Same reasoning as aiClient.ts's callChatCompletion: a non-2xx status
    // (bad key, insufficient balance, ...) throws Zotero.HTTP.
    // UnexpectedStatusException with no body detail in its own .message
    // when responseType is "json" -- read the provider's own error.message
    // off the parsed body instead of surfacing a bare "Unexpected status
    // code NNN".
    const providerMessage = extractProviderErrorMessage(e?.xmlhttp?.response);
    if (providerMessage) throw new Error(providerMessage);
    throw e;
  }
  const list = (xhr.response as any)?.data;
  if (!Array.isArray(list)) {
    throw new Error(
      "Unexpected response shape from /models (no data[] array).",
    );
  }
  return list
    .map((m: any) => (typeof m?.id === "string" ? m.id : null))
    .filter((id: string | null): id is string => !!id)
    .sort();
}
