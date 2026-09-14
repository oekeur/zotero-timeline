// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";
import globals from "globals";

export default zotero({
  overrides: [
    {
      // scripts/ runs under plain Node (`node scripts/*.mjs`), unlike
      // src/ and addon/ which target the Zotero sandbox - needs Node globals.
      files: ["scripts/**/*.{js,mjs,cjs}"],
      languageOptions: {
        globals: globals.node,
      },
    },
    {
      // The one exception to the rule above: this seeder is evaluated inside a
      // running Zotero (Run JavaScript, or the MCP rig's zotero_execute_js)
      // because Zotero's data layer is unreachable from Node. Its globals are
      // the sandbox's, not Node's.
      files: ["scripts/seed-dev-profile.js"],
      languageOptions: {
        globals: { Zotero: "readonly" },
      },
    },
  ],
});
