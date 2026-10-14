import { assert } from "chai";
import { reasoningLanguageInstruction } from "../src/modules/ai/aiClient";
import { getPref, setPref } from "../src/utils/prefs";
import { config } from "../package.json";

describe("localization", function () {
  it("loads zh-TW and en-US through native Fluent without missing messages", function () {
    const LocalizationCtor = (Zotero as any)[config.addonInstance].data.locale
      .current.constructor;
    for (const [locale, expected] of [
      ["zh-TW", "取消"],
      ["en-US", "Cancel"],
    ]) {
      const l10n = new LocalizationCtor(
        [`${config.addonRef}-addon.ftl`],
        true,
        undefined,
        [locale],
      );
      const messages = l10n.formatMessagesSync([
        { id: `${config.addonRef}-dialog-cancel` },
        {
          id: `${config.addonRef}-progress-project-created`,
          args: { name: "TEST" },
        },
        { id: `${config.addonRef}-prefs-pane-ai-provider-btn` },
      ]);
      assert.equal(messages[0]?.value, expected);
      assert.include(messages[1]?.value ?? "", "TEST");
      assert.isNotEmpty(messages[2]?.attributes);
    }
  });

  it("keeps the screening explanation override independent of the UI locale", function () {
    const previous = getPref("reasoningLanguage");
    const uiLocale = Zotero.locale;
    try {
      setPref("reasoningLanguage", "en-US");
      assert.include(reasoningLanguageInstruction(), "(en-US)");
      setPref("reasoningLanguage", "zh-TW");
      assert.include(reasoningLanguageInstruction(), "(zh-TW)");
      assert.equal(Zotero.locale, uiLocale);
      setPref("reasoningLanguage", "");
      assert.include(reasoningLanguageInstruction(), `(${uiLocale})`);
      setPref("reasoningLanguage", "invalid-locale");
      assert.include(reasoningLanguageInstruction(), `(${uiLocale})`);
    } finally {
      setPref("reasoningLanguage", previous || "");
    }
  });
});
