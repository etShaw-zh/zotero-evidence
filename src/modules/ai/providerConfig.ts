import { getPref, setPref } from "../../utils/prefs";

// DeepSeek, Zhipu (智谱), and OpenAI itself all expose an OpenAI-compatible
// chat/completions endpoint, so a single provider shape covers "default" and
// "custom" providers alike -- no per-vendor adapters needed (REQUIREMENTS.md
// 5.2: support default + custom LLM APIs).
export interface AIProviderConfig {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

function readProviders(): AIProviderConfig[] {
  const raw = getPref("aiProviders");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProviders(providers: AIProviderConfig[]): void {
  setPref("aiProviders", JSON.stringify(providers));
}

export function listProviders(): AIProviderConfig[] {
  return readProviders();
}

export function upsertProvider(provider: AIProviderConfig): void {
  const providers = readProviders();
  const index = providers.findIndex((p) => p.id === provider.id);
  if (index >= 0) providers[index] = provider;
  else providers.push(provider);
  writeProviders(providers);
}

export function deleteProvider(id: string): void {
  writeProviders(readProviders().filter((p) => p.id !== id));
  if (getPref("activeProviderId") === id) {
    setPref("activeProviderId", "");
  }
}

export function getActiveProvider(): AIProviderConfig | null {
  const activeId = getPref("activeProviderId");
  const providers = readProviders();
  if (activeId) {
    const match = providers.find((p) => p.id === activeId);
    if (match) return match;
  }
  return providers[0] ?? null;
}

export function setActiveProviderId(id: string): void {
  setPref("activeProviderId", id);
}
