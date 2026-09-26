import { assert } from "chai";
import { escapeHtml } from "../src/modules/ui/paneHelpers";

describe("Phase 6 followup: escapeHtml (pure)", function () {
  it("escapes &, <, and > so the result is safe to assign to innerHTML in an XML document", function () {
    // Regression: Zotero's item pane is a XUL/XML document, not a regular
    // HTML page -- assigning .innerHTML with a raw "&" (e.g. from a
    // Codebook variable name like "... iteration & re-conjecturing") is a
    // hard XML parse error there (DOMException: InvalidCharacterError),
    // not just an XSS risk like it would be on a web page.
    assert.equal(
      escapeHtml("B04 / QA4 -- Evidence-driven iteration & re-conjecturing"),
      "B04 / QA4 -- Evidence-driven iteration &amp; re-conjecturing",
    );
  });

  it("escapes < and >", function () {
    assert.equal(
      escapeHtml("p < 0.05 and n > 100"),
      "p &lt; 0.05 and n &gt; 100",
    );
  });

  it("leaves ordinary text unchanged", function () {
    assert.equal(
      escapeHtml("a randomized controlled trial"),
      "a randomized controlled trial",
    );
  });

  it("does not double-escape an already-escaped ampersand sequence", function () {
    // Documents current behavior: escapeHtml is meant to be applied once,
    // to raw source text, not to text that may already contain entities.
    assert.equal(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
  });
});
