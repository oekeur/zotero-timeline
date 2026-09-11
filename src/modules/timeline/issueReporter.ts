/**
 * Opens the project's GitHub issue forms with what the running instance
 * already knows filled in.
 *
 * The bug form carries the plugin's recent failures. Those survive to
 * Zotero.getErrors() whether or not debug logging was ever enabled, which is
 * the whole point of routing failures through logFailure - see
 * src/utils/logging.ts. An entry travels when it carries the plugin's own
 * prefix, or - for an uncaught exception logFailure never wrapped - when its
 * `file:` field names the plugin's own bundle script. The same buffer holds
 * other plugins' failures and Zotero's own, and those can carry absolute
 * paths naming the user.
 */

import {
  config,
  homepage,
  version as pluginVersion,
} from "../../../package.json";
import { logFailure } from "../../utils/logging";

const ISSUE_URL = `${homepage}/issues/new`;

const BUG_TEMPLATE = "bug_report.yml";
const FEATURE_TEMPLATE = "feature_request.yml";

/** The prefix every logFailure message carries, per the convention in logging.ts. */
const PLUGIN_PREFIX = "[zoteroTimeline]";
const PLUGIN_PREFIX_LOWER = PLUGIN_PREFIX.toLowerCase();

/**
 * The bundle's own script filename, e.g. `zoterotimeline.js` - see the
 * `outfile` in zotero-plugin.config.ts, which names it from the same
 * `addonRef`. An uncaught exception thrown inside the plugin's code (nothing
 * wrapped it in logFailure to add the prefix) reaches Zotero.getErrors() as a
 * bare `[JavaScript Error: "..." {file: ".../content/scripts/<this>.js" ...}]`
 * with no prefix at all; matching on this is what still catches it.
 */
const BUNDLE_SCRIPT_NAME = `${config.addonRef}.js`.toLowerCase();

/**
 * Ceiling for the whole finished URL. Measured unauthenticated against
 * GitHub's own behaviour: a prefilled issue form 302s up to ~6981 characters,
 * answers 500 from ~7081, and 414s from ~8300. This sits comfortably inside
 * all three.
 */
export const MAX_ISSUE_URL_LENGTH = 6900;

/**
 * A representative field budget for a caller with no real
 * pluginVersion/zoteroVersion/os to build the URL from - test code, mainly.
 * Nothing that actually launches a report uses this: `openBugReport` calls
 * `computeLogBudget` with the running instance's real values instead, because
 * no fixed number here stays correct on all of them. Zotero.version can carry
 * a build suffix like `10.0-beta.25+1dbaec65b` (`+` alone costs two extra
 * encoded characters), and pluginVersion can be a prerelease string; either
 * one a few characters longer than assumed here pushes the finished URL past
 * MAX_ISSUE_URL_LENGTH with this constant fixed rather than measured.
 */
export const URL_BUDGET = 6750;

const TRUNCATION_MARKER =
  "[older entries dropped to fit the URL; the full log is in Zotero under Help, Report Errors.]";

/**
 * Encoded length of the `debug-output=<text>` field the way `buildIssueUrl`
 * actually serialises it: through URLSearchParams, not encodeURIComponent.
 * The two disagree on `( ) ' ! ~`, which URLSearchParams escapes to three
 * characters each and encodeURIComponent leaves bare - a log built of those
 * characters could pass an encodeURIComponent-measured budget while the
 * finished URL came out more than double the target. An unencodable string
 * (a slice landing between a surrogate pair) is treated as over budget rather
 * than letting the constructor throw; the search below then steps back off
 * it.
 */
