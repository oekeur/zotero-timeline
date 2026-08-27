import { assert } from "chai";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

// Attempts a real pan gesture on a selected item's drag handle and reads the
// onMove payload, then confirms the drag actually wrote back through
// updateTimelineDocument. `derivedDocumentId` (from the namespaced id) is what
// names the note to write, never `item.group` - vis-timeline does not
// guarantee it agrees, and this canvas has no cross-group drag
// (`updateGroup: false`) to force a live mismatch, so the strongest available
// proof here is that the write lands under the id-named document while
// `group` happens to agree too; onMove's own source is what actually
// forecloses reading `item.group` for the write (see canvas.ts).
describe("timeline drag payload", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    for (const doc of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, doc);
    }
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  async function truceEvent() {
    const { timelines } = await listTimelines(libraryID);
    return timelines
      .find((t) => t.doc.id === "doc-sources")!
      .doc.events.find((e) => e.id === "ev-truce")!;
  }

  // vis-timeline computes its initial fit-to-content from the container's
  // width at construction time. Zotero's own tab-switch is still animating
  // when the tab is added, so the container can still be mid-transition -
  // this is what the old fixed 1.5s delay was really buying before any
  // pixel-based read.
  async function waitForStableCanvasWidth(doc: Document): Promise<void> {
    let last: number | null = null;
    await waitFor(
      () => {
        const canvas = doc.getElementById("zoterotimeline-canvas");
        const width = canvas?.clientWidth ?? 0;
        const stable = last !== null && width === last && width > 0;
        last = width;
        return stable ? true : null;
      },
      "the canvas container's width to settle",
      { interval: 50, timeout: 3000 },
    );
  }

  // vis-timeline also runs its own initial fit-to-content on a deferred
  // tick after construction, independent of the container's own width -
  // waiting for the window it lands on to stop changing catches that too.
  async function waitForStableWindow(timeline: any): Promise<void> {
    let last: { start: number; end: number } | null = null;
    await waitFor(
      () => {
        const window = timeline.getWindow();
        const current = {
          start: window.start.getTime(),
          end: window.end.getTime(),
        };
        const stable =
          last !== null &&
          current.start === last.start &&
          current.end === last.end;
        last = current;
        return stable ? current : null;
      },
      "the viewport window to settle",
      { interval: 50 },
    );
  }

  async function openAndSelect(
    win: any,
    doc: Document,
    id: string,
  ): Promise<any> {
    const api = (Zotero as any).ZoteroTimeline.api;
    await api.openTimelineTab();
    const timeline = await waitFor(
      () => api.getCurrentTimeline(),
      "the timeline to render",
    );
    await waitForStableCanvasWidth(doc);
    await waitForStableWindow(timeline);
    timeline.setSelection([id]);
    return timeline;
  }

  // Pointer-event pacing, not effect-waiting - see canvasRangeRendering's
  // own drag() docblock for why this stays a fixed pace.
  function drag(
    win: any,
    handle: any,
    steps: number,
    stepPx: number,
  ): Promise<void> {
    const r = handle.getBoundingClientRect();
    let x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const PE = win.PointerEvent;

    function pointer(type: string, cx: number, up = false) {
      handle.dispatchEvent(
        new PE(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: cx,
          clientY: y,
          buttons: up ? 0 : 1,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
          view: win,
        }),
      );
    }

    return (async () => {
      pointer("pointerdown", x);
      await Zotero.Promise.delay(60);
      for (let i = 1; i <= steps; i++) {
        x += stepPx;
        pointer("pointermove", x);
        await Zotero.Promise.delay(40);
      }
      pointer("pointerup", x, true);
      await Zotero.Promise.delay(700);
    })();
  }

  it("reports the onMove payload for a dragged range item and writes it back", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    // The ranged item, so the payload can be checked for `end`.
    await openAndSelect(win, doc, "doc-sources:ev-truce");
    const handle = await waitFor(
      () => doc.querySelector(".vis-drag-center"),
      "the drag handle to render for the ranged item",
    );

    await drag(win, handle, 10, 14);

    const payload = api.getLastMovePayload?.();
    Zotero.debug(
      `[ZoteroTimeline][payload] ${JSON.stringify(payload ?? null)}`,
    );

    assert.ok(payload, "onMove never fired for a pan on the drag handle");

    assert.equal(payload.id, "doc-sources:ev-truce");
    assert.equal(payload.derivedDocumentId, "doc-sources");
    assert.isTrue(
      payload.hasEnd,
      `the ranged item reported no end: ${JSON.stringify(payload)}`,
    );

    // The write landed under doc-sources - the id-derived document - and both
    // endpoints moved (a body drag on .vis-drag-center), keeping the month
    // precision the original had.
    const updated = await truceEvent();
    assert.notEqual(
      updated.date,
      "1607-04/1609-04",
      "the drag did not change anything in storage",
    );
    assert.match(
      updated.date,
      /^\d{4}-\d{2}\/\d{4}-\d{2}$/,
      `expected a month-precision interval, got ${updated.date}`,
    );
    const [newLower, newUpper] = updated.date.split("/");
    assert.notEqual(newLower, "1607-04", "the start endpoint did not move");
    assert.notEqual(newUpper, "1609-04", "the end endpoint did not move");
  });

  it("resizes only the dragged edge, leaving the other endpoint untouched", async function () {
    this.timeout(60000);

    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await openAndSelect(win, doc, "doc-sources:ev-truce");
    const handle = await waitFor(
      () => doc.querySelector(".vis-drag-right"),
      "the right-edge drag handle to render",
    );

    await drag(win, handle, 6, 14);

    const updated = await truceEvent();
    assert.match(
      updated.date,
      /^\d{4}-\d{2}\/\d{4}-\d{2}$/,
      `expected a month-precision interval, got ${updated.date}`,
    );
    const [newLower, newUpper] = updated.date.split("/");
    assert.equal(
      newLower,
      "1607-04",
      "resizing the right edge moved the start endpoint",
    );
    assert.notEqual(newUpper, "1609-04", "the end endpoint did not move");
  });

  // Unlike the other two specs in this file, converting this one's waits
  // (the same openAndSelect plus a stability poll on the item's own rect)
  // passed on its own but failed the same deterministic way inside the full
  // suite every time - and the pre-conversion fixed-delay version of it,
  // run in that same isolated harness immediately afterward, passed
  // cleanly. That rules out load-driven flakiness as the explanation and
  // points at a real gap in the waitFor conversion's condition rather than
  // a masked product defect - not yet identified within this task's
  // budget, so this one stays on the fixed delay pending that
  // investigation.
  it("refuses the drag and leaves the canvas at its original position when the write fails", async function () {
    this.timeout(60000);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    const timeline = api.getCurrentTimeline();
    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(400);

    const handle = doc.querySelector(".vis-drag-center") as any;
    assert.ok(handle, "no drag handle after selecting the ranged item");
    const item = handle.closest(".vis-item") as HTMLElement;
    assert.ok(item, "no .vis-item ancestor of the drag handle");
    const before = item.getBoundingClientRect().left;

    // Forces the write to fail without touching Zotero's save machinery:
    // the note the canvas was rendered from is gone by the time onMove tries
    // to find it, so updateTimelineDocument throws "not-found" and onMove's
    // own catch runs. re-reading storage cannot tell an aborted write from a
    // completed one here (Zotero.Item.setNote mutates the in-memory item
    // before save() ever runs), so the assertion below is on the canvas
    // itself: does it end up back where it started, per vis-timeline's own
    // callback(null) revert.
    const { timelines } = await listTimelines(libraryID);
    const note = await Zotero.Items.getAsync(
      timelines.find((t) => t.doc.id === "doc-sources")!.noteItemID,
    );
    await (note as Zotero.Item).eraseTx();

    await drag(win, handle, 10, 14);

    const after = item.getBoundingClientRect().left;
    assert.approximately(
      after,
      before,
      2,
      `the item moved even though its write failed: before=${before} after=${after}`,
    );
  });
});
