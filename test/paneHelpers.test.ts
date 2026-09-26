import { assert } from "chai";
import { escapeHtml, highlightKeywords } from "../src/modules/ui/paneHelpers";

describe("Phase 6 followup: paneHelpers (pure)", function () {
  describe("escapeHtml", function () {
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

  describe("highlightKeywords", function () {
    it("wraps a single matched keyword in <mark>", function () {
      assert.equal(
        highlightKeywords("a randomized controlled trial of X", [
          "controlled trial",
        ]),
        "a randomized <mark>controlled trial</mark> of X",
      );
    });

    it("matches case-insensitively but preserves the source text's own casing", function () {
      assert.equal(
        highlightKeywords("Randomized Controlled Trial", ["controlled trial"]),
        "Randomized <mark>Controlled Trial</mark>",
      );
    });

    it("highlights every occurrence of every keyword", function () {
      assert.equal(
        highlightKeywords("cats and dogs, dogs and cats", ["cats", "dogs"]),
        "<mark>cats</mark> and <mark>dogs</mark>, <mark>dogs</mark> and <mark>cats</mark>",
      );
    });

    it("merges overlapping matches into one <mark> instead of nesting", function () {
      assert.equal(
        highlightKeywords("children aged 6-12 years", [
          "children aged 6-12",
          "6-12 years",
        ]),
        "<mark>children aged 6-12 years</mark>",
      );
    });

    it("falls back to plain escapeHtml when nothing matches, or there are no keywords", function () {
      assert.equal(
        highlightKeywords("p < 0.05 and n > 100", ["not present"]),
        escapeHtml("p < 0.05 and n > 100"),
      );
      assert.equal(
        highlightKeywords("p < 0.05 and n > 100", []),
        escapeHtml("p < 0.05 and n > 100"),
      );
    });

    it("still escapes XML-unsafe characters inside and around a highlighted match", function () {
      // Same XML-document constraint escapeHtml's own tests above document --
      // a raw "&"/"<"/">" here is a hard parse error in this XUL/XML pane,
      // not just an XSS risk, so this must hold even inside a <mark> span.
      assert.equal(
        highlightKeywords("efficacy & safety in n > 100 patients", [
          "efficacy & safety",
        ]),
        "<mark>efficacy &amp; safety</mark> in n &gt; 100 patients",
      );
    });

    it("ignores a blank keyword instead of matching every position", function () {
      assert.equal(
        highlightKeywords("plain text", ["", "  "]),
        escapeHtml("plain text"),
      );
    });
  });
});
