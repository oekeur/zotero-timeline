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

  // AC #4
  it("coalesces notifications arriving during a rebuild into exactly one further rebuild", async function () {
    const note = await openWithOneTimeline();

    // Change the note under the tab so each notification has real work, then
    // deliver a burst. One rebuild runs; the rest of the burst collapses into
    // exactly one more, so the count rises by two rather than by five.
    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("ev-burst", "Burst", "1800")],
      }),
      "doc-refresh",
      libraryID,
    );
    await waitFor(
      () => api().rebuildsSoFar() > 0,
      "the first rebuild to have run",
      { timeout: 15000 },
    );

    const before = api().rebuildsSoFar();
    const notify = api().refreshObserverForTesting();
    assert.ok(notify, "no canvas-refresh observer is registered");
    for (let i = 0; i < 5; i += 1) {
      notify("modify", "item", [note.id]);
    }

    await Zotero.Promise.delay(2500);
    const delta = api().rebuildsSoFar() - before;
    assert.isAtMost(
      delta,
      1,
      `a burst of five notifications produced ${delta} rebuilds; they should coalesce`,
    );
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

    api().refreshObserverForTesting()?.("modify", "item", [note.id]);

    await Zotero.Promise.delay(2000);
    assert.ok(
      api().getCurrentTimeline(),
      "the canvas was torn down by a note that stopped parsing",
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

    // Printed so the number lands in the run output and can be copied into the
    // task, since a measurement nobody reads is not a measurement.
    Zotero.debug(
      `[ZoteroTimeline] AC6 measurement: rebuild of 10 timelines took ${elapsed}ms (includes the write that triggered it)`,
    );
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
