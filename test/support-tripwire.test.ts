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
 *
 * The root beforeEach itself never awaits anything. Under the stress harness,
 * an uncaught exception from a previous spec's detached async work can land
 * at any point mocha happens to be running code; if that point is inside an
 * `await` in this hook, mocha attributes the exception to the hook and aborts
 * the run the same way a throwing hook does, which is the same truncation the
 * try/catch above exists to prevent, just reached through a different door.
 * Every check this hook needs (windows, tabs, the plugin's own bookkeeping,
 * the observer count, `getCurrentTimeline()`) is a synchronous read; only the
 * storage queue check is genuinely async, so it runs detached, fire-and-await
 * nothing, with its own `.then`/`.catch` reporting back into the same
 * recording path once it resolves. A root `afterEach`, added below, catalogues
 * whatever any of this run's specs failed with, including the `undefined`
 * shaped ones this same truncation used to hide: see support-tripwire.ts's
 * `CatalogueEntry` for why that catalogue exists independently of this file's
 * own disagreement check.
 */

import {
  diffNewPluginErrors,
  getRawError,
  getTripwireRecord,
  installRawErrorCapture,
  recordCatalogueEntry,
  recordTripwireViolation,
} from "./support-tripwire";

installRawErrorCapture();

const TAB_TYPE = "zoterotimeline-timeline";
const SIDEBAR_ID = "zoterotimeline-sidebar";

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

/**
 * Plugin tab containers still in a window's tab deck that Zotero_Tabs no
 * longer lists. Zotero_Tabs.close() drops a tab from `_tabs` at once but
 * removes its container in a window setTimeout, so a container can
 * legitimately outlive its tab by a tick; the caller only records one still
 * there at the next spec boundary too. One that survives is a whole second
 * timeline UI in the document, and every lookup by element id finds whichever
 * copy comes first. It survives when the window's timers are suspended, which
 * closing a second main window has been measured to cause.
 */
function collectOrphanedPluginTabContainers(windows: any[]): string[] {
  const orphans: string[] = [];
  windows.forEach((win, windowIndex) => {
    const tabs = win.Zotero_Tabs;
    const listed = new Set((tabs?._tabs ?? []).map((tab: any) => tab.id));
    for (const child of Array.from<any>(tabs?.deck?.children ?? [])) {
      if (
        !listed.has(child.id) &&
        child.querySelector?.(`[id="${SIDEBAR_ID}"]`)
      ) {
        orphans.push(`${windowIndex}:${child.id}`);
      }
    }
  });
  return orphans;
}

// Orphans seen at the previous spec boundary, each with the spec it was first
// seen before.
let orphansSeenLastBoundary = new Map<string, string>();

function recordQueueViolation(
  fullTitle: string,
  index: number,
  message: string,
): void {
  if (getTripwireRecord() !== undefined) {
    return;
  }
  recordTripwireViolation({ specTitle: fullTitle, message, index });
  announcedRecorded = true;
  Zotero.debug(`[zoteroTimeline] support-tripwire: ${message}`);
}

