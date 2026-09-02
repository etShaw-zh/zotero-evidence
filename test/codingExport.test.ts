import { assert } from "chai";
import { saveCodebook } from "../src/modules/coding/codebookService";
import { addManualRecord } from "../src/modules/coding/codingService";
import {
  exportCodingData,
  expandRecordsToRows,
} from "../src/modules/export/codingExport";
import { createProject } from "../src/modules/project/projectManager";

describe("Phase 6: codingExport", function () {
  this.timeout(30000);

  describe("expandRecordsToRows (pure)", function () {
    it("matches the REQUIREMENTS 2.6.4 example: one multi-value variable expands to 2 rows, others repeat", function () {
      const variableNames = [
        "study_design",
        "sample_size",
        "population",
        "intervention",
        "outcome",
        "main_findings",
      ];
      const valuesByVariable = new Map<string, string[]>([
        ["study_design", ["RCT"]],
        ["sample_size", ["156"]],
        ["population", ["Adults 18-65"]],
        ["intervention", ["Intervention X"]],
        ["outcome", ["Outcome Y1", "Outcome Y2"]],
        ["main_findings", ["Finding Z1"]],
      ]);

      const rows = expandRecordsToRows(variableNames, valuesByVariable);
      assert.deepEqual(rows, [
        [
          "RCT",
          "156",
          "Adults 18-65",
          "Intervention X",
          "Outcome Y1",
          "Finding Z1",
        ],
        [
          "RCT",
          "156",
          "Adults 18-65",
          "Intervention X",
          "Outcome Y2",
          "Finding Z1",
        ],
      ]);
    });

    it("produces exactly one row when every variable is single-valued", function () {
      const rows = expandRecordsToRows(
        ["a", "b"],
        new Map([
          ["a", ["1"]],
          ["b", ["2"]],
        ]),
      );
      assert.deepEqual(rows, [["1", "2"]]);
    });

    it("fills missing variables with an empty string", function () {
      const rows = expandRecordsToRows(["a", "b"], new Map([["a", ["1"]]]));
      assert.deepEqual(rows, [["1", ""]]);
    });

    it("produces exactly one (empty) row when nothing is coded", function () {
      const rows = expandRecordsToRows(["a", "b"], new Map());
      assert.deepEqual(rows, [["", ""]]);
    });
  });

  describe("exportCodingData (integration)", function () {
    it("produces a wide CSV in Codebook column order, expanding a multi-value variable into extra rows", async function () {
      const project = await createProject(`Coding Export Test ${Date.now()}`);
      const codebook = await saveCodebook(project.id, [
        { name: "study_design", type: "categorical", values: ["RCT"] },
        { name: "sample_size", type: "numeric" },
        { name: "outcome", type: "text", multiple: true },
      ]);

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Coding Export Paper");
      item.setField("date", "2024");
      item.setCreators([
        { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
      ]);
      await item.saveTx();

      await addManualRecord(
        project.id,
        item,
        codebook.id,
        "study_design",
        "RCT",
        null,
        null,
      );
      await addManualRecord(
        project.id,
        item,
        codebook.id,
        "sample_size",
        "156",
        null,
        null,
      );
      await addManualRecord(
        project.id,
        item,
        codebook.id,
        "outcome",
        "Outcome Y1",
        null,
        null,
      );
      await addManualRecord(
        project.id,
        item,
        codebook.id,
        "outcome",
        "Outcome Y2",
        null,
        null,
      );

      const csv = await exportCodingData(project.id);
      const lines = csv.split("\n");
      assert.equal(
        lines[0],
        "item_key,authors,year,title,doi,study_design,sample_size,outcome",
      );
      assert.equal(lines.length, 3);
      assert.equal(
        lines[1],
        `${item.key},"Lovelace, Ada",2024,Coding Export Paper,,RCT,156,Outcome Y1`,
      );
      assert.equal(
        lines[2],
        `${item.key},"Lovelace, Ada",2024,Coding Export Paper,,RCT,156,Outcome Y2`,
      );
    });

    it("includes the item's DOI", async function () {
      const project = await createProject(
        `Coding Export DOI Test ${Date.now()}`,
      );
      const codebook = await saveCodebook(project.id, [
        { name: "study_design", type: "categorical", values: ["RCT"] },
      ]);

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "DOI Coding Paper");
      item.setField("date", "2024");
      item.setField("DOI", "10.1000/example.doi");
      await item.saveTx();

      await addManualRecord(
        project.id,
        item,
        codebook.id,
        "study_design",
        "RCT",
        null,
        null,
      );

      const csv = await exportCodingData(project.id);
      const lines = csv.split("\n");
      const header = lines[0].split(",");
      const doiColumn = header.indexOf("doi");
      assert.isAbove(doiColumn, -1);
      assert.equal(lines[1].split(",")[doiColumn], "10.1000/example.doi");
    });

    it("skips items with no confirmed coding records", async function () {
      const project = await createProject(
        `Coding Export Empty Test ${Date.now()}`,
      );
      const csv = await exportCodingData(project.id);
      assert.equal(csv.split("\n").length, 1); // header only
    });

    it("matches a record's variable_name to the Codebook column case/whitespace-insensitively", async function () {
      // Regression: a confirmed record's variable_name is whatever the AI
      // (or a human) actually typed, which isn't guaranteed to be
      // byte-for-byte identical to the Codebook's own casing/spacing --
      // an exact-match lookup here left every data column blank even
      // though the item had confirmed records.
      const project = await createProject(
        `Coding Export Casing Test ${Date.now()}`,
      );
      const codebook = await saveCodebook(project.id, [
        { name: "Study Design", type: "categorical", values: ["RCT"] },
      ]);

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Casing Paper");
      item.setField("date", "2024");
      await item.saveTx();

      await addManualRecord(
        project.id,
        item,
        codebook.id,
        " study design ",
        "RCT",
        null,
        null,
      );

      const csv = await exportCodingData(project.id);
      const lines = csv.split("\n");
      assert.equal(lines[0], "item_key,authors,year,title,doi,Study Design");
      assert.equal(lines.length, 2);
      assert.equal(lines[1], `${item.key},,2024,Casing Paper,,RCT`);
    });

    it("matches a record against a '<code> — <description>' Codebook column by its code lead-in alone", async function () {
      // Regression: real-world Codebooks label variables like
      // "B01 / QA1 — Design rationale & conjecturing", but the AI reliably
      // echoes back only the short-code lead-in ("B01 / QA1") as
      // variable_name -- an exact/normalized-only match left every such
      // (genuinely confirmed) record unmatched and the column blank.
      const project = await createProject(
        `Coding Export Alias Test ${Date.now()}`,
      );
      const codebook = await saveCodebook(project.id, [
        {
          name: "B01 / QA1 — Design rationale & conjecturing",
          type: "categorical",
          values: ["1", "2"],
        },
      ]);

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Alias Paper");
      item.setField("date", "2024");
      await item.saveTx();

      await addManualRecord(
        project.id,
        item,
        codebook.id,
        "B01 / QA1",
        "2 = Explicit/Coherent",
        null,
        null,
      );

      const csv = await exportCodingData(project.id);
      const lines = csv.split("\n");
      assert.equal(
        lines[0],
        "item_key,authors,year,title,doi,B01 / QA1 — Design rationale & conjecturing",
      );
      assert.equal(lines.length, 2);
      assert.equal(
        lines[1],
        `${item.key},,2024,Alias Paper,,2 = Explicit/Coherent`,
      );
    });
  });
});
