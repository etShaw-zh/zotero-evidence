import { assert } from "chai";
import { databaseService } from "../src/modules/db/database";
import { createProject } from "../src/modules/project/projectManager";
import { getScreeningConsistency } from "../src/modules/screening/consistencyService";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("Screening Consistency: getScreeningConsistency (project + DB)", function () {
  this.timeout(60000);

  it("computes overall + per-category Kappa and lists disagreements for one stage", async function () {
    const project = await createProject(`Consistency Test ${Date.now()}`);
    await databaseService.init();

    const items = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        makeTestItem(`Consistency Item ${i}`),
      ),
    );
    const rows: { key: string; ai: string; human: string }[] = [
      { key: items[0].key, ai: "include", human: "include" },
      { key: items[1].key, ai: "include", human: "exclude" },
      { key: items[2].key, ai: "exclude", human: "exclude" },
      { key: items[3].key, ai: "unclear", human: "unclear" },
    ];
    for (const r of rows) {
      await databaseService.queryAsync(
        `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision, decision)
         VALUES (?, ?, 'ta_screening', ?, ?, ?)`,
        [project.id, r.key, r.ai, r.human, r.human],
      );
    }

    const result = await getScreeningConsistency(project.id, "ta_screening");
    assert.equal(result.n, 4);
    assert.equal(result.disagreements.length, 1);
    assert.equal(result.disagreements[0].itemKey, items[1].key);
    assert.equal(result.disagreements[0].title, "Consistency Item 1");
    assert.equal(result.disagreements[0].aiDecision, "include");
    assert.equal(result.disagreements[0].humanDecision, "exclude");
    assert.approximately(result.observedAgreement!, 3 / 4, 1e-9);
    assert.isNotNull(result.kappa);

    const byName = new Map(result.byCategory.map((c) => [c.category, c]));
    assert.isTrue(byName.has("include"));
    assert.isTrue(byName.has("exclude"));
    assert.isTrue(byName.has("unclear"));
  });

  it("ignores rows where either side hasn't decided yet, returning n=0 with no crash", async function () {
    const project = await createProject(`Consistency Empty Test ${Date.now()}`);
    await databaseService.init();
    const item = await makeTestItem("Undecided Item");
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision)
       VALUES (?, ?, 'ta_screening', 'include')`,
      [project.id, item.key],
    );

    const result = await getScreeningConsistency(project.id, "ta_screening");
    assert.equal(result.n, 0);
    assert.isNull(result.observedAgreement);
    assert.isNull(result.kappa);
    assert.deepEqual(result.byCategory, []);
    assert.deepEqual(result.disagreements, []);
  });

  it("keeps TA and FT stages independent even within the same project", async function () {
    const project = await createProject(`Consistency Stage Test ${Date.now()}`);
    await databaseService.init();
    const item = await makeTestItem("Stage Item");
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ta_screening', 'include', 'include')`,
      [project.id, item.key],
    );

    const ta = await getScreeningConsistency(project.id, "ta_screening");
    const ft = await getScreeningConsistency(project.id, "ft_screening");
    assert.equal(ta.n, 1);
    assert.equal(ft.n, 0);
  });
});
