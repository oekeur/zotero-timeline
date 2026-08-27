import { assert } from "chai";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  SIDEBAR_ROW_NAME_CLASS,
  SIDEBAR_ROW_VISIBLE_CLASS,
} from "../src/modules/timeline/timelineTab";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

// Exactly one visible timeline accepts write gestures, and which one is
// reachable by clicking a lane, an event in it, or (timelineTab.ts) its
// sidebar row - by pointer or by keyboard. doc-revolt loads before
// doc-sources (searchStorageNotes sorts by item id, i.e. creation order), so
// it is always the topmost group and therefore the one active by default.
describe("the active timeline (TASK-16)", function () {
  this.timeout(60000);

  let libraryID: number;
  let api: any;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
    api = (Zotero as any).ZoteroTimeline.api;
  });

  beforeEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    for (const document of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, document);
    }
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  async function openTab(): Promise<{
    win: any;
    doc: Document;
    sidebar: HTMLElement;
    timeline: any;
  }> {
    const win = Zotero.getMainWindows()[0] as any;
    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);
    const doc = win.document as Document;
    const sidebar = doc.getElementById("zoterotimeline-sidebar") as HTMLElement;
    const timeline = api.getCurrentTimeline();
    return { win, doc, sidebar, timeline };
  }

  function rowFor(sidebar: HTMLElement, documentId: string): HTMLElement {
    return sidebar.querySelector(
      `[data-timeline-id="${documentId}"]`,
    ) as HTMLElement;
  }

  // AC #1: exactly one active whenever at least one is visible, none when
  // none is, and a timeline coming back into view with nothing else active
  // picks it up - the same fallback AC #6 uses for a toggle-off, generalised
  // to "the active document is invalid" rather than special-cased to "just
  // got hidden".
  it("starts active on the topmost timeline, drops to none with nothing visible, and recovers on the next one shown", async function () {
    const { sidebar } = await openTab();
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    for (const id of ["doc-revolt", "doc-sources"]) {
      const checkbox = rowFor(sidebar, id).querySelector(
        `.${SIDEBAR_ROW_VISIBLE_CLASS}`,
      ) as HTMLInputElement;
      checkbox.click();
      await Zotero.Promise.delay(300);
    }
    assert.deepEqual(api.getVisibleTimelines(), []);
    assert.isNull(api.getActiveTimeline());

    const checkbox = rowFor(sidebar, "doc-sources").querySelector(
      `.${SIDEBAR_ROW_VISIBLE_CLASS}`,
    ) as HTMLInputElement;
    checkbox.click();
    await waitFor(
      () => api.getActiveTimeline() === "doc-sources",
      "doc-sources to become active once it is the only visible timeline",
    );
  });

  // AC #4 (lane), AC #7: a click on empty space in an inactive lane arms it
  // and writes nothing; the same click aimed at the now-active lane creates.
  it("a click on an inactive lane's empty space activates it and creates nothing; a second click then creates", async function () {
    const { timeline } = await openTab();
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    const before = (await listTimelines(libraryID)).timelines.find(
      (t) => t.doc.id === "doc-sources",
    )!.doc.events.length;

    timeline.emit("click", {
      item: null,
      group: "doc-sources",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    await Zotero.Promise.delay(400);

    assert.equal(
      api.getActiveTimeline(),
      "doc-sources",
      "the priming click did not activate the clicked lane",
    );
    const afterPriming = (await listTimelines(libraryID)).timelines.find(
      (t) => t.doc.id === "doc-sources",
    )!.doc.events.length;
    assert.equal(
      afterPriming,
      before,
      "the priming click on an inactive lane created an event",
    );

    timeline.emit("click", {
      item: null,
      group: "doc-sources",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    await waitFor(async () => {
      const count = (await listTimelines(libraryID)).timelines.find(
        (t) => t.doc.id === "doc-sources",
      )!.doc.events.length;
      return count === before + 1 ? true : null;
    }, "the second click on the now-active lane to create an event");
  });

  // AC #4 (event), composed with the "select" native event's own activation.
  it("selecting an event activates its lane", async function () {
    const { timeline } = await openTab();
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    timeline.setSelection(["doc-sources:ev-truce"]);
    await waitFor(
      () => api.getActiveTimeline() === "doc-sources",
      "selecting an event in doc-sources to activate it",
    );
  });

  // A real transition (not a no-op re-activation of the already-active lane)
  // deactivates the previously active group by clearing its className -
  // vis-timeline@8.5.4's own Group.setData throws when that value coerces to
  // null (addClassName has no guard for it), so this exercises the exact
  // path a stale className handling would crash. Round-tripping twice proves
  // it survives repeated deactivation, not just the first one.
  it("switching activation back and forth between two lanes never throws, and moves the DOM lane marker with it", async function () {
    const { doc, timeline } = await openTab();

    // vis's own group label carries no data-timeline-id (that is the
    // sidebar row's own attribute, timelineTab.ts) - the group's name, set
    // from the document's own name at render time, is what identifies it.
    const laneNames: Record<string, string> = {
      "doc-revolt": "Dutch Revolt",
      "doc-sources": "Source production",
    };
    function laneClasses(documentId: string): DOMTokenList {
      const labels = Array.from(
        doc.querySelectorAll(".vis-labelset .vis-label"),
      ) as HTMLElement[];
      const label = labels.find(
        (el) => el.textContent === laneNames[documentId],
      );
      assert.ok(label, `no lane label found for ${documentId}`);
      return label!.classList;
    }

    assert.isTrue(laneClasses("doc-revolt").contains("zt-lane-active"));
    assert.isFalse(laneClasses("doc-sources").contains("zt-lane-active"));

    timeline.setSelection(["doc-sources:ev-truce"]);
    await waitFor(
      () => api.getActiveTimeline() === "doc-sources",
      "selecting doc-sources' event to activate it",
    );
    assert.isTrue(laneClasses("doc-sources").contains("zt-lane-active"));
    assert.isFalse(laneClasses("doc-revolt").contains("zt-lane-active"));

    timeline.setSelection(["doc-revolt:ev-fury"]);
    await waitFor(
      () => api.getActiveTimeline() === "doc-revolt",
      "selecting doc-revolt's event to reactivate it",
    );
    assert.isTrue(laneClasses("doc-revolt").contains("zt-lane-active"));
    assert.isFalse(laneClasses("doc-sources").contains("zt-lane-active"));
  });

  // AC #4 (sidebar row), AC #11 (keyboard).
  it("clicking a sidebar row's label activates its timeline, and so does Enter or Space when the row itself has focus", async function () {
    const { doc, sidebar } = await openTab();
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    const sourcesName = rowFor(sidebar, "doc-sources").querySelector(
      `.${SIDEBAR_ROW_NAME_CLASS}`,
    ) as HTMLElement;
    sourcesName.click();
    await waitFor(
      () => api.getActiveTimeline() === "doc-sources",
      "clicking the doc-sources row's label to activate it",
    );

    const revoltRow = rowFor(sidebar, "doc-revolt");
    revoltRow.focus();
    assert.equal(
      doc.activeElement,
      revoltRow,
      "focus() did not land on the row",
    );
    revoltRow.dispatchEvent(
      new (doc.defaultView as any).KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    await waitFor(
      () => api.getActiveTimeline() === "doc-revolt",
      "Enter on the focused doc-revolt row to activate it",
    );
  });

  // AC #5: the checkbox is the one control inside a row that must never also
  // activate - toggling a reference chronology into view is the ordinary
  // gesture this rule protects.
  it("toggling a timeline on through its row's checkbox does not change which timeline is active", async function () {
    const { sidebar } = await openTab();

    const sourcesCheckbox = rowFor(sidebar, "doc-sources").querySelector(
      `.${SIDEBAR_ROW_VISIBLE_CLASS}`,
    ) as HTMLInputElement;
    sourcesCheckbox.click();
    await Zotero.Promise.delay(300);
    assert.equal(
      api.getActiveTimeline(),
      "doc-revolt",
      "hiding the inactive doc-sources moved activation",
    );

    // Re-query: renderSidebar() rebuilds every row on each toggle.
    const sourcesCheckboxAfter = rowFor(sidebar, "doc-sources").querySelector(
      `.${SIDEBAR_ROW_VISIBLE_CLASS}`,
    ) as HTMLInputElement;
    sourcesCheckboxAfter.click();
    await Zotero.Promise.delay(300);
    assert.equal(
      api.getActiveTimeline(),
      "doc-revolt",
      "toggling doc-sources back on stole activation from doc-revolt",
    );
  });

  // AC #6.
  it("toggling the active timeline off moves activation to the topmost still-visible timeline", async function () {
    const { sidebar } = await openTab();
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    const revoltCheckbox = rowFor(sidebar, "doc-revolt").querySelector(
      `.${SIDEBAR_ROW_VISIBLE_CLASS}`,
    ) as HTMLInputElement;
    revoltCheckbox.click();

    await waitFor(
      () => api.getActiveTimeline() === "doc-sources",
      "activation to fall back to doc-sources once doc-revolt is hidden",
    );
  });

  // AC #9: unchanged with only one timeline visible - no priming click is
  // needed because the sole visible lane is already the active one.
  it("with exactly one timeline visible, a single click still creates immediately", async function () {
    const { sidebar, timeline } = await openTab();

    const sourcesCheckbox = rowFor(sidebar, "doc-sources").querySelector(
      `.${SIDEBAR_ROW_VISIBLE_CLASS}`,
    ) as HTMLInputElement;
    sourcesCheckbox.click();
    await Zotero.Promise.delay(300);
    assert.deepEqual(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      ["doc-revolt"],
    );
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    const before = (await listTimelines(libraryID)).timelines.find(
      (t) => t.doc.id === "doc-revolt",
    )!.doc.events.length;

    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    await waitFor(async () => {
      const count = (await listTimelines(libraryID)).timelines.find(
        (t) => t.doc.id === "doc-revolt",
      )!.doc.events.length;
      return count === before + 1 ? true : null;
    }, "a single click on the only visible, already-active lane to create an event");
  });

  // AC #3: the per-item flag, not a global option - read directly off
  // itemsData rather than through a selection gesture, since selecting an
  // item is itself an activating gesture and would confound the two.
  it("only the active lane's items are marked editable, through the per-item flag", async function () {
    const { timeline } = await openTab();
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    assert.isTrue(timeline.itemsData.get("doc-revolt:ev-fury").editable);
    assert.strictEqual(
      timeline.itemsData.get("doc-sources:ev-pamphlets").editable,
      false,
    );

    timeline.setSelection(["doc-sources:ev-truce"]);
    await waitFor(
      () => api.getActiveTimeline() === "doc-sources",
      "selecting the doc-sources item to activate it",
    );

    assert.strictEqual(
      timeline.itemsData.get("doc-revolt:ev-fury").editable,
      false,
      "doc-revolt kept its drag handles after losing activation",
    );
    assert.isTrue(
      timeline.itemsData.get("doc-sources:ev-pamphlets").editable,
      "doc-sources did not gain drag handles once it became active",
    );
  });

  // AC #8: a parked event refuses a drag handle regardless of activation -
  // non-editable wins wherever either reason applies, and activating a
  // parked event's own lane must not override its own non-editability.
  it("a parked event in the active lane still carries no drag handle", async function () {
    const parkedDoc: TimelineDocument = {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-parked-active",
      name: "Parked",
      events: [
        {
          id: "ev-broken",
          title: "Broken",
          date: "not-a-date",
          sources: [],
          tags: [],
        },
      ],
    };
    await createDocumentNote(libraryID, STORAGE_TAG, parkedDoc);

    const { sidebar, timeline } = await openTab();

    const row = rowFor(sidebar, "doc-parked-active").querySelector(
      `.${SIDEBAR_ROW_NAME_CLASS}`,
    ) as HTMLElement;
    row.click();
    await waitFor(
      () => api.getActiveTimeline() === "doc-parked-active",
      "activating the parked event's own lane",
    );

    assert.strictEqual(
      timeline.itemsData.get("doc-parked-active:ev-broken").editable,
      false,
      "a parked event became editable once its own lane was activated",
    );
  });

  // AC #2: the write lands under the id-derived document while every other
  // loaded document's note is untouched, mtime included - proven with two
  // timelines visible so the ambiguity this task exists to remove is live.
  it("a drag in one document leaves every other document's note untouched, mtime included", async function () {
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document;

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);
    const timeline = api.getCurrentTimeline();
    assert.equal(api.getActiveTimeline(), "doc-revolt");

    const before = await listTimelines(libraryID);
    const revoltNote = (await Zotero.Items.getAsync(
      before.timelines.find((t) => t.doc.id === "doc-revolt")!.noteItemID,
    )) as Zotero.Item;
    const revoltModifiedBefore = revoltNote.dateModified;

    timeline.setSelection(["doc-sources:ev-truce"]);
    await waitFor(
      () => api.getActiveTimeline() === "doc-sources",
      "selecting doc-sources' event to activate its lane",
    );
    await Zotero.Promise.delay(300);

    const handle = doc.querySelector(".vis-drag-center") as any;
    assert.ok(handle, "no drag handle on the now-active doc-sources item");
    const r = handle.getBoundingClientRect();
    let x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const PE = win.PointerEvent;
    const pointer = (type: string, cx: number, up = false) =>
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
    pointer("pointerdown", x);
    await Zotero.Promise.delay(60);
    for (let i = 0; i < 10; i++) {
      x += 14;
      pointer("pointermove", x);
      await Zotero.Promise.delay(40);
    }
    pointer("pointerup", x, true);
    await Zotero.Promise.delay(700);

    const after = await listTimelines(libraryID);
    const sourcesAfter = after.timelines.find(
      (t) => t.doc.id === "doc-sources",
    )!.doc;
    const truceAfter = sourcesAfter.events.find((e) => e.id === "ev-truce")!;
    assert.notEqual(
      truceAfter.date,
      "1607-04/1609-04",
      "the drag on the active lane's item did not write back",
    );

    const revoltNoteAfter = (await Zotero.Items.getAsync(
      revoltNote.id,
    )) as Zotero.Item;
    assert.equal(
      revoltNoteAfter.dateModified,
      revoltModifiedBefore,
      "dragging in doc-sources touched doc-revolt's own note",
    );
    const revoltAfter = after.timelines.find(
      (t) => t.doc.id === "doc-revolt",
    )!.doc;
    assert.deepEqual(
      revoltAfter.events,
      before.timelines.find((t) => t.doc.id === "doc-revolt")!.doc.events,
      "dragging in doc-sources changed doc-revolt's own events",
    );
  });
});
