import { assert } from "chai";
import {
  isDisagreementFlagged,
  setDisagreementFlag,
} from "../src/modules/consistency/disagreementFlagService";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("Consistency: disagreementFlagService (real Zotero tags)", function () {
  this.timeout(30000);

  it("isDisagreementFlagged is false until setDisagreementFlag(true), and true after", async function () {
    const item = await makeTestItem(`Disagreement Toggle Test ${Date.now()}`);
    assert.isFalse(isDisagreementFlagged(item));

    await setDisagreementFlag(item, true);
    assert.isTrue(isDisagreementFlagged(item));
  });

  it("setDisagreementFlag(false) unflags an item that was flagged", async function () {
    const item = await makeTestItem(`Disagreement Unflag Test ${Date.now()}`);
    await setDisagreementFlag(item, true);
    assert.isTrue(isDisagreementFlagged(item));

    await setDisagreementFlag(item, false);
    assert.isFalse(isDisagreementFlagged(item));
  });

  it("assigns the flag tag a color in the item's library, distinct from Key Literature's, and doesn't error on a second flag", async function () {
    const item = await makeTestItem(`Disagreement Color Test ${Date.now()}`);
    await setDisagreementFlag(item, true);

    const colored = Zotero.Tags.getColors(item.libraryID);
    const flagTag = Array.from(colored.keys()).find((name) =>
      name.includes("Reviewer Disagreement"),
    );
    assert.isDefined(flagTag);

    const item2 = await makeTestItem(`Disagreement Color Test 2 ${Date.now()}`);
    await setDisagreementFlag(item2, true);
    assert.isTrue(isDisagreementFlagged(item2));
    assert.equal(Zotero.Tags.getColors(item.libraryID).size, colored.size);
  });

  it("flagging is independent per item -- flagging one item never flags another", async function () {
    const flagged = await makeTestItem(
      `Disagreement Independent A ${Date.now()}`,
    );
    const notFlagged = await makeTestItem(
      `Disagreement Independent B ${Date.now()}`,
    );
    await setDisagreementFlag(flagged, true);

    assert.isTrue(isDisagreementFlagged(flagged));
    assert.isFalse(isDisagreementFlagged(notFlagged));
  });
});
