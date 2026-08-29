import { assert } from "chai";
import { cohenKappa, weightedCohenKappa } from "../src/modules/coding/kappa";

describe("Phase 5: Kappa statistics (pure functions)", function () {
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
      // Confusion matrix (rows=AI, cols=Human), Yes/No:
      //            Human=Yes  Human=No
      // AI=Yes         5          1
      // AI=No           2          2
      // N = 10
      // p_o = (5+2)/10 = 0.7
      // row marginals (AI):    Yes=0.6, No=0.4
      // col marginals (Human): Yes=0.7, No=0.3
      // p_e = 0.6*0.7 + 0.4*0.3 = 0.42 + 0.12 = 0.54
      // kappa = (0.7 - 0.54) / (1 - 0.54) = 0.16 / 0.46 = 8/23
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

  describe("weightedCohenKappa", function () {
    it("returns null for an empty input", function () {
      assert.isNull(weightedCohenKappa([]));
    });

    it("returns 1 when every pair uses the same single value", function () {
      const pairs: [number, number][] = [
        [5, 5],
        [5, 5],
      ];
      assert.equal(weightedCohenKappa(pairs), 1);
    });

    it("returns 1 for perfect agreement across multiple values", function () {
      const pairs: [number, number][] = [
        [1, 1],
        [2, 2],
        [3, 3],
      ];
      assert.equal(weightedCohenKappa(pairs), 1);
    });

    it("matches a hand-computed 3-value quadratic-weighted example", function () {
      // Values {1,2,3} -> categories indexed 0,1,2, (k-1)^2 = 4.
      // Quadratic weights w[i][j] = 1 - (i-j)^2/4:
      //        j=0    j=1    j=2
      // i=0    1      0.75   0
      // i=1    0.75   1      0.75
      // i=2    0      0.75   1
      //
      // Pairs (AI, Human): (1,1) (1,2) (2,2) (2,3) (3,3) (3,2), N=6
      // Confusion matrix (rows=AI value, cols=Human value):
      //        H=1  H=2  H=3
      // A=1     1    1    0
      // A=2     0    1    1
      // A=3     0    1    1
      //
      // p_o_w = [1*1 + 0.75*1 + 0 + 0 + 1*1 + 0.75*1 + 0 + 0.75*1 + 1*1] / 6
      //       = [1 + 0.75 + 1 + 0.75 + 0.75 + 1] / 6 = 5.25/6 = 7/8
      // row marginals (AI): [2/6, 2/6, 2/6] = [1/3, 1/3, 1/3]
      // col marginals (Human): [1/6, 3/6, 2/6] = [1/6, 1/2, 1/3]
      // p_e_w = 17/24 (worked out by hand, see kappa.ts test derivation)
      // kappa_w = (7/8 - 17/24) / (1 - 17/24) = (1/6) / (7/24) = 4/7
      const pairs: [number, number][] = [
        [1, 1],
        [1, 2],
        [2, 2],
        [2, 3],
        [3, 3],
        [3, 2],
      ];
      const kappa = weightedCohenKappa(pairs);
      assert.approximately(kappa!, 4 / 7, 1e-9);
    });
  });
});
