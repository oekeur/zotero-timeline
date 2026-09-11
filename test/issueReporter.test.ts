import { assert } from "chai";
import { homepage } from "../package.json";
import {
  buildIssueUrl,
  collectErrorLog,
  computeLogBudget,
  MAX_ISSUE_URL_LENGTH,
  URL_BUDGET,
} from "../src/modules/timeline/issueReporter";

const PREFIX = "[zoteroTimeline]";

function entry(body: string): string {
  return `${PREFIX} ${body}`;
}

/**
 * Measures a candidate `debug-output` value the same way `buildIssueUrl`
 * actually serialises it: through URLSearchParams, not encodeURIComponent.
 * The two disagree on `( ) ' ! ~`, which URLSearchParams escapes to three
 * characters each and encodeURIComponent leaves bare - measuring with the
 * wrong one is exactly the defect these specs guard against.
 */
function debugOutputFieldLength(text: string): number {
  return new URLSearchParams({ "debug-output": text }).toString().length;
}

describe("issue reporter", function () {
  describe("collectErrorLog", function () {
    it("keeps only this plugin's entries", function () {
      const log = collectErrorLog(
        [
          "some other plugin exploded at /home/someone/secret",
          entry("timeline rebuild failed"),
          "Zotero core warning",
        ],
        URL_BUDGET,
      );

      assert.include(log, "timeline rebuild failed");
      assert.notInclude(log, "some other plugin");
      assert.notInclude(log, "/home/someone/secret");
      assert.notInclude(log, "Zotero core warning");
    });

    // AC #3 and this task's case-insensitivity requirement: a prefix-less
    // entry never travels, and an entry carrying the older [ZoteroTimeline]
    // (capital Z) casing still does.
    it("excludes an entry with no plugin prefix and includes a capital-Z one", function () {
      const log = collectErrorLog(
        [
          "no prefix at all, drop this",
          "[ZoteroTimeline] openTimelineTab failed: boom",
        ],
        URL_BUDGET,
      );

      assert.notInclude(log, "drop this");
      assert.include(log, "openTimelineTab failed");
    });

    // AC #10: an uncaught exception inside the plugin's own code never passes
    // through logFailure, so it reaches Zotero.getErrors() with no
    // [zoteroTimeline] prefix at all - only Gecko's own "file:" field says
    // where it came from. Other plugins' scripts and Zotero's own chrome://
    // sources must still be excluded even though this widens the filter.
    it("admits an unprefixed entry naming the plugin's own bundle script, and still excludes other sources", function () {
      const fromZoteroCore =
        '[JavaScript Error: "TypeError: x is undefined" {file: "chrome://zotero/content/xpcom/data/item.js" line: 42}]';
      const fromAnotherPlugin =
        '[JavaScript Error: "boom" {file: "file:///home/someone/.zotero/extensions/some-other-plugin/content/scripts/otherplugin.js" line: 3}]';
      const uncaughtFromThisPlugin =
        '[JavaScript Error: "TypeError: container is null" {file: "file:///home/someone/.zotero/extensions/zoterotimeline@oekeur.github.io.xpi!/content/scripts/zoterotimeline.js" line: 1416}]';

      const log = collectErrorLog(
        [fromZoteroCore, fromAnotherPlugin, uncaughtFromThisPlugin],
        URL_BUDGET,
      );

      assert.notInclude(log, "item.js");
      assert.notInclude(log, "otherplugin.js");
      assert.include(log, "container is null");
    });

    it("returns empty when nothing is this plugin's", function () {
      assert.equal(collectErrorLog(["unrelated failure"], URL_BUDGET), "");
    });

    it("returns empty for an empty buffer", function () {
      assert.equal(collectErrorLog([], URL_BUDGET), "");
    });

    it("keeps every entry when they all fit", function () {
      const log = collectErrorLog(
        [entry("first"), entry("second"), entry("third")],
        URL_BUDGET,
      );

      assert.include(log, "first");
      assert.include(log, "second");
      assert.include(log, "third");
      assert.notInclude(log, "older entries dropped");
    });

    it("drops oldest first and marks that it did", function () {
      // Five entries of roughly 2000 encoded characters each overflow the
      // budget, so the oldest go and the newest stay whole. Dropping has to
      // free more than the marker costs, which a two-entry case never does.
      const entries = Array.from({ length: 5 }, (_, i) =>
        entry(`failure ${i} ${"x".repeat(1960)}`),
      );

      const log = collectErrorLog(entries, URL_BUDGET);

      assert.notInclude(log, "failure 0");
      assert.include(log, "failure 4");
      assert.include(log, "older entries dropped");
      assert.isAtMost(debugOutputFieldLength(log), URL_BUDGET);
    });

    it("stays within budget once encoded", function () {
      const entries = Array.from({ length: 40 }, (_, i) =>
        entry(`failure ${i}\n    at frame (file.ts:${i}:1)\n`.repeat(30)),
      );

      const log = collectErrorLog(entries, URL_BUDGET);

      assert.isAtMost(debugOutputFieldLength(log), URL_BUDGET);
      assert.isNotEmpty(log);
    });

    it("cuts a single oversized entry rather than returning nothing", function () {
      const log = collectErrorLog([entry("y".repeat(50000))], URL_BUDGET);

      assert.isNotEmpty(log);
      assert.isAtMost(debugOutputFieldLength(log), URL_BUDGET);
      assert.include(log, "older entries dropped");
    });

    it("budgets the encoded length, not the raw length", function () {
      // Newlines triple under encoding, so a raw-length check would pass a
      // string that the encoded check rejects.
      const log = collectErrorLog([entry("\n".repeat(4000))], 100);
      assert.isAtMost(debugOutputFieldLength(log), 100);
    });

    it("cuts around an astral-plane character rather than throwing", function () {
      // A cut landing between a surrogate pair makes both encoders throw
      // outright. An item title with an emoji in it reaches this.
      const log = collectErrorLog([entry("💥".repeat(2000))], 200);

      assert.isAtMost(debugOutputFieldLength(log), 200);
    });

    // The defect the adversarial gate found: encodeURIComponent leaves
    // ( ) ' ! ~ bare, but URLSearchParams (what buildIssueUrl actually uses)
    // escapes each to three characters. A log built almost entirely of those
    // characters passed an encodeURIComponent-measured budget while the
    // finished URL came out more than double the intended ceiling.
    it("measures a log of URLSearchParams-only-escaped characters correctly, not via encodeURIComponent", function () {
      const body = "(x)".repeat(1900);
      const log = collectErrorLog([entry(body)], URL_BUDGET);

      const trueLength = debugOutputFieldLength(log);
      const encodeURIComponentLength = encodeURIComponent(log).length;

      assert.isAtMost(trueLength, URL_BUDGET);
      // The two encoders really do disagree here - otherwise this spec would
      // not have caught the defect it exists to catch.
      assert.isBelow(encodeURIComponentLength, trueLength);
    });
  });

  describe("computeLogBudget", function () {
    // The defect the adversarial gate found: a fixed overhead constant
    // undershot the real cost of a prerelease plugin version, the longest os
    // option text, and a Zotero build string carrying a `+` suffix, and the
    // finished URL came out over MAX_ISSUE_URL_LENGTH. computeLogBudget
    // measures the actual overhead for these exact values instead.
    it("keeps the finished URL under the ceiling for a prerelease plugin version and a Zotero build suffix, with an oversized log", function () {
      const pluginVersion = "0.2.0-beta.12";
      const zoteroVersion = "10.0-beta.25+1dbaec65b";
      const os = "Windows";

      const budget = computeLogBudget(pluginVersion, zoteroVersion, os);
      const log = collectErrorLog([entry("(x)".repeat(3000))], budget);
      const url = buildIssueUrl("bug", {
        pluginVersion,
        zoteroVersion,
        os,
        errorLog: log,
      });

      assert.isAtMost(url.length, MAX_ISSUE_URL_LENGTH);
    });

    it("shrinks as the fixed fields grow, rather than holding one value regardless of their length", function () {
      const short = computeLogBudget("0.1.0", "7.0.32", "Linux");
      const long = computeLogBudget(
        "0.2.0-beta.12",
        "10.0-beta.25+1dbaec65b",
        "Windows",
      );

      assert.isBelow(long, short);
    });
  });

  describe("buildIssueUrl", function () {
    function context() {
      return {
        pluginVersion: "0.1.0",
        zoteroVersion: "7.0.15",
        os: "Linux",
        errorLog: entry("timeline rebuild failed"),
      };
    }

    it("points at the repo's bug form, read from package.json rather than hardcoded", function () {
      const url = buildIssueUrl("bug", context());
      assert.include(url, `${homepage}/issues/new?`);
      assert.include(url, "template=bug_report.yml");
    });

    it("points at the repo's feature form", function () {
      const url = buildIssueUrl("feature");
      assert.include(url, "template=feature_request.yml");
    });

    it("fills the fields bug_report.yml declares", function () {
      const params = new URL(buildIssueUrl("bug", context())).searchParams;

      assert.equal(params.get("plugin-version"), "0.1.0");
      assert.equal(params.get("zotero-version"), "7.0.15");
      assert.equal(params.get("os"), "Linux");
      assert.include(params.get("debug-output")!, "timeline rebuild failed");
    });

    it("leaves the reporter's own fields empty", function () {
      const params = new URL(buildIssueUrl("bug", context())).searchParams;

      assert.isNull(params.get("what-happened"));
      assert.isNull(params.get("steps"));
      assert.isNull(params.get("area"));
    });

    it("omits debug-output entirely when there is no log", function () {
      const params = new URL(
        buildIssueUrl("bug", { ...context(), errorLog: "" }),
      ).searchParams;

      assert.isNull(params.get("debug-output"));
      assert.equal(params.get("zotero-version"), "7.0.15");
    });

    it("sends no diagnostics on the feature form", function () {
      const params = new URL(buildIssueUrl("feature")).searchParams;

      assert.isNull(params.get("debug-output"));
      assert.isNull(params.get("zotero-version"));
      assert.isNull(params.get("os"));
    });

    it("encodes a log containing newlines and quotes", function () {
      const url = buildIssueUrl("bug", {
        ...context(),
        errorLog: entry('boom "quoted"\n  at frame (a.ts:1:1)'),
      });

      assert.notInclude(url, "\n");
      assert.notInclude(url, '"');
      assert.include(
        new URL(url).searchParams.get("debug-output")!,
        "at frame (a.ts:1:1)",
      );
    });

    // The end-to-end regression case: collectErrorLog's own budget check has
    // to hold once buildIssueUrl actually serialises the result, for a log
    // adversarially built of the characters the two encoders disagree on.
    it("keeps the finished URL under GitHub's real ceiling for a log built entirely of URLSearchParams-expensive characters", function () {
      const log = collectErrorLog([entry("(x)".repeat(1900))], URL_BUDGET);
      const url = buildIssueUrl("bug", { ...context(), errorLog: log });

      // Measured unauthenticated: GitHub 302s a prefilled form up to ~6981
      // characters and answers 500 from ~7081, so MAX_ISSUE_URL_LENGTH's
      // margin below that has to survive the real serialisation, not just
      // collectErrorLog's own internal check.
      assert.isAtMost(url.length, MAX_ISSUE_URL_LENGTH);
    });

    // The realistic case: several Gecko-style multi-line stack traces, the
    // shape an actual uncaught exception or logFailure call produces, rather
    // than one adversarial string of repeated punctuation.
    it("keeps the finished URL under the ceiling for a realistic multi-entry Gecko stack log", function () {
      const frames = Array.from(
        { length: 12 },
        (_, i) =>
          `rebuildCanvas/<@file:///home/someone/Zotero/extensions/zoterotimeline@oekeur.github.io.xpi!/content/scripts/zoterotimeline.js:${1000 + i}:${i}`,
      ).join("\n");
      const entries = Array.from(
        { length: 25 },
        (_, i) =>
          `${entry(`timeline rebuild ${i}`)}\nTypeError: can't access property "x", y is undefined\n${frames}`,
      );

      const log = collectErrorLog(entries, URL_BUDGET);
      const url = buildIssueUrl("bug", { ...context(), errorLog: log });

      assert.isAtMost(url.length, MAX_ISSUE_URL_LENGTH);
      // Newest entries survive the drop, not an empty report.
      assert.include(log, "timeline rebuild 24");
    });
  });
});
