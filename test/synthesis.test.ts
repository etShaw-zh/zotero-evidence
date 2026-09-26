import { assert } from "chai";
import {
  deleteProvider,
  upsertProvider,
} from "../src/modules/ai/providerConfig";
import {
  getLatestCodebook,
  saveCodebook,
} from "../src/modules/coding/codebookService";
import { addManualRecord } from "../src/modules/coding/codingService";
import {
  getSynthesisRows,
  parseThemes,
  runSynthesis,
} from "../src/modules/synthesis/synthesisService";
import { databaseService } from "../src/modules/db/database";
import { createProject } from "../src/modules/project/projectManager";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("Phase 7: Synthesis", function () {
  this.timeout(30000);

  it("parseThemes parses a JSON array and tolerates bad entries", function () {
    const good = parseThemes('[{"id":1,"theme":"Efficacy concerns"}]');
    assert.equal(good.length, 1);
    assert.equal(good[0].id, 1);
    assert.equal(good[0].theme, "Efficacy concerns");

    const fenced = parseThemes('```json\n[{"id":2,"theme":"Safety"}]\n```');
    assert.equal(fenced.length, 1);

    const mixed = parseThemes(
      '[{"id":1,"theme":"A"},{"id":"not a number","theme":"B"},"not an object"]',
    );
    assert.equal(mixed.length, 1);

    assert.deepEqual(parseThemes("not json at all"), []);
    assert.deepEqual(parseThemes('{"not":"an array"}'), []);
  });

  it("getSynthesisRows only returns confirmed records matching the given variable (canonical-name resolved), with item titles resolved", async function () {
    const project = await createProject(`Synthesis Rows Test ${Date.now()}`);
    await saveCodebook(project.id, [
      { name: "Population", type: "text" },
      { name: "Intervention", type: "text" },
    ]);
    const codebook = await getLatestCodebook(project.id);
    const itemA = await makeTestItem("Study A");
    const itemB = await makeTestItem("Study B");

    // Confirmed, exact variable name match.
    await addManualRecord(
      project.id,
      itemA,
      codebook!.id,
      "Population",
      "Adults",
      null,
      "adults only",
    );
    // Confirmed, same variable but different casing/whitespace -- should
    // still resolve to "Population" via resolveCanonicalVariableName, same
    // as getCodingProgress already relies on.
    await addManualRecord(
      project.id,
      itemB,
      codebook!.id,
      " population ",
      "Elderly",
      null,
      "elderly patients",
    );
    // Confirmed, but a DIFFERENT variable -- must be excluded.
    await addManualRecord(
      project.id,
      itemA,
      codebook!.id,
      "Intervention",
      "Drug X",
      null,
      "received drug x",
    );

    // Unconfirmed record for the target variable -- must be excluded.
    // addManualRecord always confirms, so this is seeded directly.
    await databaseService.init();
    const now = new Date().toISOString();
    await databaseService.queryAsync(
      `INSERT INTO coding_records
         (project_id, codebook_id, item_key, variable_name, variable_value, quote, is_pilot, source, confirmed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'ai', 0, ?, ?)`,
      [
        project.id,
        codebook!.id,
        itemA.key,
        "Population",
        "Children",
        "children only",
        now,
        now,
      ],
    );

    const rows = await getSynthesisRows(project.id, "Population");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.itemTitle).sort(), [
      "Study A",
      "Study B",
    ]);
    assert.isTrue(rows.every((r) => r.theme === null));
  });

  it("runSynthesis refuses to run without a configured provider", async function () {
    deleteProvider("default");
    const project = await createProject(
      `Synthesis No Provider Test ${Date.now()}`,
    );
    let threw = false;
    try {
      await runSynthesis(project.id, "Population");
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /provider/i);
    }
    assert.isTrue(threw);
  });

  it("runSynthesis refuses when there are no confirmed records for the variable", async function () {
    upsertProvider({
      id: "default",
      name: "Test Provider",
      baseURL: "http://127.0.0.1:1/unused",
      apiKey: "test",
      model: "test-model",
    });
    const project = await createProject(
      `Synthesis No Records Test ${Date.now()}`,
    );
    await saveCodebook(project.id, [{ name: "Population", type: "text" }]);
    let threw = false;
    try {
      await runSynthesis(project.id, "Population");
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /confirmed/i);
    }
    assert.isTrue(threw);
    deleteProvider("default");
  });
});
