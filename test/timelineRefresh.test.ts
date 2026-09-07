import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  serializeDocument,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  buildNoteHtml,
  updateTimelineDocument,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  createRawNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * The canvas redrawing when a note changes underneath it.
 *
 * Every assertion here is about a count rather than about pixels, because
 * what this task specifies is when a rebuild happens and when it is
 * suppressed, not what it draws. api.rebuildsSoFar() counts only rebuilds
 * that got past content-identity suppression, which is what makes "no rebuild
 * happened" distinguishable from "a rebuild ran and changed nothing".
 *
 * Own fixture throughout, the same reason timelineReadOnly.test.ts gives:
 * vis-timeline auto-fits to the data, so a shared fixture stretched by an
 * unrelated test breaks pixel assertions elsewhere in the suite.
 */
describe("refresh the canvas when a storage note changes underneath it", function () {
  this.timeout(60000);

  let libraryID: number;

  const api = () => (Zotero as any).ZoteroTimeline.api;

  function doc(name: string, events: TimelineDocument["events"]) {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id: `doc-${name}`,
      name,
      events,
    } as TimelineDocument;
  }

  const anEvent = (id: string, title: string, date: string) => ({
    id,
    title,
    date,
    sources: [],
    tags: [],
  });

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    api().closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    api().closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  async function openWithOneTimeline(): Promise<Zotero.Item> {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("refresh", [anEvent("ev-1", "First", "1600")]),
    );
    await api().openTimelineTab();
    await waitFor(() => api().getCurrentTimeline(), "the canvas to render");
    return note;
  }

  /**
   * Waits until no rebuild pass has run for a beat.
   *
   * The coalescing assertions below count passes across a burst they deliver
   * themselves, so a pass still in flight from the fixture would land in that
   * count and make it a race. Written as its own loop rather than through
   * waitFor: the condition is "the counter did not move since last look",
   * which needs state carried between polls and a poll interval wide enough
   * for a pass to show up in, and waitFor's contract is a side-effect-free
   * probe on a 20ms tick.
   */
  async function quiesce(): Promise<void> {
    const deadline = Date.now() + 15000;
    let last = -1;
    while (Date.now() < deadline) {
      const now = api().rebuildPassesSoFar();
      if (now === last) {
        return;
      }
      last = now;
      await Zotero.Promise.delay(250);
    }
    throw new Error("quiesce: the canvas never stopped rebuilding");
  }

  // AC #1
  it("redraws when a rendered timeline's note is written from outside the canvas", async function () {
    const note = await openWithOneTimeline();
    const before = api().rebuildsSoFar();

    // A write that does not go through the canvas at all, which is what an
    // edit in a second window or an incoming sync looks like from here.
    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("ev-2", "Second", "1700")],
      }),
      "doc-refresh",
      libraryID,
    );

    await waitFor(
      () => api().rebuildsSoFar() > before,
      "a rebuild after an outside write",
      { timeout: 15000 },
    );

    await waitFor(
      () =>
        (api().getVisibleTimelines() ?? []).some((t: any) =>
          t.doc.events.some((e: any) => e.id === "ev-2"),
        ),
      "the new event to reach what the tab has loaded",
      { timeout: 15000 },
    );
    assert.ok(note.id, "fixture note missing");
  });

  // AC #2. Both notifications Zotero fires per save are covered by driving
  // notify twice with the stored document unchanged: a flag cleared when the
  // write resolves would let the second one through, content identity does
  // not.
  it("does not rebuild when the stored document serialises identically to what is drawn", async function () {
    const note = await openWithOneTimeline();
    const before = api().rebuildsSoFar();

    const notify = api().refreshObserverForTesting();
    assert.ok(
      notify,
      "no canvas-refresh observer is registered; this spec would pass vacuously",
    );

    // Fire the same notification twice, as a real save does.
    notify("modify", "item", [note.id]);
    notify("modify", "item", [note.id]);

    // Nothing to poll for: this asserts an absence, so a fixed wait is the
    // honest way to express it (see waitFor's own docblock).
    await Zotero.Promise.delay(1500);
    assert.equal(
      api().rebuildsSoFar(),
      before,
      "an unchanged document still triggered a rebuild",
    );
  });

  // AC #3
  it("returns void from the observer, so a write started from inside it still completes", async function () {
    const note = await openWithOneTimeline();

    const notify = api().refreshObserverForTesting();
    assert.ok(notify, "no canvas-refresh observer is registered");

    const returned = notify("modify", "item", [note.id]);
    assert.isUndefined(
      returned,
      "the observer returned a value; Zotero awaits it inside the transaction commit and the write queue wedges",
    );

    // The queue still drains afterwards, which is the failure this guards.
    await updateTimelineDocument(
      (current) => ({
        ...current,
        name: "still writable",
      }),
      "doc-refresh",
      libraryID,
    );
    const stored = await waitFor(
      () =>
        (api().getVisibleTimelines() ?? []).find(
          (t: any) => t.doc.name === "still writable",
        ),
      "a write made after the notification to land",
      { timeout: 15000 },
    );
    assert.ok(stored, "the storage queue stopped draining after the observer");
  });

  /**
   * AC #4, as two specs because the single-flight has two halves and one count
   * cannot express both.
   *
   * The earlier form of this asserted that a burst raised rebuildsSoFar by
   * exactly two. Measured 2026-09-07 (TASK-65) with a per-pass trace of every
   * notify, schedule and rebuild: all five notifications arrive, the first
   * starts a pass and the other four set the dirty bit, and exactly one further
   * pass runs. Nothing is dropped. The counted delta lands on one because that
   * coalesced pass finds the canvas already current and suppresses itself,
   * which is correct. rebuildsSoFar counts only passes that redrew, so a delta
   * of one there is indistinguishable from four notifications being thrown
   * away, the exact failure the assertion existed to catch. Six consecutive
   * isolated runs gave a delta of one; the same spec passed under the full
   * suite, so it was pinning an interleaving rather than a guarantee.
   *
   * rebuildPassesSoFar counts every pass, suppressed ones included, so the
   * coalescing can be asserted directly. The property that a burst never leaves
   * the canvas stale is a separate assertion, below, because it is about what
   * is drawn rather than how many times.
   */
  it("collapses a burst of notifications into exactly one further rebuild pass", async function () {
    const note = await openWithOneTimeline();
    await quiesce();

    const notify = api().refreshObserverForTesting();
    assert.ok(notify, "no canvas-refresh observer is registered");

    const before = api().rebuildPassesSoFar();
    for (let i = 0; i < 5; i += 1) {
      notify("modify", "item", [note.id]);
    }

    // Nothing to poll for: the assertion is that no further pass runs, so a
    // fixed wait is the honest way to express it (see waitFor's docblock).
    await Zotero.Promise.delay(2500);
    const passes = api().rebuildPassesSoFar() - before;
    assert.equal(
      passes,
      2,
      `a burst of five notifications produced ${passes} rebuild passes; expected the first to start one and the other four to collapse into exactly one more`,
    );
  });

  // AC #4, the half that matters to a user: whatever order a burst and the
  // write that triggered it settle in, the canvas ends up showing the write.
  // This is what a dropped notification would break, and it is asserted
  // against what is drawn rather than against a count.
  it("leaves the canvas current when a burst lands during a rebuild", async function () {
    const note = await openWithOneTimeline();
    await quiesce();

    const notify = api().refreshObserverForTesting();
    assert.ok(notify, "no canvas-refresh observer is registered");

    // Bursts on both sides of the write, so the rebuild that reads stale
    // content and the rebuild that reads committed content both happen while
    // another is in flight.
    const write = updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("ev-burst", "Burst", "1800")],
      }),
      "doc-refresh",
      libraryID,
    );
    for (let i = 0; i < 5; i += 1) {
      notify("modify", "item", [note.id]);
    }
    await write;
    for (let i = 0; i < 5; i += 1) {
      notify("modify", "item", [note.id]);
    }

    await waitFor(
      () =>
        (api().getVisibleTimelines() ?? []).some((t: any) =>
          t.doc.events.some((e: any) => e.id === "ev-burst"),
        ),
      "the burst's write to reach the canvas",
      { timeout: 15000 },
    );
    assert.ok(note.id, "fixture note missing");
  });

  // AC #5
  it("leaves the previous render standing when a note stops parsing", async function () {
    const note = await openWithOneTimeline();
    const drawnBefore = (api().getVisibleTimelines() ?? []).length;
    assert.equal(drawnBefore, 1, "fixture did not render");

    // Corrupt the note behind the tab's back, then notify.
    await Zotero.DB.executeTransaction(async () => {
      note.setNote(buildNoteHtml({ not: "a timeline document" } as any));
      await note.save();
    });

    const before = api().rebuildsSoFar();
    api().refreshObserverForTesting()?.("modify", "item", [note.id]);

    await Zotero.Promise.delay(2000);
    assert.ok(
      api().getCurrentTimeline(),
      "the canvas was torn down by a note that stopped parsing",
    );
    // The real assertion. Merely surviving is not enough: redrawing without
    // the unreadable timeline would leave a live canvas with the timeline
    // gone, which is what "leaves the previous render standing" rules out.
    assert.equal(
      api().rebuildsSoFar(),
      before,
      "a note that stopped parsing still triggered a redraw",
    );
    const stillDrawn = (api().getVisibleTimelines() ?? []).some(
      (t: any) => t.doc.id === "doc-refresh",
    );
    assert.ok(
      stillDrawn,
      "the timeline vanished from the canvas when its note stopped parsing",
    );
  });

  // AC #8
  it("restores the active timeline and the selection a rebuild destroyed", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("first", [anEvent("a-1", "Alpha", "1600")]),
    );
    const second = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("second", [anEvent("b-1", "Beta", "1700")]),
    );
    await api().openTimelineTab();
    const timeline = await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    );

    // Make the second timeline active and select an event in it, then force a
    // rebuild by writing to the other one.
    (timeline as any).setSelection(["doc-second:b-1"]);
    await waitFor(
      () => api().getActiveTimeline() === "doc-second",
      "selecting an event to activate its lane",
      { timeout: 10000 },
    );

    const before = api().rebuildsSoFar();
    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("a-2", "Gamma", "1650")],
      }),
      "doc-first",
      libraryID,
    );
    await waitFor(
      () => api().rebuildsSoFar() > before,
      "a rebuild after writing to the other timeline",
      { timeout: 15000 },
    );

    assert.equal(
      api().getActiveTimeline(),
      "doc-second",
      "the rebuild disarmed the active lane, which reads as the canvas refusing edits",
    );
    const selection = (api().getCurrentTimeline() as any).getSelection();
    assert.deepEqual(
      selection,
      ["doc-second:b-1"],
      "the rebuild dropped the selection",
    );
    assert.ok(second.id, "fixture note missing");
  });

  // AC #6 is a measurement rather than a pass/fail, reported into the task's
  // notes. It is asserted only loosely here, so a rebuild becoming
  // catastrophically slow fails rather than merely being slow.
  it("rebuilds ten timelines within a budget, and reports the cost", async function () {
    for (let i = 0; i < 10; i += 1) {
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        doc(`bulk-${i}`, [
          anEvent(`e-${i}-1`, `Event ${i}a`, `${1600 + i * 10}`),
          anEvent(`e-${i}-2`, `Event ${i}b`, `${1605 + i * 10}`),
        ]),
      );
    }
    await api().openTimelineTab();
    await waitFor(() => api().getCurrentTimeline(), "the canvas to render", {
      timeout: 20000,
    });
    assert.lengthOf(
      api().getVisibleTimelines() ?? [],
      10,
      "the ten-timeline fixture did not all render",
    );

    const before = api().rebuildsSoFar();
    const started = Date.now();
    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("e-0-3", "Measured", "1599")],
      }),
      "doc-bulk-0",
      libraryID,
    );
    await waitFor(
      () => api().rebuildsSoFar() > before,
      "the measured rebuild to complete",
      { timeout: 30000 },
    );
    const elapsed = Date.now() - started;

    // Written to a file, not to Zotero.debug: the debug log belongs to the
    // test Zotero and dies with it, and a measurement nobody can read
    // afterwards is not a measurement. The path is fixed so a run can be
    // compared against the last one.
    Zotero.debug(
      `[ZoteroTimeline] AC6 measurement: rebuild of 10 timelines took ${elapsed}ms`,
    );
    try {
      await Zotero.File.putContentsAsync(
        "/tmp/zoterotimeline-ac6-rebuild-ms.txt",
        `${elapsed}\n`,
      );
    } catch {
      // A measurement that cannot be written must not fail the assertion below.
    }
    assert.isBelow(
      elapsed,
      15000,
      `rebuilding ten timelines took ${elapsed}ms, far past anything a redraw should cost`,
    );
  });

  it("keeps the serialised form stable, which the suppression depends on", function () {
    const d = doc("stable", [anEvent("s-1", "Stable", "1600")]);
    assert.equal(
      serializeDocument(d),
      serializeDocument(JSON.parse(JSON.stringify(d))),
      "a document that does not round-trip byte-identically breaks content-identity suppression",
    );
  });

  it("releases the canvas-refresh observer when the tab closes", async function () {
    await openWithOneTimeline();
    assert.ok(
      api().refreshObserverForTesting(),
      "no refresh observer while the tab is open",
    );

    api().closeTimelineTab();
    await waitFor(
      () => (api().refreshObserverForTesting() ? null : true),
      "the refresh observer to be released when the tab closes",
      { timeout: 10000 },
    );
  });

  it("does not rebuild for a modify notification about an unrelated item", async function () {
    await openWithOneTimeline();
    const unrelated = new Zotero.Item("book");
    unrelated.libraryID = libraryID;
    unrelated.setField("title", "Nothing to do with a timeline");
    await unrelated.saveTx();

    const before = api().rebuildsSoFar();
    unrelated.setField("title", "Still nothing to do with a timeline");
    await unrelated.saveTx();

    await Zotero.Promise.delay(1500);
    assert.equal(
      api().rebuildsSoFar(),
      before,
      "an unrelated item's edit redrew the canvas",
    );
    await unrelated.eraseTx();
  });

  it("ignores a raw note that is not one of ours", async function () {
    await openWithOneTimeline();
    const before = api().rebuildsSoFar();
    await createRawNote(libraryID, "zoterotimeline/not-a-real-tag", "<p>x</p>");
    await Zotero.Promise.delay(1500);
    assert.equal(
      api().rebuildsSoFar(),
      before,
      "a note outside this plugin's storage tag redrew the canvas",
    );
  });
});
