import { AIProviderConfig } from "./providerConfig";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Single non-streaming chat completion call against an OpenAI-compatible
 * endpoint. TA-Screening only needs one finished JSON answer per item, so
 * there's no need for SSE/streaming handling here.
 */
export async function callChatCompletion(
  provider: AIProviderConfig,
  messages: ChatMessage[],
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
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      "AI provider response did not contain choices[0].message.content",
    );
  }
  return content;
}
