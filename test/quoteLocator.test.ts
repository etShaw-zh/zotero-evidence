import { assert } from "chai";
import {
  locateQuoteInLines,
  normalizeForMatch,
} from "../src/modules/pdf/quoteLocator";
import type { ExtractedLine } from "../src/modules/pdf/worker/mupdfWorkerEntry";
import type { QuadTuple } from "../src/modules/pdf/worker/mupdfBridge";

// Builds one 10-wide, top-left-frame char quad starting at x, spanning
// [t, b] vertically -- matches the shape mupdfWorkerEntry.ts's walker
// produces (confirmed against the real WASM output in mupdfWorker.test.ts).
function makeChar(x: number, t: number, b: number, c: string) {
  const quad: QuadTuple = [x, t, x + 10, t, x, b, x + 10, b];
  return { c, quad };
}

function makeLine(
  text: string,
  y: [number, number],
  startX = 0,
): ExtractedLine {
  const [t, b] = y;
  const chars = text
    .split("")
    .map((c, i) => makeChar(startX + i * 10, t, b, c));
  return {
    bbox: [startX, t, startX + text.length * 10, b],
    chars,
  };
}

describe("Phase 6 followup: quoteLocator (pure functions)", function () {
  describe("normalizeForMatch", function () {
    it("collapses whitespace runs and lowercases", function () {
      assert.equal(normalizeForMatch("Hello   \n World"), "hello world");
    });

    it("folds curly quotes and en/em dashes to their plain-ASCII equivalent", function () {
      assert.equal(
        normalizeForMatch("“It’s a design—based approach.”"),
        '"it\'s a design-based approach."',
      );
    });
  });

  describe("locateQuoteInLines", function () {
    it("matches an exact substring on a single line", function () {
      const lines = [makeLine("Hello world", [0, 12])];
      const result = locateQuoteInLines(lines, "Hello");
      assert.isNotNull(result);
      assert.equal(result!.length, 1);
      assert.equal(result![0].lineIdx, 0);
      // 5 chars starting at x=0, each 10 wide -> [0, 0, 50, 12]
      assert.deepEqual(result![0].box, { l: 0, t: 0, r: 50, b: 12 });
    });

    it("is case-insensitive", function () {
      const lines = [makeLine("Hello world", [0, 12])];
      const result = locateQuoteInLines(lines, "HELLO");
      assert.isNotNull(result);
    });

    it("tolerates a line-wrap between the quote's words (one box per line)", function () {
      const lines = [makeLine("Hello", [0, 12]), makeLine("world", [12, 24])];
      const result = locateQuoteInLines(lines, "Hello world");
      assert.isNotNull(result);
      assert.equal(result!.length, 2);
      assert.equal(result![0].lineIdx, 0);
      assert.equal(result![1].lineIdx, 1);
    });

    it("tolerates multi-space gaps in the source not present in the quote", function () {
      const lines: ExtractedLine[] = [
        {
          bbox: [0, 0, 200, 12],
          chars: [
            ..."Hello".split("").map((c, i) => makeChar(i * 10, 0, 12, c)),
            makeChar(50, 0, 12, " "),
            makeChar(60, 0, 12, " "),
            makeChar(70, 0, 12, " "),
            ..."world".split("").map((c, i) => makeChar(80 + i * 10, 0, 12, c)),
          ],
        },
      ];
      const result = locateQuoteInLines(lines, "Hello world");
      assert.isNotNull(result);
      assert.equal(result!.length, 1);
    });

    it("returns null when the quote isn't found", function () {
      const lines = [makeLine("Hello world", [0, 12])];
      assert.isNull(locateQuoteInLines(lines, "nonexistent phrase"));
    });

    it("returns null for an empty/whitespace-only quote", function () {
      const lines = [makeLine("Hello world", [0, 12])];
      assert.isNull(locateQuoteInLines(lines, "   "));
      assert.isNull(locateQuoteInLines(lines, ""));
    });

    it("returns null for an empty page", function () {
      assert.isNull(locateQuoteInLines([], "anything"));
    });

    it("matches text extracted with curly quotes against a plain-ASCII AI quote", function () {
      const lines = [makeLine("She said “hello” to the class.", [0, 12])];
      const result = locateQuoteInLines(lines, 'said "hello" to');
      assert.isNotNull(result);
    });

    it("joins a line-break-hyphenated word so a de-hyphenated quote still matches", function () {
      // "informa-" / "tion" -- the PDF's own line-wrap hyphen, not a real
      // character in the word the AI would quote.
      const lines = [makeLine("informa-", [0, 12]), makeLine("tion", [12, 24])];
      const result = locateQuoteInLines(lines, "information");
      assert.isNotNull(result);
      assert.equal(result!.length, 2);
      assert.equal(result![0].lineIdx, 0);
      assert.equal(result![1].lineIdx, 1);
    });

    it("still matches a real hyphenated compound word split across lines with the hyphen kept", function () {
      const lines = [makeLine("design-", [0, 12]), makeLine("based", [12, 24])];
      const result = locateQuoteInLines(lines, "design-based");
      assert.isNotNull(result);
    });
  });
});
