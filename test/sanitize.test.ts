import { assert } from "chai";
import { sanitizeDbText } from "../src/utils/sanitize";

describe("Phase 6 followup: sanitizeDbText (pure)", function () {
  it("strips an embedded NUL (built via fromCharCode, never a literal escape)", function () {
    const nul = String.fromCharCode(0);
    assert.equal(sanitizeDbText("a" + nul + "b"), "ab");
  });

  it("strips other C0 control chars but keeps tab/newline/CR", function () {
    const bell = String.fromCharCode(7);
    const vtab = String.fromCharCode(11);
    assert.equal(sanitizeDbText("a" + bell + "b" + vtab + "c"), "abc");
    assert.equal(sanitizeDbText("a\tb\nc\rd"), "a\tb\nc\rd");
  });

  it("leaves ordinary text unchanged", function () {
    assert.equal(
      sanitizeDbText("a randomized controlled trial"),
      "a randomized controlled trial",
    );
  });
});
