/**
 * resolveSelection and computeMenuShape never open a modal or touch the item
 * tree, so this suite drives them directly rather than the registered XUL
 * menu itself, which the toolkit wires through a real popupshowing event a
 * headless run cannot dispatch. See docs/contributing/testing-explanation.md
 * for why the live suite still runs inside Zotero regardless.
 *
 * A cross-library selection is built from an item that is never saved:
 * resolveSelection only ever reads .libraryID, .isAttachment() and .hasTag(),
 * none of which touch the database, and the dev profile has no second real
 * library to save into.
 */
import { assert } from "chai";
import {
  computeMenuShape,
  registerTimelineContextAction,
  resolveSelection,
  type MenuShape,
} from "../src/modules/timeline/libraryContextMenu";
import {
  clearCache,
  invalidate,
  parsesSoFar,
} from "../src/modules/timeline/documentCache";
import {
  CONTAINER_TAG,
  STORAGE_TAG,
  VOCABULARY_TAG,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

function unsavedItem(
  itemType: string,
  libraryID: number,
  tags: string[] = [],
): Zotero.Item {
  // The fixture takes a free-form type string; Zotero.Item's own union is
  // narrower than what these specs pass.
  const item = new Zotero.Item(itemType as never);
  item.libraryID = libraryID;
  for (const tag of tags) {
    item.addTag(tag);
  }
  return item;
}

describe("libraryContextMenu", function () {
  this.timeout(60000);

  describe("resolving an eligible selection to a library", function () {
    let libraryID: number;

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
    });

    // AC #2, #3 - what feeds the submenu's own library
    it("resolves the shared library of an all-eligible selection", function () {
      const a = unsavedItem("document", libraryID);
      const b = unsavedItem("note", libraryID);
      const result = resolveSelection([a, b]);
      assert.deepEqual(result, {
        ok: true,
        libraryID,
        items: [a, b],
      });
    });

    // AC #1
    it("refuses a selection spanning two libraries, naming the problem", function () {
      const here = unsavedItem("document", libraryID);
      const there = unsavedItem("document", libraryID + 1);
      const result = resolveSelection([here, there]);
      assert.isFalse(result.ok);
      if (!result.ok) {
        assert.equal(result.reason, "split");
        assert.match(result.message, /librar/i);
      }
    });

    // AC #1 - nothing is written: resolveSelection is pure, so a refusal
    // simply returns a value rather than ever reaching a caller that could
    // write.
    it("writes nothing on a refusal, being a pure function of the selection", function () {
      const here = unsavedItem("document", libraryID);
      const there = unsavedItem("document", libraryID + 1);
      assert.doesNotThrow(() => resolveSelection([here, there]));
    });

    // AC #4
    it("excludes an attachment from the eligible selection", function () {
      const attachment = new Zotero.Item("attachment");
      attachment.libraryID = libraryID;
      attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
      const result = resolveSelection([attachment]);
      assert.deepEqual(result, {
        ok: false,
        reason: "empty",
        message: "Nothing eligible is selected.",
      });
    });

    // AC #4
    it("excludes the container, storage note and vocabulary note by tag", function () {
      const container = unsavedItem("note", libraryID, [CONTAINER_TAG]);
      const storageNote = unsavedItem("note", libraryID, [STORAGE_TAG]);
      const vocabularyNote = unsavedItem("note", libraryID, [VOCABULARY_TAG]);
      const result = resolveSelection([container, storageNote, vocabularyNote]);
      assert.deepEqual(result, {
        ok: false,
        reason: "empty",
        message: "Nothing eligible is selected.",
      });
    });

    // AC #4, negative control
    it("does not reject a note carrying none of the plugin's own tags", function () {
      const note = unsavedItem("note", libraryID, ["some-other-tag"]);
      const result = resolveSelection([note]);
      assert.isTrue(result.ok);
    });

    // AC #1 + #4 - an ineligible item from another library must not trigger
    // the split refusal for a library that was never actually offered as a
    // source.
    it("does not refuse a selection when only the ineligible item is in another library", function () {
      const eligible = unsavedItem("document", libraryID);
      const ineligibleElsewhere = unsavedItem("note", libraryID + 1, [
        STORAGE_TAG,
      ]);
      const result = resolveSelection([eligible, ineligibleElsewhere]);
      assert.deepEqual(result, {
        ok: true,
        libraryID,
        items: [eligible],
      });
    });
  });

  // The ellipsis is a convention, not decoration: both entries take the user
  // somewhere to finish the job rather than acting on the click, and a reader
  // checking the FTL source cannot tell whether the string it holds is the one
  // Fluent actually resolved onto the element. So this reads the registered
  // elements, which is what a user sees.
  describe("the entries' labels", function () {
    let win: any;

    before(function () {
      win = Zotero.getMainWindows()[0];
    });

    for (const [what, id] of [
      ["the plain entry", "zotero-timeline-menuitem-add-to-new-event"],
      ["the submenu", "zotero-timeline-menuitem-add-to-new-event-submenu"],
    ]) {
      // One spec per form of the action: the flat entry and its submenu.
      it(`${what} keeps its trailing ellipsis`, function () {
        const element = win.document.getElementById(id) as Element | null;
        assert.ok(element, `${id} is not registered`);
        const label = element!.getAttribute("label") ?? "";
        assert.notEqual(label, "", `${id} has no resolved label`);
        assert.match(
          label,
          /\u2026$/,
          `${what} must end in an ellipsis, not "${label}"`,
        );
      });
    }
  });

  describe("the submenu's shape", function () {
    let libraryID: number;

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
    });

    beforeEach(async function () {
      await eraseAllPluginItems(libraryID);
      clearCache();
    });

    afterEach(async function () {
      await whenStorageIdle();
      await eraseAllPluginItems(libraryID);
      clearCache();
    });

    function eligibleSelection(): Zotero.Item[] {
      return [unsavedItem("document", libraryID)];
    }

    // AC #1
    it("is disabled, with the refusal message, for a selection spanning libraries", async function () {
      const here = unsavedItem("document", libraryID);
      const there = unsavedItem("document", libraryID + 1);
      const shape = await computeMenuShape({} as Event, [here, there]);
      assert.equal(shape.kind, "disabled");
      if (shape.kind === "disabled") {
        assert.match(shape.message, /librar/i);
      }
    });

    it("is hidden with nothing eligible selected", async function () {
      const shape = await computeMenuShape({} as Event, []);
      assert.deepEqual(shape, { kind: "hidden" } as MenuShape);
    });

    it("is hidden when the library holds no timelines yet", async function () {
      const shape = await computeMenuShape({} as Event, eligibleSelection());
      assert.deepEqual(shape, { kind: "hidden" } as MenuShape);
    });

    // AC #7
    it("is a plain entry when the library holds exactly one timeline", async function () {
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("Solo", "tl-solo"),
      );

      const shape = await computeMenuShape({} as Event, eligibleSelection());
      assert.equal(shape.kind, "flat");
      if (shape.kind === "flat") {
        assert.equal(shape.entry.name, "Solo");
        assert.equal(shape.entry.libraryID, libraryID);
      }
    });

    // AC #7
    it("is a submenu once the library holds more than one timeline", async function () {
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

      const shape = await computeMenuShape({} as Event, eligibleSelection());
      assert.equal(shape.kind, "submenu");
      if (shape.kind === "submenu") {
        assert.sameMembers(
          shape.entries.map((entry) => entry.name),
          ["A", "B"],
        );
      }
    });

    // AC #5
    it("shows a timeline created since the last popup on the next one", async function () {
      const before = await computeMenuShape({} as Event, eligibleSelection());
      assert.equal(before.kind, "hidden");

      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("New", "tl-new"),
      );

      const after = await computeMenuShape({} as Event, eligibleSelection());
      assert.equal(after.kind, "flat");
      if (after.kind === "flat") {
        assert.equal(after.entry.name, "New");
      }
    });

    // AC #6 - the popup cache, not documentCache's own per-note cache: that
    // one alone would already skip re-parsing an unchanged note, so the note
    // here is deliberately invalidated between asks. Without the
    // popup-scoped cache the second and later asks would see the
    // invalidation and re-parse; with it, the whole popup shares the one
    // listing taken before the note changed.
    it("asks the library for its timelines once per popup, not once per entry", async function () {
      const note = await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("A", "tl-a"),
      );

      const event = {} as Event;
      const before = parsesSoFar();
      await computeMenuShape(event, eligibleSelection());
      const afterFirstAsk = parsesSoFar();
      assert.equal(afterFirstAsk - before, 1, "the first ask did not parse");

      invalidate(note.id);

      await computeMenuShape(event, eligibleSelection());
      await computeMenuShape(event, eligibleSelection());
      const afterRepeatAsks = parsesSoFar();
      assert.equal(
        afterRepeatAsks,
        afterFirstAsk,
        "a later ask within the same popup re-parsed the note",
      );

      // A fresh popup is not held to the stale listing.
      await computeMenuShape({} as Event, eligibleSelection());
      const afterNewPopup = parsesSoFar();
      assert.equal(
        afterNewPopup - afterRepeatAsks,
        1,
        "a fresh popup did not see the note invalidated during the last one",
      );
    });
  });

  // registerTimelineContextAction used to resolve the item menupopup through
  // ztoolkit.Menu.register("item", ...), whose string form goes through
  // Zotero.getMainWindow() - one window rather than every window - guarded on
  // top of that by a process-wide flag, so a window opened after the plugin
  // started carried neither entry.
  describe("a main window opened after the plugin started", function () {
    // Each spec here opens a main window and closes it again; the teardown
    // waits for the close and for the window count to settle, which the
    // single-window specs above do not pay for.
    this.timeout(60000);

    let libraryID: number;
    let firstWindow: any;
    let second: any;
    let extras: Zotero.Item[];

    const flatSourcesID = "zotero-timeline-menuitem-add-sources";
    const flatEventID = "zotero-timeline-menuitem-add-to-new-event";
    const allIDs = [
      flatSourcesID,
      `${flatSourcesID}-submenu`,
      flatEventID,
      `${flatEventID}-submenu`,
    ];

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
      firstWindow = Zotero.getMainWindows()[0];
    });

    beforeEach(async function () {
      extras = [];
      await eraseAllPluginItems(libraryID);
      clearCache();
    });

    afterEach(async function () {
      try {
        for (const item of extras) {
          await item.eraseTx();
        }
        if (second) {
          await closeWindow(second);
          second = undefined;
        }
        await whenStorageIdle();
        await eraseAllPluginItems(libraryID);
        clearCache();
      } catch (error) {
        // A plain Error thrown in a hook reaches the reporter as a bare
        // `undefined`, and a hook that throws fails every spec in every file
        // that runs after it.
        assert.fail(
          `second-window teardown failed: ${(error as Error)?.message ?? String(error)} :: ${(error as Error)?.stack ?? ""}`,
        );
      }
    });

    async function savedItem(title: string): Promise<Zotero.Item> {
      const item = new Zotero.Item("document");
      item.libraryID = libraryID;
      item.setField("title", title);
      await item.saveTx();
      extras.push(item);
      return item;
    }

    async function openSecondWindow(): Promise<any> {
      const existing = new Set(Zotero.getMainWindows());
      (Zotero as any).openMainWindow();
      const opened = await waitFor(
        () => Zotero.getMainWindows().find((w: any) => !existing.has(w)),
        "a second main window to open",
        { timeout: 20000, interval: 250 },
      );
      await waitFor(
        () => (opened as any).document?.getElementById(flatEventID),
        "the second window's context-menu entries to be registered",
        { timeout: 20000, interval: 250 },
      );
      return opened;
    }

    async function closeWindow(win: any): Promise<void> {
      if (!win || win.closed) {
        return;
      }
      win.close();
      await waitFor(
        () => !Zotero.getMainWindows().includes(win) || undefined,
        "the second main window to close",
        { timeout: 20000, interval: 250 },
      );
      // The rest of the suite drives one window and assumes it is the only
      // one, the same reason timelineMenuShortcut.test.ts asserts this rather
      // than hoping for it.
      await waitFor(
        () => Zotero.getMainWindows().length === 1 || undefined,
        "exactly one main window to be left behind",
        { timeout: 20000, interval: 250 },
      );
    }

    // AC #1, #3 (registration side)
    it("carries both entries and both submenus, without stacking a duplicate in the first window", async function () {
      second = await openSecondWindow();

      for (const id of allIDs) {
        await waitFor(
          () => second.document.getElementById(id),
          `${id} in the second window`,
          { timeout: 20000, interval: 250 },
        );
      }

      for (const win of Zotero.getMainWindows() as any[]) {
        for (const id of allIDs) {
          assert.lengthOf(
            win.document.querySelectorAll(`#${id}`),
            1,
            `a window carries more than one #${id}`,
          );
        }
      }
    });

    // AC #3 - a second call against a window that already carries the
    // entries (every window does, from the plugin's own startup or
    // onMainWindowLoad) must not add a second element per id.
    it("leaves exactly one element per id when registered twice against the same window", function () {
      registerTimelineContextAction(
        firstWindow,
        flatSourcesID,
        { flat: "unused", submenu: "unused" },
        "chrome://zotero/skin/16/universal/link.svg",
        "…",
        () => {},
      );
      registerTimelineContextAction(
        firstWindow,
        flatEventID,
        { flat: "unused", submenu: "unused" },
        "chrome://zotero/skin/16/universal/plus.svg",
        "…",
        () => {},
      );
      for (const id of allIDs) {
        assert.lengthOf(
          firstWindow.document.querySelectorAll(`#${id}`),
          1,
          `a second registration left more than one #${id}`,
        );
      }
    });

    // AC #2 - the shape a popup would show is computed from the asking
    // window's own selection. Read off second.ZoteroPane.getSelectedItems()
    // itself, not Zotero.getMainWindow()'s: under the suite's virtual display
    // there is no window manager, so focus() cannot be relied on to tell the
    // two windows apart.
    it("computes the flat entry from each window's own selection, not the other window's", async function () {
      second = await openSecondWindow();

      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("Solo", "tl-solo"),
      );
      const inFirst = await savedItem("In the first window");
      const inSecond = await savedItem("In the second window");

      await firstWindow.ZoteroPane.selectItem(inFirst.id);
      await second.ZoteroPane.selectItem(inSecond.id);

      const firstSelection = firstWindow.ZoteroPane.getSelectedItems();
      const secondSelection = second.ZoteroPane.getSelectedItems();
      assert.lengthOf(firstSelection, 1);
      assert.lengthOf(secondSelection, 1);
      assert.notEqual(
        firstSelection[0].id,
        secondSelection[0].id,
        "the two windows share one selection instead of holding their own",
      );

      const firstShape = await computeMenuShape({} as Event, firstSelection);
      const secondShape = await computeMenuShape({} as Event, secondSelection);
      assert.equal(firstShape.kind, "flat");
      assert.equal(secondShape.kind, "flat");
      if (firstShape.kind === "flat" && secondShape.kind === "flat") {
        assert.equal(firstShape.entry.documentId, "tl-solo");
        assert.equal(secondShape.entry.documentId, "tl-solo");
      }
    });
  });
});
