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
  ],
});
