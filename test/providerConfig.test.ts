import { assert } from "chai";
import {
  AIProviderConfig,
  deleteProvider,
  getActiveProvider,
  listProviders,
  migrateLegacyProviders,
  setActiveProviderId,
  upsertProvider,
} from "../src/modules/ai/providerConfig";

// migrateLegacyProviders() is only additive/non-destructive by design (see
// its own doc comment) -- it never deletes the original entry, only ever
// upserts a NEW one under a fixed slot id if that slot is still empty. So
// every test here cleans up every id it might have touched, both the
// legacy id it seeded AND the fixed slot id migration may have created.
// Every fixed slot id migration can ever write to, not just the ones an
// individual test below happens to target directly -- omitting any of
// these here previously leaked a migrated row (e.g. "zhipu", from the
// "re-points activeProviderId" test) into unrelated tests elsewhere in the
// suite that assume no provider is configured at all.
const ALL_TEST_IDS = [
  "default",
  "legacy-random-1",
  "legacy-random-2",
  "openai",
  "deepseek",
  "zhipu",
  "moonshot",
  "custom",
];

function cleanup() {
  for (const id of ALL_TEST_IDS) deleteProvider(id);
}

describe("providerConfig: migrateLegacyProviders (project + DB)", function () {
  this.timeout(30000);

  afterEach(cleanup);

  it("maps a legacy 'default'-id provider onto its matching preset's fixed slot id", async function () {
    cleanup();
    upsertProvider({
      id: "default",
      name: "My DeepSeek",
      baseURL: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "sk-legacy",
      model: "deepseek-chat",
    });

    migrateLegacyProviders();

    const migrated = listProviders().find((p) => p.id === "deepseek");
    assert.isDefined(migrated);
    assert.equal(migrated!.apiKey, "sk-legacy");
    assert.equal(migrated!.model, "deepseek-chat");
    // Non-destructive: the original legacy row is untouched, not deleted.
    assert.isDefined(listProviders().find((p) => p.id === "default"));
  });

  it("maps a legacy random-id provider with an unrecognized baseURL onto 'custom'", async function () {
    cleanup();
    upsertProvider({
      id: "legacy-random-1",
      name: "My Local Model",
      baseURL: "http://localhost:11434/v1/chat/completions",
      apiKey: "",
      model: "llama3",
    });

    migrateLegacyProviders();

    const migrated = listProviders().find((p) => p.id === "custom");
    assert.isDefined(migrated);
    assert.equal(
      migrated!.baseURL,
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("never overwrites a slot that already has a real (post-redesign) config", async function () {
    cleanup();
    upsertProvider({
      id: "deepseek",
      name: "DeepSeek",
      apiKey: "sk-current",
      baseURL: "https://api.deepseek.com/v1/chat/completions",
      model: "deepseek-chat",
    });
    upsertProvider({
      id: "default",
      name: "Old DeepSeek",
      baseURL: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "sk-old-and-stale",
      model: "deepseek-chat",
    });

    migrateLegacyProviders();

    const deepseek = listProviders().find((p) => p.id === "deepseek");
    assert.equal(deepseek!.apiKey, "sk-current");
  });

  it("only migrates one legacy entry per target slot even if several map to the same preset", async function () {
    cleanup();
    upsertProvider({
      id: "legacy-random-1",
      name: "First",
      baseURL: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk-first",
      model: "gpt-4o-mini",
    });
    upsertProvider({
      id: "legacy-random-2",
      name: "Second",
      baseURL: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk-second",
      model: "gpt-4o",
    });

    migrateLegacyProviders();

    const matches = listProviders().filter((p) => p.id === "openai");
    assert.equal(matches.length, 1);
  });

  it("re-points activeProviderId at the new slot id when the migrated entry was active", async function () {
    cleanup();
    const legacy: AIProviderConfig = {
      id: "default",
      name: "Old Default",
      baseURL: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKey: "sk-zhipu",
      model: "glm-4",
    };
    upsertProvider(legacy);
    setActiveProviderId("default");

    migrateLegacyProviders();

    assert.equal(getActiveProvider()?.id, "zhipu");
  });

  it("no-ops cleanly when every stored provider already uses a known fixed slot id", async function () {
    cleanup();
    upsertProvider({
      id: "openai",
      name: "OpenAI",
      baseURL: "https://api.openai.com/v1/chat/completions",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });
    // Compare before/after rather than asserting an absolute count -- this
    // test suite shares one real Zotero profile across every test file, so
    // other tests' own providers may legitimately coexist here.
    const before = listProviders().length;

    migrateLegacyProviders();

    assert.equal(listProviders().length, before);
    const openai = listProviders().find((p) => p.id === "openai");
    assert.equal(openai?.apiKey, "sk-x");
  });
});
