import { assert } from "chai";
import { AIProviderConfig } from "../src/modules/ai/providerConfig";
import {
  getAIUsageStats,
  parseUsageFromResponse,
  recordAIUsage,
} from "../src/modules/ai/usageService";
import { databaseService } from "../src/modules/db/database";

const PROVIDER: AIProviderConfig = {
  id: "test-provider",
  name: "Test Provider",
  baseURL: "http://127.0.0.1:1/unused",
  apiKey: "test",
  model: "test-model",
};

describe("AI usage tracking", function () {
  this.timeout(20000);

  it("parseUsageFromResponse reads the OpenAI-compatible usage block, and returns null when absent", function () {
    const usage = parseUsageFromResponse({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    assert.deepEqual(usage, {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    assert.isNull(parseUsageFromResponse({ choices: [] }));
    assert.isNull(parseUsageFromResponse(null));
  });

  it("parseUsageFromResponse falls back to prompt+completion when total_tokens is missing", function () {
    const usage = parseUsageFromResponse({
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    assert.deepEqual(usage, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("getAIUsageStats aggregates recorded calls by purpose and reports a grand total", async function () {
    await databaseService.init();
    // Isolate from any rows a previous test run in this same DB may have
    // left behind, so the counts below are deterministic.
    await databaseService.queryAsync(`DELETE FROM ai_usage_log`);

    await recordAIUsage(PROVIDER, "ta_screening", {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    });
    await recordAIUsage(PROVIDER, "ta_screening", {
      promptTokens: 200,
      completionTokens: 40,
      totalTokens: 240,
    });
    await recordAIUsage(PROVIDER, "coding", {
      promptTokens: 500,
      completionTokens: 100,
      totalTokens: 600,
    });
    // A call whose response had no `usage` block still counts as a call.
    await recordAIUsage(PROVIDER, "synthesis", null);

    const stats = await getAIUsageStats();

    const ta = stats.byPurpose.find((r) => r.purpose === "ta_screening");
    assert.isDefined(ta);
    assert.equal(ta!.calls, 2);
    assert.equal(ta!.promptTokens, 300);
    assert.equal(ta!.completionTokens, 60);
    assert.equal(ta!.totalTokens, 360);

    const coding = stats.byPurpose.find((r) => r.purpose === "coding");
    assert.isDefined(coding);
    assert.equal(coding!.calls, 1);
    assert.equal(coding!.totalTokens, 600);

    const synthesis = stats.byPurpose.find((r) => r.purpose === "synthesis");
    assert.isDefined(synthesis);
    assert.equal(synthesis!.calls, 1);
    assert.equal(synthesis!.totalTokens, 0);

    assert.equal(stats.total.calls, 4);
    assert.equal(stats.total.promptTokens, 800);
    assert.equal(stats.total.completionTokens, 160);
    assert.equal(stats.total.totalTokens, 960);
  });
});
