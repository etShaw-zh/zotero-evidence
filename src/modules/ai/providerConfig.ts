import { getPref, setPref } from "../../utils/prefs";
import {
  AI_PROVIDER_PRESETS,
  CUSTOM_PRESET_ID,
  findPresetByBaseURL,
} from "./providerPresets";

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
  /** Max simultaneous in-flight requests a batch run is allowed to make
   * against this provider (FT/Coding/TA batch runners in commands.ts).
   * Per-provider rather than global -- different providers/keys have
   * different rate limits. Optional so providers saved before this field
   * existed still parse; DEFAULT_CONCURRENCY below is the fallback. */
  concurrency?: number;
}

/** Fallback used wherever `provider.concurrency` is missing -- either an
 * older saved provider from before this field existed, or a fresh slot the
 * user hasn't touched the concurrency input on yet. */
export const DEFAULT_PROVIDER_CONCURRENCY = 3;

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

/**
 * One-time, non-destructive recovery for providers saved before the AI
 * Provider Settings dialog was redesigned around 5 fixed provider slots
 * (one per built-in preset id, plus "custom"). Earlier versions stored
 * providers under either the very first hardcoded "default" id, or later
 * an arbitrary generated id per saved configuration -- none of those match
 * the fixed ids the current dialog looks up by, so an existing saved
 * provider became invisible to (though not deleted by) the redesigned UI.
 *
 * Maps each such orphaned entry onto a fixed slot by matching its baseURL
 * back to a known preset (falling back to "custom"), skips a slot that
 * already has a real config (never clobbers something the user has
 * already set up post-redesign), and re-points activeProviderId at the
 * new slot id if the orphaned entry was the active one. The original
 * orphaned entries are left in place rather than deleted, in case the
 * baseURL-based guess picked the wrong slot -- call this before reading
 * providers anywhere the redesigned dialog's 5-slot assumption matters.
 */
export function migrateLegacyProviders(): void {
  const knownIds = new Set<string>([
    ...AI_PROVIDER_PRESETS.map((p) => p.id),
    CUSTOM_PRESET_ID,
  ]);
  const providers = readProviders();
  const legacy = providers.filter((p) => !knownIds.has(p.id));
  if (legacy.length === 0) return;

  const activeId = getPref("activeProviderId");
  const migratedTargets = new Set<string>();
  for (const old of legacy) {
    const targetId = findPresetByBaseURL(old.baseURL);
    if (migratedTargets.has(targetId)) continue;
    if (providers.some((p) => p.id === targetId)) continue;
    upsertProvider({ ...old, id: targetId });
    migratedTargets.add(targetId);
    if (activeId === old.id) setActiveProviderId(targetId);
  }
}
