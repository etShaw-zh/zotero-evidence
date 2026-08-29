import { assert } from "chai";
import {
  buildSortIndex,
  topLeftBoxToZoteroRect,
} from "../src/modules/pdf/annotationGeometry";
import type { MupdfPageGeometry } from "../src/modules/pdf/worker/mupdfBridge";

describe("Phase 6 followup: annotationGeometry (pure functions)", function () {
  const bbox = { l: 100, t: 50, r: 200, b: 70 };
  const baseGeometry: Omit<MupdfPageGeometry, "rotation"> = {
    viewBox: [0, 0, 612, 792],
    width: 612,
    height: 792,
  };

  describe("topLeftBoxToZoteroRect", function () {
    it("rotation 0: [l, height-b, r, height-t]", function () {
      const rect = topLeftBoxToZoteroRect(bbox, {
        ...baseGeometry,
        rotation: 0,
      });
      assert.deepEqual(rect, [100, 722, 200, 742]);
    });

    it("rotation 90", function () {
      const rect = topLeftBoxToZoteroRect(bbox, {
        ...baseGeometry,
        rotation: 90,
      });
      assert.deepEqual(rect, [50, 100, 70, 200]);
    });

    it("rotation 180", function () {
      const rect = topLeftBoxToZoteroRect(bbox, {
        ...baseGeometry,
        rotation: 180,
      });
      assert.deepEqual(rect, [412, 50, 512, 70]);
    });

    it("rotation 270", function () {
      const rect = topLeftBoxToZoteroRect(bbox, {
        ...baseGeometry,
        rotation: 270,
      });
      assert.deepEqual(rect, [542, 592, 562, 692]);
    });

    it("respects a non-zero viewBox origin", function () {
      const geometry: MupdfPageGeometry = {
        viewBox: [10, 20, 622, 812],
        width: 612,
        height: 792,
        rotation: 0,
      };
      const rect = topLeftBoxToZoteroRect(bbox, geometry);
      assert.deepEqual(rect, [110, 742, 210, 762]);
    });
  });

  describe("buildSortIndex", function () {
    it("matches Zotero's required page|offset|top format", function () {
      const index = buildSortIndex(
        2,
        { ...baseGeometry, rotation: 0 },
        [100, 722, 200, 742],
      );
      assert.match(index, /^\d{5}\|\d{6}\|\d{5}$/);
      assert.equal(index, "00002|000050|00050");
    });

    it("clamps negative/out-of-range inputs instead of producing malformed output", function () {
      const index = buildSortIndex(
        -5,
        { ...baseGeometry, rotation: 0 },
        [0, -100000, 0, -100000],
      );
      assert.match(index, /^\d{5}\|\d{6}\|\d{5}$/);
    });
  });
});
