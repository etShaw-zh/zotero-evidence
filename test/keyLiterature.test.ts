import { assert } from "chai";
import {
  isKeyLiterature,
  setKeyLiterature,
} from "../src/modules/coding/keyLiteratureService";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("Coding: keyLiteratureService (real Zotero tags)", function () {
  this.timeout(30000);

  it("isKeyLiterature is false until setKeyLiterature(true), and true after", async function () {
    const item = await makeTestItem(`Key Lit Toggle Test ${Date.now()}`);
    assert.isFalse(isKeyLiterature(item));

    await setKeyLiterature(item, true);
    assert.isTrue(isKeyLiterature(item));
  });

  it("setKeyLiterature(false) unflags an item that was flagged", async function () {
    const item = await makeTestItem(`Key Lit Unflag Test ${Date.now()}`);
    await setKeyLiterature(item, true);
    assert.isTrue(isKeyLiterature(item));

    await setKeyLiterature(item, false);
    assert.isFalse(isKeyLiterature(item));
  });

  it("assigns the flag tag a color in the item's library, and doesn't error on a second flag (color already assigned)", async function () {
    const item = await makeTestItem(`Key Lit Color Test ${Date.now()}`);
    await setKeyLiterature(item, true);

    const colored = Zotero.Tags.getColors(item.libraryID);
    const flagTag = Array.from(colored.keys()).find((name) =>
      name.includes("Key Literature"),
    );
    assert.isDefined(flagTag);

    // Flagging a second, different item shouldn't fail or reassign a new
    // color entry for the same tag name.
    const item2 = await makeTestItem(`Key Lit Color Test 2 ${Date.now()}`);
    await setKeyLiterature(item2, true);
    assert.isTrue(isKeyLiterature(item2));
    assert.equal(Zotero.Tags.getColors(item.libraryID).size, colored.size);
  });

  it("flagging is independent per item -- flagging one item never flags another", async function () {
    const flagged = await makeTestItem(`Key Lit Independent A ${Date.now()}`);
    const notFlagged = await makeTestItem(
      `Key Lit Independent B ${Date.now()}`,
    );
    await setKeyLiterature(flagged, true);

    assert.isTrue(isKeyLiterature(flagged));
    assert.isFalse(isKeyLiterature(notFlagged));
  });
});
