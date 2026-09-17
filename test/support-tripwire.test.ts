/**
 * Records, the moment an earlier spec leaves the plugin's own tab bookkeeping
 * disagreeing with what Zotero actually holds, the state that proves it, for
 * zzz-tripwire-report.test.ts to fail the run with at the very end.
 *
 * The invariant checked here is agreement, not "no tab open before every
 * spec": a tab Zotero holds must be the one the plugin's
 * timelineTabID/timelineTabWindow point at, the live notifier observer count
 * must equal 3 plus however many plugin tabs are open, getCurrentTimeline()
 * must be defined iff exactly one plugin tab is open, and the storage write
 * queue must be idle between specs. "No tab open before every spec" cannot be
 * the baseline: roughly a dozen spec files close the tab in their own
 * beforeEach rather than an afterEach, an intentional hand-off where one spec
 * leaves the tab open for the next to find and close, so a tripwire that
 * failed on any open tab would trip on that idiom itself rather than on an
 * actual leak. A leaked tab breaks agreement without breaking the hand-off:
 * module state cleared while the tab and its observer survive it (an
 * observer count of 4 with no tracked id), or a tab Zotero still holds that
 * the module's own bookkeeping can no longer find.
 *
 * The scaffold bundles every file under test/ into one esbuild output apiece,
 * but loads all of them as sibling <script> tags into one page and calls
 * mocha.setup() once before any of them, so every describe/it/hook call
 * across every file registers against a single Mocha instance. A beforeEach
 * declared here at the top level, outside any describe(), attaches to that
 * instance's root suite the same way it would attach to a suite if nested,
 * and a root-suite hook runs before every test in the run regardless of which
 * file declared it or which file the about-to-run test lives in. That is
 * mocha's own root-hook behaviour, not something this file adds; it was
 * confirmed by reading how zotero-plugin-scaffold's TestBundler and
 * generateHtml assemble the run before relying on it here.
 *
 * This beforeEach never throws. A failing root beforeEach makes mocha skip
 * every remaining spec in the run rather than just failing the one in front
 * of it: measured directly, a version of this file that threw truncated a
 * 537-spec run to 417 reported outcomes, silently dropping exactly the stress
 * logs it exists to annotate. Recording the first violation to a shared
 * record (see support-tripwire.ts) and letting every later spec run keeps the
 * rest of the suite's signal intact; zzz-tripwire-report.test.ts, sorted to
 * run last, is what turns a recorded violation into a failing run.
 *
 * Deliberately does not repair anything it finds wrong (no closeTimelineTab,
 * no window close): repairing the state would hide exactly the leak this
 * exists to surface, and silently paper over the cascade of unrelated
 * failures a leaked tab or window produces in every later tab-UI spec.
 */

import { getTripwireRecord, recordTripwireViolation } from "./support-tripwire";

const TAB_TYPE = "zoterotimeline-timeline";

let specIndex = 0;
let announcedRecorded = false;

interface OpenPluginTab {
  windowIndex: number;
  id: string;
}

function collectOpenPluginTabs(windows: any[]): OpenPluginTab[] {
  const openTabs: OpenPluginTab[] = [];
  windows.forEach((win, windowIndex) => {
    const tabs = (win.Zotero_Tabs?._tabs ?? []).filter(
      (tab: any) => tab.type === TAB_TYPE,
    );
    for (const tab of tabs) {
      openTabs.push({ windowIndex, id: tab.id });
    }
  });
  return openTabs;
}

