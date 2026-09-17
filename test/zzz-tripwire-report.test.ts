/**
 * Fails the run, once, if support-tripwire.test.ts's root beforeEach ever
 * recorded a violation.
 *
 * Named to sort last: the scaffold globs `test/**\/*.{spec,test}.[jt]s`,
 * bundles each match with esbuild, and orders the resulting `<script>` tags
 * with a plain `.sort()` on the glob's own output (verified by reading
 * `bundleTests`/`createTestHtml` in zotero-plugin-scaffold), so file order in
 * the run is alphabetical and `zzz-` is the highest prefix any file under
 * test/ uses. Sorting last is what lets this spec report on every other spec
 * in the run rather than on however many happened to run before it.
 */

import { getTripwireRecord, survivableError } from "./support-tripwire";

describe("support: suite baseline tripwire report", function () {
  it("no spec left the tab bookkeeping and Zotero disagreeing", function () {
    const record = getTripwireRecord();
    if (record !== undefined) {
      throw survivableError(
        `tripwire recorded a violation before "${record.specTitle}" (spec #${record.index}): ${record.message}`,
      );
    }
  });
});
