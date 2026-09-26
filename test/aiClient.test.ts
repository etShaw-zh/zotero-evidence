import { assert } from "chai";
import { extractProviderErrorMessage } from "../src/modules/ai/aiClient";

// Regression coverage for surfacing a readable error to the user when an AI
// provider call fails, instead of a bare "AI provider response did not
// contain choices[0].message.content" (2xx-but-no-content) or "Unexpected
// status code NNN" (non-2xx -- see aiClient.ts's callChatCompletion catch
// block, which reads e.xmlhttp.response through this same function). Every
// built-in preset (OpenAI, DeepSeek, Zhipu GLM, Moonshot/Kimi) and
// effectively every other OpenAI-compatible server reports failures as
// `{"error": {"message": "..."}}` -- Zhipu's example that prompted this:
// {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}
describe("aiClient: extractProviderErrorMessage (pure)", function () {
  it("reads error.message from an OpenAI-shaped error body", function () {
    assert.equal(
      extractProviderErrorMessage({
        error: {
          message: "Incorrect API key provided",
          type: "invalid_request_error",
        },
      }),
      "Incorrect API key provided",
    );
  });

  it("reads error.message from Zhipu's {code, message} error shape", function () {
    assert.equal(
      extractProviderErrorMessage({
        error: { code: "1113", message: "余额不足或无可用资源包,请充值。" },
      }),
      "余额不足或无可用资源包,请充值。",
    );
  });

  it("returns null for a successful completion body (no error field)", function () {
    assert.isNull(
      extractProviderErrorMessage({
        choices: [{ message: { content: "hello" } }],
      }),
    );
  });

  it("returns null for bodies that don't look like the expected shape", function () {
    assert.isNull(extractProviderErrorMessage(null));
    assert.isNull(extractProviderErrorMessage(undefined));
    assert.isNull(extractProviderErrorMessage("not json"));
    assert.isNull(
      extractProviderErrorMessage({ error: "a plain string, not {message}" }),
    );
    assert.isNull(extractProviderErrorMessage({ error: { message: "" } }));
    assert.isNull(extractProviderErrorMessage({ error: { message: 42 } }));
  });
});
