/**
 * Built-in AI provider presets for the AI Provider Settings dialog
 * (commands.ts:aiProviderDialog). Every endpoint here is an OpenAI-
 * compatible chat/completions URL -- matches the single-shape assumption
 * documented in providerConfig.ts. `docsURL` points at each provider's own
 * API documentation (not a specific API-key page, since deep dashboard
 * links move around -- docs pages are stable and explain key creation too).
 *
 * "Custom" isn't listed here (it's not a real provider) -- the dialog
 * offers it as a separate, always-available option alongside these that
 * leaves baseURL blank for the user to fill in by hand, which is what
 * makes local OpenAI-compatible servers (Ollama, LM Studio, ...) work.
 */
export interface AIProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  docsURL: string;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1/chat/completions",
    docsURL: "https://platform.openai.com/docs/api-reference",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1/chat/completions",
    docsURL: "https://api-docs.deepseek.com/",
  },
  {
    id: "zhipu",
    name: "智谱 GLM (Zhipu)",
    baseURL: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    docsURL: "https://docs.bigmodel.cn/cn/api/introduction",
  },
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    baseURL: "https://api.moonshot.cn/v1/chat/completions",
    docsURL: "https://platform.kimi.com/docs/api/chat",
  },
];

export const CUSTOM_PRESET_ID = "custom";

export function findPresetById(id: string): AIProviderPreset | null {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id) ?? null;
}

/** Reverse lookup: match a stored provider's baseURL back to a known
 * preset id, falling back to "custom" for anything that doesn't match one
 * exactly. Used by providerConfig.ts's migrateLegacyProviders() to map a
 * pre-redesign saved provider (an arbitrary generated id, or the very
 * first "default") onto one of the 5 fixed provider slots the current
 * dialog understands. */
export function findPresetByBaseURL(baseURL: string): string {
  const match = AI_PROVIDER_PRESETS.find((p) => p.baseURL === baseURL);
  return match ? match.id : CUSTOM_PRESET_ID;
}
