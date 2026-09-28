import { assert } from "chai";
import {
  isCodingCompleteTag,
  syncCodingCompleteTag,
} from "../src/modules/coding/codingCompletionService";

// Same shape as test/disagreementFlag.test.ts/keyLiteratureService's own
// tests -- issue #9's item-level completion status is a real Zotero tag
// (see codingCompletionService.ts's doc comment for why), so these are
// integration tests against the real tag API, not a mock.
async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("Coding: codingCompletionService (real Zotero tags)", function () {
  this.timeout(30000);

  it("isCodingCompleteTag is false until syncCodingCompleteTag(true), and true after", async function () {
    const item = await makeTestItem(
      `Coding Complete Toggle Test ${Date.now()}`,
    );
    assert.isFalse(isCodingCompleteTag(item));

    await syncCodingCompleteTag(item, true);
    assert.isTrue(isCodingCompleteTag(item));
  });

  it("syncCodingCompleteTag(false) clears the tag from an item that had it", async function () {
    const item = await makeTestItem(`Coding Complete Clear Test ${Date.now()}`);
    await syncCodingCompleteTag(item, true);
    assert.isTrue(isCodingCompleteTag(item));

    await syncCodingCompleteTag(item, false);
    assert.isFalse(isCodingCompleteTag(item));
  });

  it("syncCodingCompleteTag(null) clears the tag too -- 'not applicable' is never left showing as complete", async function () {
    const item = await makeTestItem(`Coding Complete NA Test ${Date.now()}`);
    await syncCodingCompleteTag(item, true);
    assert.isTrue(isCodingCompleteTag(item));

    // Simulates a Codebook edited to drop its last required variable --
    // isCodingComplete would now return null, and a stale "complete" tag
    // from before that edit must not linger.
    await syncCodingCompleteTag(item, null);
    assert.isFalse(isCodingCompleteTag(item));
  });

  it("assigns the tag a color in the item's library, and doesn't error on a second item", async function () {
    const item = await makeTestItem(`Coding Complete Color Test ${Date.now()}`);
    await syncCodingCompleteTag(item, true);

    const colored = Zotero.Tags.getColors(item.libraryID);
    const tag = Array.from(colored.keys()).find((name) =>
      name.includes("Coding Complete"),
    );
    assert.isDefined(tag);

    const item2 = await makeTestItem(
      `Coding Complete Color Test 2 ${Date.now()}`,
    );
    await syncCodingCompleteTag(item2, true);
    assert.isTrue(isCodingCompleteTag(item2));
    assert.equal(Zotero.Tags.getColors(item.libraryID).size, colored.size);
  });

  it("is independent per item -- tagging one item never tags another", async function () {
    const complete = await makeTestItem(
      `Coding Complete Independent A ${Date.now()}`,
    );
    const incomplete = await makeTestItem(
      `Coding Complete Independent B ${Date.now()}`,
    );
    await syncCodingCompleteTag(complete, true);

    assert.isTrue(isCodingCompleteTag(complete));
    assert.isFalse(isCodingCompleteTag(incomplete));
  });
});
