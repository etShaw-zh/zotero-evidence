import { assert } from "chai";
import { saveCodebook } from "../src/modules/coding/codebookService";
import { addManualRecord } from "../src/modules/coding/codingService";
import { exportSynthesisData } from "../src/modules/export/synthesisExport";
import { createProject } from "../src/modules/project/projectManager";

describe("Phase 8: synthesisExport", function () {
  this.timeout(30000);

  it("produces one row per confirmed coding record, with an empty theme column when Synthesis hasn't run yet", async function () {
    const project = await createProject(`Synthesis Export Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "Population", type: "text" },
    ]);

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Synthesis Export Paper");
    await item.saveTx();

    await addManualRecord(
      project.id,
      item,
      codebook.id,
      "Population",
      "Adults",
      null,
      "adults only",
    );

    const csv = await exportSynthesisData(project.id);
    const lines = csv.split("\n");
    assert.equal(
      lines[0],
      "item_key,title,doi,variable_name,variable_value,quote,theme",
    );
    assert.equal(lines.length, 2);
    assert.equal(
      lines[1],
      `${item.key},Synthesis Export Paper,,Population,Adults,adults only,`,
    );
  });

  it("includes the item's DOI", async function () {
    const project = await createProject(
      `Synthesis Export DOI Test ${Date.now()}`,
    );
    const codebook = await saveCodebook(project.id, [
      { name: "Population", type: "text" },
    ]);

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "DOI Synthesis Paper");
    item.setField("DOI", "10.1000/example.doi");
    await item.saveTx();

    await addManualRecord(
      project.id,
      item,
      codebook.id,
      "Population",
      "Adults",
      null,
      null,
    );

    const csv = await exportSynthesisData(project.id);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    const doiColumn = header.indexOf("doi");
    assert.isAbove(doiColumn, -1);
    assert.equal(lines[1].split(",")[doiColumn], "10.1000/example.doi");
  });

  it("produces header-only CSV when the project has no confirmed coding records", async function () {
    const project = await createProject(
      `Synthesis Export Empty Test ${Date.now()}`,
    );
    const csv = await exportSynthesisData(project.id);
    assert.equal(csv.split("\n").length, 1);
  });
});