async function assertSuiteBaseline(
  fullTitle: string,
  index: number,
): Promise<void> {
  if (getTripwireRecord() !== undefined) {
    if (!announcedRecorded) {
      announcedRecorded = true;
      Zotero.debug(
        "[zoteroTimeline] support-tripwire: a violation is already " +
          "recorded this run; skipping repeat checks so the log carries one " +
          "diagnosis instead of a cascade of the same one",
      );
    }
    return;
  }

  try {
    const api = (Zotero as any).ZoteroTimeline.api;
    const problems: string[] = [];

    const windows = Zotero.getMainWindows() as any[];
    if (windows.length !== 1) {
      const extras = windows
        .slice(1)
        .map((win, i) => `#${i + 1} "${win.document?.title}"`);
      problems.push(
        `expected exactly 1 main window, found ${windows.length}: extra ${extras.join(", ")}`,
      );
    }

    const openTabs = collectOpenPluginTabs(windows);
    if (openTabs.length > 1) {
      problems.push(
        `expected at most 1 open plugin tab, found ${openTabs.length}: ${openTabs
          .map((tab) => `window #${tab.windowIndex} id ${tab.id}`)
          .join(", ")}`,
      );
    }

    const tabState = api.timelineTabStateForTests();
    if (openTabs.length === 1) {
      const [openTab] = openTabs;
      if (
        tabState.tabId !== openTab.id ||
        tabState.windowIndex !== openTab.windowIndex
      ) {
        problems.push(
          `plugin bookkeeping disagrees with the open tab: Zotero holds tab ` +
            `${openTab.id} in window #${openTab.windowIndex}, the plugin's api ` +
            `reports tabId ${tabState.tabId} in window #${tabState.windowIndex}`,
        );
      }
    } else if (tabState.tabId !== undefined) {
      problems.push(
        `expected no tracked tab, but the plugin's api reports tabId ${tabState.tabId} ` +
          `in window #${tabState.windowIndex} with no matching open tab`,
      );
    }

    const observerCount = api.liveNotifierObserversForTests();
    const expectedObservers = 3 + openTabs.length;
    if (observerCount !== expectedObservers) {
      const ids = api.liveNotifierObserverIds?.();
      problems.push(
        `expected ${expectedObservers} live notifier observers (container guard, ` +
          `document cache, source prune, plus 1 per open plugin tab), found ${observerCount}` +
          (ids
            ? ` (ids: ${ids.join(", ")})`
            : " (observer ids not exposed on api)"),
      );
    }

    const currentTimeline = api.getCurrentTimeline();
    const timelineDefined =
      currentTimeline !== undefined && currentTimeline !== null;
    if (timelineDefined !== (openTabs.length === 1)) {
      problems.push(
        timelineDefined
          ? "getCurrentTimeline() returned a vis instance with no single open plugin tab for it"
          : "getCurrentTimeline() returned nothing despite one open plugin tab",
      );
    }

    const idle = await api.storageQueueIdleForTests(2000);
    if (idle !== true) {
      problems.push(
        "the storage write queue did not report idle within 2000ms",
      );
    }

    if (problems.length > 0) {
      const message = `state leaked by an earlier spec, measured just before "${fullTitle}": ${problems.join("; ")}`;
      recordTripwireViolation({ specTitle: fullTitle, message, index });
      announcedRecorded = true;
      Zotero.debug(`[zoteroTimeline] support-tripwire: ${message}`);
    }
  } catch (error) {
    // The check itself must never throw: a throwing root beforeEach makes
    // mocha skip every remaining spec in the run (see the file comment
    // above), which would silently drop the very stress logs this tripwire
    // exists to annotate. A broken check is itself a violation worth
    // reporting, so it goes through the same recording path as a measured
    // one instead of escaping the hook.
    const caught = error instanceof Error ? error : new Error(String(error));
    const stackHead = (caught.stack ?? "").split("\n").slice(0, 3).join("\n");
    const message =
      `the tripwire check itself threw, measured just before "${fullTitle}": ` +
      `${caught.name}: ${caught.message}` +
      (stackHead ? `\n${stackHead}` : "");
    recordTripwireViolation({ specTitle: fullTitle, message, index });
    announcedRecorded = true;
    Zotero.debug(`[zoteroTimeline] support-tripwire: ${message}`);
  }
}

// A top-level hook attaches to mocha's root suite and runs before every spec
// in every file, which is the point (see the file comment above).
// eslint-disable-next-line mocha/no-top-level-hooks -- deliberate, see above
beforeEach(async function () {
  specIndex += 1;
  await assertSuiteBaseline(
    this.currentTest?.fullTitle() ?? "<unknown spec>",
    specIndex,
  );
});

describe("support: suite baseline tripwire", function () {
  this.timeout(10000);

  it("baseline holds at suite start", async function () {
    // The root beforeEach above already ran this exact check for this spec;
    // rerunning it here gives mocha a spec of its own to report pass/fail on,
    // which is what makes the scaffold's file glob pick this file up at all.
    // It never fails this spec directly (assertSuiteBaseline only records),
    // which is why the run's failure signal is zzz-tripwire-report.test.ts,
    // not this one.
    await assertSuiteBaseline(this.test?.fullTitle() ?? "<unknown spec>", 0);
  });
});
