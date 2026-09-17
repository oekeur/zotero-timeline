/**
 * Fails the run, once, if support-tripwire.test.ts's root beforeEach ever
 * recorded a violation, or if any spec in the run failed with a diagnosis
 * that would otherwise have been lost.
 *
 * Named to sort last: the scaffold globs `test/**\/*.{spec,test}.[jt]s`,
 * bundles each match with esbuild, and orders the resulting `<script>` tags
 * with a plain `.sort()` on the glob's own output (verified by reading
 * `bundleTests`/`createTestHtml` in zotero-plugin-scaffold), so file order in
 * the run is alphabetical and `zzz-` is the highest prefix any file under
 * test/ uses. Sorting last is what lets this spec report on every other spec
 * in the run rather than on however many happened to run before it.
 *
 * Beyond the tab-bookkeeping disagreement, this also fails on the failure
 * catalogue support-tripwire.test.ts's root afterEach built (see
 * support-tripwire.ts's `CatalogueEntry`): a lost message
 * (`messageWasEnumerable === false`) always fails it, since the catalogue
 * entry is the only place that text still exists; an `undefined`-shaped
 * message with no recorded disagreement also fails it, since that shape is
 * what an uncaught async error escaping into the wrong spec looks like.
 */

import {
  getFailureCatalogue,
  getTripwireRecord,
  survivableError,
} from "./support-tripwire";

describe("support: suite baseline tripwire report", function () {
  it("no spec left the tab bookkeeping and Zotero disagreeing, and no failure lost its text", function () {
    const record = getTripwireRecord();
    const catalogue = getFailureCatalogue();

    const lostMessage = catalogue.some((entry) => !entry.messageWasEnumerable);
    const missingMessage =
      record === undefined &&
      catalogue.length > 0 &&
      catalogue.some(
        (entry) => !entry.message || entry.message === "undefined",
      );

    if (record === undefined && !lostMessage && !missingMessage) {
      return;
    }

    const lines: string[] = [];
    if (record !== undefined) {
      lines.push(
        `tripwire recorded a violation before "${record.specTitle}" (spec #${record.index}): ${record.message}`,
      );
    }
    catalogue.forEach((entry, i) => {
      const stackFirstLine = entry.stackHead.split("\n")[0] ?? "";
      lines.push(
        `#${i + 1} ${entry.title} :: ${entry.name}: ${entry.message} | ` +
          `${stackFirstLine} | new plugin errors: ${entry.newPluginErrors.join(", ")}`,
      );
    });

    throw survivableError(lines.join("\n"));
  });
});
