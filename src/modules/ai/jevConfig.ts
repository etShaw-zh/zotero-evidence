import { getPref, setPref } from "../../utils/prefs";

// JEV (jev-1.13, served via aihubmix's /v1/systemone structured-decision
// endpoint) is a fixed, single, non-chat model -- deliberately NOT folded
// into providerConfig.ts's multi-slot AIProviderConfig system (DeepSeek,
// Zhipu, ...), which assumes every provider speaks the OpenAI chat/
// completions shape (see aiClient.ts's callChatCompletion). One config,
// stored under its own pref rather than as another provider slot.
export interface JevConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_JEV_ENDPOINT = "https://aihubmix.com/v1/systemone";
export const DEFAULT_JEV_MODEL = "jev-1.13";

export function getJevConfig(): JevConfig {
  const raw = getPref("jevConfig");
  let parsed: Partial<JevConfig> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  return {
    endpoint: parsed.endpoint || DEFAULT_JEV_ENDPOINT,
    apiKey: parsed.apiKey || "",
    model: parsed.model || DEFAULT_JEV_MODEL,
  };
}

export function setJevConfig(config: JevConfig): void {
  setPref("jevConfig", JSON.stringify(config));
}

/** Only the API key is required for a usable config -- endpoint and model
 * both have sane defaults already applied by getJevConfig(). */
export function isJevConfigured(config: JevConfig = getJevConfig()): boolean {
  return !!config.apiKey;
}
