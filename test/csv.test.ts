import { assert } from "chai";
import { escapeCsvField, toCsvLine } from "../src/utils/csv";

describe("Phase 6: csv utils (pure functions)", function () {
  describe("escapeCsvField", function () {
    it("leaves plain fields unquoted", function () {
      assert.equal(escapeCsvField("plain"), "plain");
      assert.equal(escapeCsvField(""), "");
    });

    it("quotes fields containing a comma", function () {
      assert.equal(escapeCsvField("a,b"), '"a,b"');
    });

    it("quotes and doubles embedded quotes", function () {
      assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
    });

    it("quotes fields containing a newline", function () {
      assert.equal(escapeCsvField("line1\nline2"), '"line1\nline2"');
    });
  });

  describe("toCsvLine", function () {
    it("joins fields with commas, escaping as needed", function () {
      assert.equal(toCsvLine(["a", "b,c", 'd"e', 3]), 'a,"b,c","d""e",3');
    });
  });
});
