import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should register a Settings pane for this plugin", function () {
    const pane = Zotero.PreferencePanes.pluginPanes.find(
      (p) => p.pluginID === config.addonID,
    );
    assert.isDefined(pane);
  });
});
