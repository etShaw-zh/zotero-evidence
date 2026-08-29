// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default [
  ...zotero({
    overrides: [
      {
        files: ["**/*.ts"],
        rules: {
          // We disable this rule here because the template
          // contains some unused examples and variables
          "@typescript-eslint/no-unused-vars": "off",
        },
      },
    ],
  }),
  {
    // Vendored third-party build output (MuPDF WASM factory, from
    // beaver-zotero, AGPL-3.0) -- not our source, not meant to be linted.
    ignores: ["addon/content/lib/**"],
  },
];
