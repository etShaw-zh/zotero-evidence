import { assert } from "chai";
import {
  cohenKappa,
  cohenKappaByCategory,
} from "../src/modules/screening/kappa";

describe("Screening Consistency: Kappa statistics (pure functions)", function () {
  describe("cohenKappa", function () {
    it("returns null for an empty input", function () {
      assert.isNull(cohenKappa([]));
    });

    it("returns 1 for perfect agreement", function () {
      const pairs: [string, string][] = [
        ["A", "A"],
        ["B", "B"],
        ["A", "A"],
        ["B", "B"],
        ["A", "A"],
      ];
      assert.equal(cohenKappa(pairs), 1);
    });

    it("returns 1 when every pair uses a single shared category", function () {
      const pairs: [string, string][] = [
        ["A", "A"],
        ["A", "A"],
        ["A", "A"],
      ];
      assert.equal(cohenKappa(pairs), 1);
    });

    it("matches a hand-computed 2-category confusion matrix", function () {
      // Confusion matrix (rows=AI, cols=Human), Yes/No, N=10:
      // p_o=0.7, p_e=0.54, kappa=(0.7-0.54)/(1-0.54)=8/23.
      const repeat = (pair: [string, string], n: number): [string, string][] =>
        Array.from({ length: n }, () => pair);
      const pairs: [string, string][] = [
        ...repeat(["Yes", "Yes"], 5),
        ...repeat(["Yes", "No"], 1),
        ...repeat(["No", "Yes"], 2),
        ...repeat(["No", "No"], 2),
      ];
      const kappa = cohenKappa(pairs);
      assert.approximately(kappa!, 8 / 23, 1e-9);
    });
  });

  describe("cohenKappaByCategory", function () {
    it("returns an empty array for an empty input", function () {
      assert.deepEqual(cohenKappaByCategory([]), []);
    });

    it("matches a hand-computed 3-category confusion matrix", function () {
      // Confusion matrix (rows=AI, cols=Human), N=12:
      //            H=Include  H=Exclude  H=Unclear
      // A=Include      4          1          0
      // A=Exclude      0          3          1
      // A=Unclear      1          0          2
      const repeat = (pair: [string, string], n: number): [string, string][] =>
        Array.from({ length: n }, () => pair);
      const pairs: [string, string][] = [
        ...repeat(["Include", "Include"], 4),
        ...repeat(["Include", "Exclude"], 1),
        ...repeat(["Exclude", "Exclude"], 3),
        ...repeat(["Exclude", "Unclear"], 1),
        ...repeat(["Unclear", "Include"], 1),
        ...repeat(["Unclear", "Unclear"], 2),
      ];
      const byName = new Map(
        cohenKappaByCategory(pairs).map((c) => [c.category, c]),
      );

      assert.approximately(byName.get("Include")!.kappa!, 23 / 35, 1e-9);
      assert.approximately(
        byName.get("Include")!.observedAgreement,
        5 / 6,
        1e-9,
      );
      assert.approximately(byName.get("Exclude")!.kappa!, 5 / 8, 1e-9);
      assert.approximately(
        byName.get("Exclude")!.observedAgreement,
        5 / 6,
        1e-9,
      );
      assert.approximately(byName.get("Unclear")!.kappa!, 5 / 9, 1e-9);
      assert.approximately(
        byName.get("Unclear")!.observedAgreement,
        5 / 6,
        1e-9,
      );
    });

    it("gives a category kappa of 1 for perfect binary agreement even when overall agreement isn't perfect", function () {
      // AI and Human always agree on whether an item is "A" or not, but
      // disagree with each other whenever it's something else.
      const pairs: [string, string][] = [
        ["A", "A"],
        ["A", "A"],
        ["B", "C"],
        ["C", "B"],
      ];
      const a = cohenKappaByCategory(pairs).find((c) => c.category === "A")!;
      assert.equal(a.kappa, 1);
      assert.equal(a.observedAgreement, 1);
    });
  });
});