function assertSuiteBaseline(fullTitle: string, index: number): void {
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

    const orphansNow = new Map<string, string>();
    for (const orphan of collectOrphanedPluginTabContainers(windows)) {
      const firstSeen = orphansSeenLastBoundary.get(orphan) ?? fullTitle;
      orphansNow.set(orphan, firstSeen);
      if (orphansSeenLastBoundary.has(orphan)) {
        const [windowIndex, id] = orphan.split(":");
        problems.push(
          `plugin tab container ${id} is still in window #${windowIndex}'s tab ` +
            `deck though Zotero_Tabs no longer lists it; first seen just before "${firstSeen}"`,
        );
      }
    }
    orphansSeenLastBoundary = orphansNow;

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

    if (problems.length > 0) {
      const message = `state leaked by an earlier spec, measured just before "${fullTitle}": ${problems.join("; ")}`;
      recordTripwireViolation({ specTitle: fullTitle, message, index });
      announcedRecorded = true;
      Zotero.debug(`[zoteroTimeline] support-tripwire: ${message}`);
    }

    // Detached deliberately: see the file comment above for why this hook
    // never awaits. `.then`/`.catch` route the result back into the same
    // recording path once the queue actually settles, up to 2s later.
    api
      .storageQueueIdleForTests(2000)
      .then((idle: boolean) => {
        if (idle !== true) {
          recordQueueViolation(
            fullTitle,
            index,
            `the storage write queue did not report idle within 2000ms, measured just before "${fullTitle}"`,
          );
        }
      })
      .catch((error: unknown) => {
        const caught =
          error instanceof Error ? error : new Error(String(error));
        const stackHead = (caught.stack ?? "")
          .split("\n")
          .slice(0, 3)
          .join("\n");
        recordQueueViolation(
          fullTitle,
          index,
          `the storage queue check itself threw, measured just before "${fullTitle}": ` +
            `${caught.name}: ${caught.message}` +
            (stackHead ? `\n${stackHead}` : ""),
        );
      });
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
beforeEach(function () {
  specIndex += 1;
  currentSpecTitle = this.currentTest?.fullTitle() ?? "<unknown spec>";
  assertSuiteBaseline(currentSpecTitle, specIndex);
});

/**
 * Records who asked Zotero to quit when that happens before the suite ends.
 *
 * A run that stops mid-suite shows only run-tests' "Zotero exited (code 0)
 * before printing a completion line", which cannot tell Zotero quitting on
 * request from the process being killed from outside. Gecko announces a quit
 * through quit-application-requested and quit-application; an observer on
 * both writes the requesting stack, the running spec and Zotero's last errors
 * to early-quit.txt in the test data directory, synchronously, since the
 * process is on its way out. run-tests.mjs prints that file when it reports
 * the missing completion line. No file means nothing inside Zotero asked to
 * quit, which points at an outside kill. The root after() hook below marks
 * the suite's own ending, so the scaffold's quit after a finished run writes
 * nothing.
 */
let currentSpecTitle = "<before the first spec>";
let suiteFinished = false;
let earlyQuitRecorded = false;

const earlyQuitObserver = {
  observe(_subject: unknown, topic: string, data: string) {
    if (suiteFinished || earlyQuitRecorded) {
      return;
    }
    earlyQuitRecorded = true;
    try {
      const errors = (Zotero.getErrors(true) as unknown[])
        .slice(-10)
        .map((entry) => String(entry).slice(0, 400));
      const report = [
        `topic: ${topic}`,
        `data: ${data}`,
        `spec: ${currentSpecTitle} (#${specIndex})`,
        `at: ${new Date().toISOString()}`,
        "stack:",
        new Error("quit requested").stack ?? "(no stack)",
        "last errors:",
        ...errors,
      ].join("\n");
      Zotero.File.putContents(
        Zotero.File.pathToFile(
          PathUtils.join(Zotero.DataDirectory.dir, "early-quit.txt"),
        ),
        report,
      );
    } catch (error) {
      Zotero.debug(
        `[zoteroTimeline] support-tripwire: recording an early quit failed: ${String(error)}`,
      );
    }
  },
};

for (const topic of ["quit-application-requested", "quit-application"]) {
  Services.obs.addObserver(earlyQuitObserver, topic);
}

// eslint-disable-next-line mocha/no-top-level-hooks -- deliberate, see above
after(function () {
  suiteFinished = true;
});

const MAX_STACK_LINES = 3;

/**
 * Catalogues whatever the just-finished spec failed with, text and all,
 * independently of this file's own disagreement check.
 *
 * Runs for every spec, not just failed ones: `diffNewPluginErrors()` has to
 * advance its snapshot every time so a passing spec's own log entries never
 * get attributed to whichever later spec happens to fail first (see its
 * doc comment in support-tripwire.ts).
 *
 * Never throws, for the same reason the beforeEach above never does: an
 * uncaught exception from a root-level hook makes mocha stop the run rather
 * than fail the one spec in front of it, which would truncate every spec
 * after whichever one first failed. Measured directly: an earlier version of
 * this hook let `Object.prototype.propertyIsEnumerable.call` see an
 * `undefined` err and threw, and the run stopped at 5 specs.
 */
// eslint-disable-next-line mocha/no-top-level-hooks -- deliberate, see above
afterEach(function () {
  const newPluginErrors = diffNewPluginErrors();
  if (this.currentTest?.state !== "failed") {
    return;
  }

  try {
    const err = getRawError(this.currentTest) as
      (Error & Record<string, unknown>) | undefined;
    const stackHead = String(err?.stack ?? "")
      .split("\n")
      .slice(0, MAX_STACK_LINES)
      .join("\n");

    recordCatalogueEntry({
      title: this.currentTest.fullTitle(),
      name: String(err?.name),
      message: String(err?.message),
      stackHead,
      messageWasEnumerable:
        err !== undefined &&
        Object.prototype.propertyIsEnumerable.call(err, "message"),
      newPluginErrors,
    });
  } catch (error) {
    // Cataloguing itself must never throw, for the same reason the check
    // above must never throw: a broken cataloguing step is itself a
    // violation worth reporting, via the same catalogue.
    const caught = error instanceof Error ? error : new Error(String(error));
    const stackHead = (caught.stack ?? "")
      .split("\n")
      .slice(0, MAX_STACK_LINES)
      .join("\n");
    Zotero.debug(
      `[zoteroTimeline] support-tripwire afterEach: cataloguing itself threw: ${caught.name}: ${caught.message}`,
    );
    recordCatalogueEntry({
      title: `support-tripwire afterEach, while cataloguing "${this.currentTest?.fullTitle() ?? "<unknown spec>"}"`,
      name: caught.name,
      message: caught.message,
      stackHead,
      messageWasEnumerable: Object.prototype.propertyIsEnumerable.call(
        caught,
        "message",
      ),
      newPluginErrors,
    });
  }
});

describe("support: suite baseline tripwire", function () {
  this.timeout(10000);

  it("baseline holds at suite start", function () {
    // The root beforeEach above already ran this exact check for this spec;
    // rerunning it here gives mocha a spec of its own to report pass/fail on,
    // which is what makes the scaffold's file glob pick this file up at all.
    // It never fails this spec directly (assertSuiteBaseline only records),
    // which is why the run's failure signal is zzz-tripwire-report.test.ts,
    // not this one.
    assertSuiteBaseline(this.test?.fullTitle() ?? "<unknown spec>", 0);
  });
});
