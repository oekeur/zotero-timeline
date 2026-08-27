import { assert } from "chai";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

// Click-to-create is driven through timeline.emit("click", props) rather
// than a real pointer gesture, for the same reason eventEditor.test.ts drives
// selection through timeline.setSelection() rather than a real click: a
// synthesised pointer gesture does not reliably satisfy vis-timeline's own
// Hammer-based gesture recogniser in this XUL window (confirmed empirically -
// dispatching a real PointerEvent tap directly on vis-timeline's own
// centerContainer, the exact element its ItemSet binds Hammer to, still never
// produced a "click" event here). emit() is the same call vis-timeline's own
// tap handler makes internally (`me.emit("click", me.getEventProperties(event))`
// in its Core constructor) - it is Emitter(Core.prototype), the same
// mechanism setSelection's wrapper in canvas.ts relies on for "select". This
// exercises this task's own code (the "click" handler in canvas.ts) exactly
// as vis-timeline would invoke it, without depending on Hammer recognising a
// synthetic gesture, which is this harness's limitation, not this feature's.
//
// Deleting is covered by eventEditor.test.ts's existing panel-button test
// (already-working code this task only had to verify, not rebuild).
describe("event creation on the canvas", function () {
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

  async function openCanvas(): Promise<{
    win: any;
    doc: Document;
    timeline: any;
  }> {
    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    await api.openTimelineTab();
    const doc = win.document as Document;
    const timeline = await waitFor(
      () => api.getCurrentTimeline(),
      "the timeline to render",
    );
    // vis-timeline runs its own initial fit-to-content shortly after
    // construction, on a deferred tick rather than synchronously. A
    // setWindow() call that lands before that deferred fit fires gets
    // silently overwritten once it does, so callers that are about to narrow
    // the viewport need the default window to have already settled first.
    await waitForStableWindow(timeline);
    return { win, doc, timeline };
  }

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

  async function setViewportWindow(
    timeline: any,
    start: string,
    end: string,
  ): Promise<void> {
    timeline.setWindow(start, end, { animation: false });
    // vis-timeline can still settle the window over a couple of internal
    // ticks even with animation off, and may snap to a slightly different
    // range than requested - waiting for it to stop changing is the real
    // condition, not an exact match against the request.
    await waitForStableWindow(timeline);
  }

  async function eventIdsByDoc(): Promise<Map<string, Set<string>>> {
    const { timelines } = await listTimelines(libraryID);
    return new Map(
      timelines.map((t) => [t.doc.id, new Set(t.doc.events.map((e) => e.id))]),
    );
  }

  /** Waits for exactly the effect a click-to-create drives: a new event id
   * landing in `docId`'s stored document. */
  async function waitForNewEvent(
    docId: string,
    beforeIds: Set<string>,
  ): Promise<string> {
    return waitFor(async () => {
      const ids = await eventIdsByDoc();
      const added = [...(ids.get(docId) ?? new Set())].filter(
        (id) => !beforeIds.has(id),
      );
      return added[0] ?? null;
    }, `a new event to appear in ${docId}`);
  }

  it("creates an event in the clicked document's row, at the viewport's precision, and selects it", async function () {
    const { timeline } = await openCanvas();

    // Wide enough that year precision is the only honest reading - the whole
    // fixture (1566-1609) sits inside it with room to spare.
    await setViewportWindow(
      timeline,
      "1400-01-01T00:00:00.000Z",
      "1900-01-01T00:00:00.000Z",
    );

    const before = await eventIdsByDoc();
    const beforeIds = before.get("doc-revolt") ?? new Set();

    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    const addedId = await waitForNewEvent("doc-revolt", beforeIds);

    const after = await eventIdsByDoc();
    const afterIds = after.get("doc-revolt") ?? new Set();
    const added = [...afterIds].filter((id) => !beforeIds.has(id));
    assert.lengthOf(
      added,
      1,
      `expected exactly one new event in doc-revolt, before=${JSON.stringify([...beforeIds])} after=${JSON.stringify([...afterIds])}`,
    );
    for (const [docId, ids] of after) {
      if (docId === "doc-revolt") continue;
      assert.deepEqual(
        ids,
        before.get(docId) ?? new Set(),
        `document ${docId} gained an event from a click aimed at doc-revolt`,
      );
    }

    const { timelines } = await listTimelines(libraryID);
    const created = timelines
      .find((t) => t.doc.id === "doc-revolt")!
      .doc.events.find((e) => e.id === addedId)!;
    assert.match(
      created.date,
      /^\d{4}$/,
      `expected a year-only date at this zoom level, got ${created.date}`,
    );
    assert.isNotEmpty(created.title, "the new event has no title at all");

    // The write's own select-back opened the editor on the new event - a
    // separate effect from the write landing in storage, so it needs its own
    // wait rather than assuming it is done by the time waitForNewEvent is.
    await waitFor(
      () =>
        timeline.getSelection().length === 1 &&
        timeline.getSelection()[0] === `doc-revolt:${addedId}`
          ? true
          : null,
      "the new event to be selected after creation",
    );
    assert.deepEqual(
      timeline.getSelection(),
      [`doc-revolt:${addedId}`],
      "the newly created event was not selected after creation",
    );
  });

  it("authors a day-precision date when the viewport is zoomed in narrowly", async function () {
    const { timeline } = await openCanvas();

    await setViewportWindow(
      timeline,
      "1607-04-01T00:00:00.000Z",
      "1607-05-01T00:00:00.000Z",
    );

    // doc-revolt loads first and starts as the active lane (TASK-16), so a
    // click aimed at doc-sources only activates it - the priming click AC7
    // requires - and needs a second click, now that doc-sources is active,
    // to actually create.
    timeline.emit("click", {
      item: null,
      group: "doc-sources",
      time: new Date(Date.UTC(1607, 3, 15)),
    });
    await Zotero.Promise.delay(300);

    const before = await eventIdsByDoc();
    const beforeIds = before.get("doc-sources") ?? new Set();

    timeline.emit("click", {
      item: null,
      group: "doc-sources",
      time: new Date(Date.UTC(1607, 3, 15)),
    });
    const addedId = await waitForNewEvent("doc-sources", beforeIds);

    const { timelines } = await listTimelines(libraryID);
    const created = timelines
      .find((t) => t.doc.id === "doc-sources")!
      .doc.events.find((e) => e.id === addedId)!;
    assert.match(
      created.date,
      /^\d{4}-\d{2}-\d{2}$/,
      `expected a day-precision date at this zoom level, got ${created.date}`,
    );
  });

  it("creates nothing when the click has no group", async function () {
    const { timeline } = await openCanvas();

    const before = await eventIdsByDoc();

    timeline.emit("click", {
      item: null,
      group: null,
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    // Asserting nothing gets created has no condition to poll for.
    await Zotero.Promise.delay(500);

    const after = await eventIdsByDoc();
    for (const [docId, ids] of after) {
      assert.deepEqual(
        ids,
        before.get(docId) ?? new Set(),
        `document ${docId} gained an event from a click with no group`,
      );
    }
    assert.deepEqual(
      timeline.getSelection(),
      [],
      "a click with no group should not select anything either",
    );
  });

  it("creates nothing when the click landed on an existing item", async function () {
    const { timeline } = await openCanvas();

    const before = await eventIdsByDoc();

    timeline.emit("click", {
      item: "doc-revolt:ev-fury",
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    // Asserting nothing gets created has no condition to poll for.
    await Zotero.Promise.delay(500);

    const after = await eventIdsByDoc();
    for (const [docId, ids] of after) {
      assert.deepEqual(
        ids,
        before.get(docId) ?? new Set(),
        `document ${docId} gained an event from a click that landed on an item`,
      );
    }
  });
});