function encodedLength(text: string): number {
  try {
    return new URLSearchParams({ "debug-output": text }).toString().length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The longest `prefix + body.slice(0, n)` that fits `budget` once encoded, or
 * null when the prefix alone already does not.
 */
function cutToFit(prefix: string, body: string, budget: number): string | null {
  if (encodedLength(prefix) > budget) {
    return null;
  }
  let low = 0;
  let high = body.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encodedLength(prefix + body.slice(0, mid)) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return prefix + body.slice(0, low);
}

export type IssueContext = {
  pluginVersion: string;
  zoteroVersion: string;
  os: string;
  errorLog: string;
};

/**
 * Keeps only this plugin's entries and drops the oldest until what remains
 * fits `budget` once encoded. Newest entries are kept because they describe
 * the failure the reporter just hit; older ones are usually a previous
 * session's.
 *
 * Takes the array rather than calling Zotero itself so it can be tested
 * without a live instance.
 *
 * An entry qualifies by carrying the prefix (case-insensitive: earlier code
 * logged it as `[ZoteroTimeline]`, and an entry carrying that capitalization
 * can still sit in the 25-entry ring from before this session's fix), or by
 * its `file:` field naming the plugin's own bundle script - an uncaught
 * exception inside the plugin's code reaches Zotero.getErrors() this way,
 * with no prefix at all, because nothing wrapped it in logFailure.
 */
export function collectErrorLog(entries: string[], budget: number): string {
  const mine = entries.filter((entry) => {
    const lower = entry.toLowerCase();
    return (
      lower.includes(PLUGIN_PREFIX_LOWER) || lower.includes(BUNDLE_SCRIPT_NAME)
    );
  });
  if (mine.length === 0) {
    return "";
  }

  // Drop from the front (oldest) until the encoded result fits.
  for (let start = 0; start < mine.length; start++) {
    const kept = mine.slice(start);
    const body =
      start === 0
        ? kept.join("\n\n")
        : `${TRUNCATION_MARKER}\n\n${kept.join("\n\n")}`;
    if (encodedLength(body) <= budget) {
      return body;
    }
  }

  // Even the newest entry alone overflows, so cut it mid-string. Slicing the
  // raw text and re-encoding keeps the result valid; slicing encoded text
  // could sever a percent-escape.
  const newest = mine[mine.length - 1];
  const marked = cutToFit(`${TRUNCATION_MARKER}\n\n`, newest, budget);
  if (marked !== null) {
    return marked;
  }

  // The marker itself does not fit. Send whatever of the entry does rather
  // than blowing the budget to explain that we could not.
  return cutToFit("", newest, budget) ?? "";
}

/**
 * Builds a prefill URL for one of the two issue forms. Field names are the
 * `id` values in .github/ISSUE_TEMPLATE/*.yml, which is what GitHub matches
 * query parameters against.
 *
 * `blank_issues_enabled` is false for this repo, so the template parameter is
 * required rather than cosmetic.
 */
export function buildIssueUrl(
  kind: "bug" | "feature",
  context?: IssueContext,
): string {
  const params = new URLSearchParams();
  params.set("template", kind === "bug" ? BUG_TEMPLATE : FEATURE_TEMPLATE);

  if (kind === "bug" && context) {
    params.set("plugin-version", context.pluginVersion);
    params.set("zotero-version", context.zoteroVersion);
    params.set("os", context.os);
    // An empty prefill would read as "there was nothing here", which is a
    // different claim from "the plugin logged nothing". Omit it instead.
    if (context.errorLog) {
      params.set("debug-output", context.errorLog);
    }
  }

  return `${ISSUE_URL}?${params.toString()}`;
}

/**
 * The ceiling for the `debug-output=<value>` field, measured from the actual
 * URL these three values build with no log at all, rather than assumed from
 * a fixed guess at their combined length - the defect a fixed constant had:
 * a longer Zotero build string or a prerelease plugin version shifts the
 * fixed overhead by more than the margin a constant left for it.
 *
 * The debug-output param is entirely omitted from that empty-log URL (see
 * buildIssueUrl above), so its own cost is not part of `shellUrl.length` and
 * has to be added back - but only the `&` that would join it to what's
 * already there. `encodedLength` inside collectErrorLog already measures the
 * key and `=` as part of whatever text it is given, so counting those here
 * too would subtract them twice.
 */
export function computeLogBudget(
  pluginVersion: string,
  zoteroVersion: string,
  os: string,
): number {
  const shellUrl = buildIssueUrl("bug", {
    pluginVersion,
    zoteroVersion,
    os,
    errorLog: "",
  });
  return MAX_ISSUE_URL_LENGTH - shellUrl.length - 1;
}

/** Matches the `os` dropdown's option text in bug_report.yml exactly. */
function currentOS(): string {
  if (Zotero.isWin) return "Windows";
  if (Zotero.isMac) return "macOS";
  if (Zotero.isLinux) return "Linux";
  return "Other";
}

function readErrorLog(
  pluginVersion: string,
  zoteroVersion: string,
  os: string,
): string {
  try {
    const budget = computeLogBudget(pluginVersion, zoteroVersion, os);
    return collectErrorLog(Zotero.getErrors(true), budget);
  } catch (err) {
    // A report without the log still beats no report at all.
    logFailure(
      `${PLUGIN_PREFIX} could not read the error log for a bug report`,
      err,
    );
    return "";
  }
}

function launch(url: string): void {
  try {
    Zotero.launchURL(url);
  } catch (err) {
    // launchURL throws on an unhandled scheme rather than returning false.
    logFailure(`${PLUGIN_PREFIX} could not open the issue form`, err);
  }
}

export function openBugReport(): void {
  const zoteroVersion = Zotero.version;
  const os = currentOS();
  launch(
    buildIssueUrl("bug", {
      pluginVersion,
      zoteroVersion,
      os,
      errorLog: readErrorLog(pluginVersion, zoteroVersion, os),
    }),
  );
}

export function openFeatureRequest(): void {
  launch(buildIssueUrl("feature"));
}
