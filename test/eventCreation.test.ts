import { assert } from "chai";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";

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
    await Zotero.Promise.delay(1500);
    const doc = win.document as Document;
    const timeline = api.getCurrentTimeline();
    return { win, doc, timeline };
  }

  async function eventIdsByDoc(): Promise<Map<string, Set<string>>> {
    const { timelines } = await listTimelines(libraryID);
    return new Map(
      timelines.map((t) => [t.doc.id, new Set(t.doc.events.map((e) => e.id))]),
    );
  }

  it("creates an event in the clicked document's row, at the viewport's precision, and selects it", async function () {
    const { timeline } = await openCanvas();

    // Wide enough that year precision is the only honest reading - the whole
    // fixture (1566-1609) sits inside it with room to spare.
    timeline.setWindow("1400-01-01T00:00:00.000Z", "1900-01-01T00:00:00.000Z", {
      animation: false,
    });
    await Zotero.Promise.delay(500);

    const before = await eventIdsByDoc();

    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    await Zotero.Promise.delay(600);

    const after = await eventIdsByDoc();
    const beforeIds = before.get("doc-revolt") ?? new Set();
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
      .doc.events.find((e) => e.id === added[0])!;
    assert.match(
      created.date,
      /^\d{4}$/,
      `expected a year-only date at this zoom level, got ${created.date}`,
    );
    assert.isNotEmpty(created.title, "the new event has no title at all");

    // The write's own select-back opened the editor on the new event.
    assert.deepEqual(
      timeline.getSelection(),
      [`doc-revolt:${added[0]}`],
      "the newly created event was not selected after creation",
    );
  });

  it("authors a day-precision date when the viewport is zoomed in narrowly", async function () {
    const { timeline } = await openCanvas();

    timeline.setWindow("1607-04-01T00:00:00.000Z", "1607-05-01T00:00:00.000Z", {
      animation: false,
    });
    await Zotero.Promise.delay(500);

    const before = await eventIdsByDoc();

    timeline.emit("click", {
      item: null,
      group: "doc-sources",
      time: new Date(Date.UTC(1607, 3, 15)),
    });
    await Zotero.Promise.delay(600);

    const after = await eventIdsByDoc();
    const beforeIds = before.get("doc-sources") ?? new Set();
    const afterIds = after.get("doc-sources") ?? new Set();
    const added = [...afterIds].filter((id) => !beforeIds.has(id));
    assert.lengthOf(added, 1, "expected exactly one new event in doc-sources");

    const { timelines } = await listTimelines(libraryID);
    const created = timelines
      .find((t) => t.doc.id === "doc-sources")!
      .doc.events.find((e) => e.id === added[0])!;
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
