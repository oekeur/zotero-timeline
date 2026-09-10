import { assert } from "chai";
import {
  CREATE_BUTTON_CLASS,
  CREATE_DATE_INPUT_CLASS,
  CREATE_DOCUMENT_SELECT_CLASS,
  CREATE_SOURCE_ITEM_CLASS,
  CREATE_TITLE_INPUT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import { labelForItem } from "../src/modules/timeline/sourceLabels";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  listTimelines,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

// documentNamed (support-pluginItems.ts) always seeds one event; these tests
// need a document that starts with none, so its own event ends up the only
// one written, unambiguously.
function emptyDocument(name: string, id: string): TimelineDocument {
  return { version: CURRENT_SCHEMA_VERSION, id, name, events: [] };
}

// Driven through Zotero.ZoteroTimeline.api.openCreateEventOnTimeline, the
// same entry point the library context menu's "add to new event" action
// calls once it has resolved the selection and the chosen timeline -
// libraryContextMenu.test.ts and addSourcesDialog.test.ts test that
// resolution one layer below the real XUL popup for the same reason this
// does: driving an actual right-click popup is not practical in this
// harness.
describe("add to new event, from the library context menu", function () {
  this.timeout(60000);

  let libraryID: number;
  let api: any;
  let win: any;
  let extras: Zotero.Item[];

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
    api = (Zotero as any).ZoteroTimeline.api;
    win = Zotero.getMainWindows()[0];
  });

  beforeEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    extras = [];
  });

  afterEach(async function () {
    api.closeTimelineTab();
    for (const item of extras) {
      await item.eraseTx();
    }
    // Waits for any write a Create click started before erasing - otherwise
    // it can land after eraseAllPluginItems runs and recreate a container
    // this test's cleanup just removed.
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
  });

  async function savedItem(title: string): Promise<Zotero.Item> {
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", title);
    await item.saveTx();
    extras.push(item);
    return item;
  }

  async function openPanel(): Promise<HTMLElement> {
    return (await waitFor(
      () => win.document.getElementById("zoterotimeline-editor"),
      "the editor panel to render",
    )) as HTMLElement;
  }

  async function eventsOn(documentId: string) {
    const { timelines } = await listTimelines(libraryID);
    return timelines.find((t) => t.doc.id === documentId)!.doc.events;
  }

  // AC #1, #2
  it("opens the editor on the chosen timeline with the selection attached, and writes nothing yet", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      emptyDocument("Target", "tl-target"),
    );
    const a = await savedItem("Source A");
    const b = await savedItem("Source B");
    // The stored bytes, not the event count: a write that added an event and
    // removed another, or that only touched the document's name, leaves the
    // count at zero and would pass an assertion made on it.
    const storedBefore = note.getNote();

    await api.openCreateEventOnTimeline(win, "tl-target", libraryID, [a, b]);
    const panel = await openPanel();

    const listed = Array.from<HTMLElement>(
      panel.querySelectorAll(`.${CREATE_SOURCE_ITEM_CLASS}`),
    ).map((el) => el.textContent);
    assert.sameMembers(listed, [labelForItem(a), labelForItem(b)]);
    assert.notOk(
      panel.querySelector(`.${CREATE_DOCUMENT_SELECT_CLASS}`),
      "the chosen timeline must be locked, not offered as a picker",
    );

    assert.lengthOf(
      await eventsOn("tl-target"),
      0,
      "opening the editor must not write anything",
    );
    const reread = (await Zotero.Items.getAsync(note.id)) as Zotero.Item;
    assert.equal(
      reread.getNote(),
      storedBefore,
      "opening the editor must leave the stored note byte-for-byte unchanged",
    );
  });

  // AC #4
  it("does nothing when the date field is left blank", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      emptyDocument("Target", "tl-target"),
    );
    const a = await savedItem("Source A");
    await api.openCreateEventOnTimeline(win, "tl-target", libraryID, [a]);
    const panel = await openPanel();

    (
      panel.querySelector(`.${CREATE_TITLE_INPUT_CLASS}`) as HTMLInputElement
    ).value = "Should not be created";
    (
      panel.querySelector(`.${CREATE_BUTTON_CLASS}`) as HTMLButtonElement
    ).click();
    // Asserting nothing gets created has no condition to poll for.
    await Zotero.Promise.delay(500);

    assert.lengthOf(
      await eventsOn("tl-target"),
      0,
      "a blank date must not create an event",
    );
  });

  // AC #1, #3
  it("writes one event on Save with the selection as its sources, each carrying kind, libraryID and key", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      emptyDocument("Target", "tl-target"),
    );
    const a = await savedItem("Source A");
    const b = await savedItem("Source B");
    await api.openCreateEventOnTimeline(win, "tl-target", libraryID, [a, b]);
    const panel = await openPanel();

    (
      panel.querySelector(`.${CREATE_TITLE_INPUT_CLASS}`) as HTMLInputElement
    ).value = "New event";
    (
      panel.querySelector(`.${CREATE_DATE_INPUT_CLASS}`) as HTMLInputElement
    ).value = "1900";
    (
      panel.querySelector(`.${CREATE_BUTTON_CLASS}`) as HTMLButtonElement
    ).click();

    const created = await waitFor(async () => {
      const events = await eventsOn("tl-target");
      return events.length > 0 ? events[0] : null;
    }, "the new event to be written");

    assert.equal(created.title, "New event");
    assert.equal(created.date, "1900");
    assert.sameDeepMembers(
      created.sources.map((s) => ({
        kind: s.kind,
        libraryID: s.libraryID,
        key: s.key,
      })),
      [
        { kind: "item", libraryID, key: a.key },
        { kind: "item", libraryID, key: b.key },
      ],
    );
  });

  // AC #6 - a genuine partial failure, not a tautology: passing the same item
  // twice makes the second addSource call an exact duplicate of the first
  // (same kind, key, typeId, no name), so mutations.ts's own duplicate rule
  // refuses it rather than doubling it. If the reporting broke, this would
  // either double the source (assertion below fails) or silently drop it with
  // nothing distinguishing that from success.
  it("does not double a source that duplicates another in the same batch", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      emptyDocument("Target", "tl-target"),
    );
    const a = await savedItem("Source A");
    await api.openCreateEventOnTimeline(win, "tl-target", libraryID, [a, a]);
    const panel = await openPanel();

    (
      panel.querySelector(`.${CREATE_DATE_INPUT_CLASS}`) as HTMLInputElement
    ).value = "1900";
    (
      panel.querySelector(`.${CREATE_BUTTON_CLASS}`) as HTMLButtonElement
    ).click();

    const created = await waitFor(async () => {
      const events = await eventsOn("tl-target");
      return events.length > 0 ? events[0] : null;
    }, "the new event to be written");

    assert.lengthOf(
      created.sources,
      1,
      "the duplicate source must not be doubled",
    );
  });

  // AC #9
  it("makes a hidden target timeline visible and active without hiding a sibling that was already showing", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("B", "tl-b"),
    );
    await api.openTimelineTab();
    const checkbox = await waitFor<HTMLInputElement>(
      () =>
        win.document.querySelector(
          '.zoterotimeline-sidebar-row[data-timeline-id="tl-b"] .zoterotimeline-sidebar-row-visible',
        ),
      "the sidebar row for tl-b",
    );
    checkbox.click();
    await waitFor(
      () =>
        api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-b")
          ? null
          : true,
      "the checkbox to hide tl-b",
    );

    await api.openCreateEventOnTimeline(win, "tl-b", libraryID, []);
    await waitFor(
      () => (api.getActiveTimeline() === "tl-b" ? true : null),
      "tl-b to become the active timeline",
    );

    assert.deepEqual(
      api
        .getVisibleTimelines()
        .map((t: any) => t.doc.id)
        .sort(),
      ["tl-a", "tl-b"],
      "opening the editor must reveal its target without hiding a sibling",
    );
  });

  // AC #10 - the same confirm seam ensureDocumentShowing's cross-library
  // switch uses (setCrossLibrarySwitchConfirmForTests stubs both), since an
  // event already selected in the open tab is exactly the "current view"
  // that prompt's own wording protects, just without a library to name.
  describe("with an event already being edited in the open tab", function () {
    async function openWithSelectedEvent(): Promise<void> {
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("Source", "tl-source"),
      );
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        emptyDocument("Target", "tl-target"),
      );
      await api.openTimelineTab();
      const timeline = await waitFor(
        () => api.getCurrentTimeline(),
        "the timeline tab to open",
      );
      timeline.setSelection(["tl-source:e-1"]);
      await waitFor(
        () => win.document.querySelector(`.${TITLE_INPUT_CLASS}`),
        "the edit form to render for the selected event",
      );
    }

    afterEach(function () {
      api.setCrossLibrarySwitchConfirmForTests(() => true);
    });

    it("asks before replacing the current edit, and proceeds when confirmed", async function () {
      await openWithSelectedEvent();
      let asked = false;
      api.setCrossLibrarySwitchConfirmForTests(() => {
        asked = true;
        return true;
      });

      const a = await savedItem("Source A");
      await api.openCreateEventOnTimeline(win, "tl-target", libraryID, [a]);

      assert.isTrue(
        asked,
        "opening a new event must ask before discarding the current edit",
      );
      await waitFor(
        () =>
          win.document.querySelector(`.${CREATE_SOURCE_ITEM_CLASS}`)
            ? true
            : null,
        "the create form to replace the edit form once confirmed",
      );
    });

    it("leaves the current edit in place when declined", async function () {
      await openWithSelectedEvent();
      api.setCrossLibrarySwitchConfirmForTests(() => false);

      const a = await savedItem("Source A");
      await api.openCreateEventOnTimeline(win, "tl-target", libraryID, [a]);
      // Declining has no condition to poll for: the assertion is that
      // nothing changes.
      await Zotero.Promise.delay(500);

      assert.deepEqual(
        api.getCurrentTimeline().getSelection(),
        ["tl-source:e-1"],
        "declining must leave the event selected and being edited",
      );
      assert.notOk(
        win.document.querySelector(`.${CREATE_SOURCE_ITEM_CLASS}`),
        "declining must not open the create form",
      );
    });
  });
});
