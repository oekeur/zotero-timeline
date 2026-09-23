import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  buildNoteHtml,
  updateTimelineDocument,
} from "../src/modules/timeline/storage";
import {
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_MOVE_UP_CLASS,
  SIDEBAR_ROW_NAME_CLASS,
  SIDEBAR_ROW_UNREADABLE_CLASS,
} from "../src/modules/timeline/timelineTab";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * The previous-render-standing rule used to return out of rebuildCanvas the
 * instant any drawn note stopped parsing, before the rest of the rebuild ran.
 * That froze every other timeline in the tab too, erasure included: it took
 * repairing the broken note or reopening the tab to bring a sibling's change
 * back. The rule now substitutes the standing note's last-good content into
 * the fresh list and falls through into the ordinary rebuild, so a standing
 * note keeps its own last drawn content while every other timeline keeps
 * updating around it.
 */
describe("a standing unreadable note no longer blocks a sibling's rebuild", function () {
  this.timeout(60000);

  let libraryID: number;

  const api = () => (Zotero as any).ZoteroTimeline.api;

  function doc(id: string, name: string, events: TimelineDocument["events"]) {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id,
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

  function rowNamed(name: string): Element | null {
    const win = Zotero.getMainWindows()[0] as any;
    const sidebar = win.document.getElementById("zoterotimeline-sidebar");
    if (!sidebar) {
      return null;
    }
    return (
      (
        Array.from(
          sidebar.querySelectorAll(`.${SIDEBAR_ROW_NAME_CLASS}`),
        ) as HTMLElement[]
      )
        .find((el) => el.textContent === name)
        ?.closest(`.${SIDEBAR_ROW_CLASS}`) ?? null
    );
  }

  function unreadableRowCount(): number {
    const win = Zotero.getMainWindows()[0] as any;
    const sidebar = win.document.getElementById("zoterotimeline-sidebar");
    if (!sidebar) {
      return 0;
    }
    return sidebar.querySelectorAll(`.${SIDEBAR_ROW_UNREADABLE_CLASS}`).length;
  }

  // Only a genuine document row carries data-timeline-id; buildUnreadableRow's
  // marker row does not, so this reads the lane order the sidebar actually
  // draws rather than being thrown off by the separate warning row a standing
  // note also gets.
  function sidebarRowIds(): string[] {
    const win = Zotero.getMainWindows()[0] as any;
    const sidebar = win.document.getElementById("zoterotimeline-sidebar");
    if (!sidebar) {
      return [];
    }
    return Array.from(
      sidebar.querySelectorAll(`.${SIDEBAR_ROW_CLASS}[data-timeline-id]`),
    ).map((el) => (el as HTMLElement).getAttribute("data-timeline-id")!);
  }

  function moveRowUp(documentId: string): void {
    const win = Zotero.getMainWindows()[0] as any;
    const sidebar = win.document.getElementById("zoterotimeline-sidebar");
    const row = sidebar?.querySelector(
      `[data-timeline-id="${documentId}"]`,
    ) as HTMLElement | null;
    const moveUp = row?.querySelector(
      `.${SIDEBAR_ROW_MOVE_UP_CLASS}`,
    ) as HTMLButtonElement | null;
    moveUp?.click();
  }

  async function standUnreadable(
    note: Zotero.Item,
    lastGood: TimelineDocument,
  ): Promise<void> {
    await Zotero.DB.executeTransaction(async () => {
      note.setNote(
        buildNoteHtml({
          ...lastGood,
          version: CURRENT_SCHEMA_VERSION + 1,
        } as TimelineDocument),
      );
      await note.save();
    });
    api().refreshObserverForTesting()?.("modify", "item", [note.id]);
    await waitFor(
      () => unreadableRowCount() === 1,
      "X to be marked unreadable and stand on its last-good content",
    );
  }

  it("erases a sibling timeline outright, removing its row and lane, while a standing unreadable note stays drawn", async function () {
    const xDoc = doc("doc-x", "X", [anEvent("ev-x1", "X One", "1600")]);
    const yDoc = doc("doc-y", "Y", [anEvent("ev-y1", "Y One", "1700")]);
    const xNote = await createDocumentNote(libraryID, STORAGE_TAG, xDoc);
    const yNote = await createDocumentNote(libraryID, STORAGE_TAG, yDoc);

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );

    await standUnreadable(xNote, xDoc);
    assert.ok(
      (api().getVisibleTimelines() ?? []).some(
        (t: any) => t.doc.id === "doc-x",
      ),
      "X's lane vanished instead of the previous render standing",
    );

    await yNote.eraseTx();

    await waitFor(
      () => rowNamed("Y") === null,
      "Y's row to disappear once erased outright, without reopening the tab",
    );
    assert.isFalse(
      (api().getVisibleTimelines() ?? []).some(
        (t: any) => t.doc.id === "doc-y",
      ),
      "Y's lane is still listed after being erased outright",
    );
    assert.isNotNull(
      rowNamed("X"),
      "X's row disappeared even though a standing unreadable note must keep its own row",
    );
    assert.ok(
      (api().getVisibleTimelines() ?? []).some(
        (t: any) =>
          t.doc.id === "doc-x" &&
          t.doc.events.some((e: any) => e.id === "ev-x1"),
      ),
      "X's standing content was disturbed by Y's erasure",
    );
  });

  it("draws an outside write to a sibling's events while a standing unreadable note stays drawn", async function () {
    const xDoc = doc("doc-x", "X", [anEvent("ev-x1", "X One", "1600")]);
    const yDoc = doc("doc-y", "Y", [anEvent("ev-y1", "Y One", "1700")]);
    const xNote = await createDocumentNote(libraryID, STORAGE_TAG, xDoc);
    await createDocumentNote(libraryID, STORAGE_TAG, yDoc);

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );

    await standUnreadable(xNote, xDoc);

    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("ev-y2", "Y Two", "1750")],
      }),
      "doc-y",
      libraryID,
    );

    await waitFor(
      () =>
        (api().getVisibleTimelines() ?? []).some(
          (t: any) =>
            t.doc.id === "doc-y" &&
            t.doc.events.some((e: any) => e.id === "ev-y2"),
        ),
      "Y's outside write to reach the canvas while X stands unreadable",
    );
    assert.ok(
      (api().getVisibleTimelines() ?? []).some(
        (t: any) =>
          t.doc.id === "doc-x" &&
          t.doc.events.some((e: any) => e.id === "ev-x1"),
      ),
      "X's standing content was disturbed by Y's rebuild",
    );
  });

  // restoreCanvasState only becomes reachable on this path once the
  // substituted rebuild actually redraws, which needs a real change
  // elsewhere - a no-op pass (nothing changed) stays on the cheap
  // drawnMatches path and never reaches it at all.
  it("keeps a standing note's own selection across a rebuild triggered by a sibling's outright erasure", async function () {
    const xDoc = doc("doc-x", "X", [anEvent("ev-x1", "X One", "1600")]);
    const yDoc = doc("doc-y", "Y", [anEvent("ev-y1", "Y One", "1700")]);
    const xNote = await createDocumentNote(libraryID, STORAGE_TAG, xDoc);
    const yNote = await createDocumentNote(libraryID, STORAGE_TAG, yDoc);

    await api().openTimelineTab();
    const timeline = await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    );
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );

    await standUnreadable(xNote, xDoc);

    (timeline as any).setSelection(["doc-x:ev-x1"]);
    await waitFor(
      () =>
        JSON.stringify((timeline as any).getSelection()) ===
        JSON.stringify(["doc-x:ev-x1"]),
      "the selection to land on X's event before the sibling is erased",
    );

    await yNote.eraseTx();
    await waitFor(
      () =>
        !(api().getVisibleTimelines() ?? []).some(
          (t: any) => t.doc.id === "doc-y",
        ),
      "Y's erasure to reach the canvas, which is what runs the substituted rebuild this spec pins",
    );

    // X's substituted document is byte-identical to what was drawn before
    // the erase, so the event `restoreCanvasState`'s document-level presence
    // filter is asked about genuinely still exists under the fresh render;
    // the selection survives rather than being dropped.
    const selection = (api().getCurrentTimeline() as any).getSelection();
    assert.deepEqual(
      selection,
      ["doc-x:ev-x1"],
      "X's own selection did not survive the rebuild triggered by Y's erasure",
    );
  });

  // Substituting a standing note's last-good content into fresh.timelines
  // used to push it to the end of that list, and renderCanvas ranks every
  // lane by its index there - so a note arriving after B started standing
  // took the lane order slot B used to hold, restoreCanvasState re-stamped
  // that same number onto B, and the two lanes' shared order collapsed B to
  // the bottom of both the canvas and the sidebar.
  it("keeps a standing note's lane and row in place when a new timeline arrives, and after repair", async function () {
    const aDoc = doc("doc-a", "A", [anEvent("ev-a1", "A One", "1600")]);
    const bDoc = doc("doc-b", "B", [anEvent("ev-b1", "B One", "1650")]);
    await createDocumentNote(libraryID, STORAGE_TAG, aDoc);
    const bNote = await createDocumentNote(libraryID, STORAGE_TAG, bDoc);

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );

    await standUnreadable(bNote, bDoc);

    const cDoc = doc("doc-c", "C", [anEvent("ev-c1", "C One", "1700")]);
    await createDocumentNote(libraryID, STORAGE_TAG, cDoc);

    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 3,
      "C's arrival to draw a third lane alongside the standing note",
    );

    assert.deepEqual(
      (api().getVisibleTimelines() ?? []).map((t: any) => t.doc.id),
      ["doc-a", "doc-b", "doc-c"],
      "B's lane moved out of place when C arrived while B stood unreadable",
    );
    assert.deepEqual(
      sidebarRowIds(),
      ["doc-a", "doc-b", "doc-c"],
      "B's sidebar row moved out of place when C arrived while B stood unreadable",
    );

    await Zotero.DB.executeTransaction(async () => {
      bNote.setNote(buildNoteHtml(bDoc));
      await bNote.save();
    });
    api().refreshObserverForTesting()?.("modify", "item", [bNote.id]);
    await waitFor(
      () => unreadableRowCount() === 0,
      "B to repair and clear its unreadable marker",
    );

    assert.deepEqual(
      (api().getVisibleTimelines() ?? []).map((t: any) => t.doc.id),
      ["doc-a", "doc-b", "doc-c"],
      "repairing B did not restore the lane order the collision scrambled",
    );
    assert.deepEqual(
      sidebarRowIds(),
      ["doc-a", "doc-b", "doc-c"],
      "repairing B did not restore the sidebar row order the collision scrambled",
    );
  });

  // A user's own lane reorder must survive a substituted rebuild exactly the
  // way a standing note's position does - restoreCanvasState renumbers every
  // present lane from one shared pass, so both invariants have to hold at
  // once rather than trading one for the other.
  it("keeps a user's own lane reorder across a rebuild that substitutes a standing note", async function () {
    const aDoc = doc("doc-a", "A", [anEvent("ev-a1", "A One", "1600")]);
    const bDoc = doc("doc-b", "B", [anEvent("ev-b1", "B One", "1650")]);
    await createDocumentNote(libraryID, STORAGE_TAG, aDoc);
    const bNote = await createDocumentNote(libraryID, STORAGE_TAG, bDoc);

    await api().openTimelineTab();
    await waitFor(
      () => (api().getVisibleTimelines() ?? []).length === 2,
      "both fixture timelines to render before either is touched",
    );
    assert.deepEqual(
      (api().getVisibleTimelines() ?? []).map((t: any) => t.doc.id),
      ["doc-a", "doc-b"],
      "unexpected initial visible order",
    );

    moveRowUp("doc-b");
    await waitFor(
      () =>
        (api().getVisibleTimelines() ?? [])[0]?.doc.id === "doc-b"
          ? true
          : null,
      "B to move to the front of the visible order",
    );

    await standUnreadable(bNote, bDoc);
    assert.deepEqual(
      (api().getVisibleTimelines() ?? []).map((t: any) => t.doc.id),
      ["doc-b", "doc-a"],
      "B standing unreadable moved the user's own reorder",
    );

    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("ev-a2", "A Two", "1750")],
      }),
      "doc-a",
      libraryID,
    );

    await waitFor(
      () =>
        (api().getVisibleTimelines() ?? []).some(
          (t: any) =>
            t.doc.id === "doc-a" &&
            t.doc.events.some((e: any) => e.id === "ev-a2"),
        ),
      "A's outside write to reach the canvas while B stands unreadable",
    );

    assert.deepEqual(
      (api().getVisibleTimelines() ?? []).map((t: any) => t.doc.id),
      ["doc-b", "doc-a"],
      "the substituted rebuild discarded the user's own lane reorder",
    );
  });
});
