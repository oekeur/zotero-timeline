/**
 * resolveSelection and computeMenuShape never open a modal or touch the item
 * tree, so most of this suite drives them directly. The specs that read the
 * menu itself build it the way Zotero does before opening it,
 * ZoteroPane.buildItemContextMenu(), which is where Zotero.MenuManager inserts
 * the plugin's entries, then dispatch the popupshowing event their onShowing
 * hooks listen for. See docs/contributing/testing-explanation.md for why the
 * live suite still runs inside Zotero regardless.
 *
 * A cross-library selection is built from an item that is never saved:
 * resolveSelection only ever reads .libraryID, .isAttachment() and .hasTag(),
 * none of which touch the database, and the dev profile has no second real
 * library to save into.
 */
import { assert } from "chai";
import {
  computeMenuShape,
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
import { CREATE_SOURCE_ITEM_CLASS } from "../src/modules/timeline/eventEditor";
import { labelForItem } from "../src/modules/timeline/sourceLabels";

const L10N = {
  sourcesFlat: "zoterotimeline-menu-add-sources-flat",
  sourcesSubmenu: "zoterotimeline-menu-add-sources-submenu",
  eventFlat: "zoterotimeline-menu-add-to-new-event-flat",
  eventSubmenu: "zoterotimeline-menu-add-to-new-event-submenu",
};

/** The plugin's entries carry no id; their Fluent id is what names them. */
function itemMenuEntries(win: any, l10nID: string): Element[] {
  return Array.from(
    win.document.querySelectorAll(
      `#zotero-itemmenu > [data-l10n-id="${l10nID}"]`,
    ),
  );
}

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

    before(async function () {
      win = Zotero.getMainWindows()[0];
      await win.ZoteroPane.buildItemContextMenu();
    });

    for (const [what, l10nID] of [
      ["the plain entry", "zoterotimeline-menu-add-to-new-event-flat"],
      ["the submenu", "zoterotimeline-menu-add-to-new-event-submenu"],
    ]) {
      // One spec per form of the action: the flat entry and its submenu.
      it(`${what} keeps its trailing ellipsis`, async function () {
        const [element] = itemMenuEntries(win, l10nID);
        assert.ok(element, `${l10nID} is not in the item menu`);
        const label = await waitFor(
          () => element.getAttribute("label") || undefined,
          `Fluent to resolve ${l10nID}`,
        );
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

  // Zotero.MenuManager inserts registered entries each time it builds the item
  // menu, into whichever main window builds it, so neither a window opened
  // after startup nor a second onMainWindowLoad needs anything from the
  // plugin. Zotero's own UI never holds two main windows at once, so the
  // existing window stands in for a freshly loaded one: closing a window
  // leaves the first in modal state often enough to stop its timers and
  // cascade through every later file.
  describe("registration", function () {
    it("puts each entry into the item menu exactly once, however often a window loads", async function () {
      const win = Zotero.getMainWindows()[0] as any;
      await (Zotero as any).ZoteroTimeline.hooks.onMainWindowLoad(win);
      await win.ZoteroPane.buildItemContextMenu();
      await win.ZoteroPane.buildItemContextMenu();

      for (const l10nID of Object.values(L10N)) {
        assert.lengthOf(
          itemMenuEntries(win, l10nID),
          1,
          `the item menu does not carry exactly one ${l10nID}`,
        );
      }
    });
  });

  // The hooks Zotero.MenuManager calls, through the real build-then-show
  // sequence: buildItemContextMenu with an item selected, then the
  // popupshowing event Zotero's openPopup would fire.
  describe("the entries a real item menu shows", function () {
    let libraryID: number;
    let win: any;
    let extras: Zotero.Item[];

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
      win = Zotero.getMainWindows()[0];
    });

    beforeEach(async function () {
      await eraseAllPluginItems(libraryID);
      clearCache();
      extras = [];
    });

    afterEach(async function () {
      const popup = win.document.getElementById("zotero-itemmenu");
      popup.dispatchEvent(new win.Event("popuphidden"));
      (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
      for (const item of extras) {
        await item.eraseTx();
      }
      await whenStorageIdle();
      await eraseAllPluginItems(libraryID);
      clearCache();
    });

    /** Selects a fresh item, builds the item menu and fires its
     * popupshowing; returns the item and that event. */
    async function openItemMenuOn(
      title: string,
    ): Promise<{ item: Zotero.Item; showing: Event }> {
      const item = new Zotero.Item("document");
      item.libraryID = libraryID;
      item.setField("title", title);
      await item.saveTx();
      extras.push(item);
      await win.ZoteroPane.selectItem(item.id);
      await win.ZoteroPane.buildItemContextMenu();
      const popup = win.document.getElementById("zotero-itemmenu");
      const showing = new win.Event("popupshowing");
      popup.dispatchEvent(showing);
      return { item, showing };
    }

    function closeItemMenu(): void {
      win.document
        .getElementById("zotero-itemmenu")
        .dispatchEvent(new win.Event("popuphidden"));
    }

    async function oneTimeline(): Promise<void> {
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("Solo", "tl-solo"),
      );
    }

    function whenRevealed(l10nID: string): Promise<any> {
      return waitFor(() => {
        const entry = only(l10nID);
        return entry.hidden ? undefined : entry;
      }, `${l10nID} to show`);
    }

    function only(l10nID: string): any {
      const entries = itemMenuEntries(win, l10nID);
      assert.lengthOf(entries, 1, `expected one ${l10nID}`);
      return entries[0];
    }

    it("shows the plain entries and hides the submenus for a library with one timeline", async function () {
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        documentNamed("Solo", "tl-solo"),
      );

      await openItemMenuOn("A cited work");

      await waitFor(
        () => (only(L10N.eventFlat).hidden ? undefined : true),
        "the plain add-to-new-event entry to show",
      );
      assert.isFalse(only(L10N.sourcesFlat).hidden);
      assert.isFalse(only(L10N.eventFlat).disabled);
      assert.isTrue(only(L10N.eventSubmenu).hidden);
      assert.isTrue(only(L10N.sourcesSubmenu).hidden);
    });

    it("shows the submenus, one row per timeline, for a library with two", async function () {
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

      await openItemMenuOn("A cited work");

      const submenu = await waitFor(() => {
        const menu = only(L10N.eventSubmenu);
        return menu.hidden ? undefined : menu;
      }, "the add-to-new-event submenu to show");
      const rows = Array.from(
        submenu.querySelectorAll("menupopup > menuitem"),
      ).map((row: any) => row.getAttribute("label"));
      assert.sameMembers(rows, ["A\u2026", "B\u2026"]);
      assert.isTrue(only(L10N.eventFlat).hidden);
      assert.isTrue(only(L10N.sourcesFlat).hidden);
    });

    // TASK-96 AC #2: one registration, so Zotero's menuID sort cannot reorder
    // the actions.
    it("lists the entries in the order Add as Sources, Add to New Event", async function () {
      await win.ZoteroPane.buildItemContextMenu();
      const all = Array.from(
        win.document.querySelectorAll("#zotero-itemmenu > *"),
      ) as Element[];
      const positions = [
        L10N.sourcesFlat,
        L10N.sourcesSubmenu,
        L10N.eventFlat,
        L10N.eventSubmenu,
      ].map((l10nID) =>
        all.findIndex((el) => el.getAttribute("data-l10n-id") === l10nID),
      );
      assert.notInclude(positions, -1, "an entry is missing from the menu");
      assert.deepEqual(
        [...positions].sort((a, b) => a - b),
        positions,
        "the entries are out of order",
      );
    });

    // TASK-96 AC #1. buildItemContextMenu skips every hook when an
    // annotation is selected, so whatever the last opening left visible is
    // what such an opening shows.
    it("hides every entry once the popup closes", async function () {
      await oneTimeline();
      await openItemMenuOn("A cited work");
      await whenRevealed(L10N.eventFlat);

      closeItemMenu();

      for (const l10nID of Object.values(L10N)) {
        assert.isTrue(only(l10nID).hidden, `${l10nID} still shows`);
      }
    });

    // TASK-96 AC #1, the order a real close fires in once a submenu was
    // opened: the submenu's own popuphidden bubbles through the item menu
    // first. Zotero's onHidden is a `once` listener that this event used up,
    // so the submenus stayed visible on the rig.
    it("hides every entry once the popup closes after a submenu was opened", async function () {
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
      await openItemMenuOn("A cited work");
      const submenu = await whenRevealed(L10N.sourcesSubmenu);

      submenu
        .querySelector("menupopup")
        .dispatchEvent(new win.Event("popuphidden", { bubbles: true }));
      win.document
        .getElementById("zotero-itemmenu")
        .dispatchEvent(new win.Event("popuphidden", { bubbles: true }));

      for (const l10nID of Object.values(L10N)) {
        assert.isTrue(only(l10nID).hidden, `${l10nID} still shows`);
      }
    });

    // TASK-96 AC #1: the listing settles after the popup has closed.
    it("keeps an entry hidden whose listing settles after the popup closed", async function () {
      await oneTimeline();
      const { item, showing } = await openItemMenuOn("A cited work");
      closeItemMenu();

      // The same event shares the plugin's own pending listing, so this
      // settles it; the timeout lets the plugin's reveal callbacks run.
      const shape = await computeMenuShape(showing, [item]);
      assert.equal(shape.kind, "flat", "positive control: one timeline");
      await new Promise((resolve) => setTimeout(resolve, 0));

      for (const l10nID of Object.values(L10N)) {
        assert.isTrue(only(l10nID).hidden, `${l10nID} showed after close`);
      }
    });

    // TASK-96 AC #3
    it("opens the editor with the selection attached from the plain Add to New Event entry", async function () {
      await oneTimeline();
      const { item } = await openItemMenuOn("A cited work");
      const entry = await whenRevealed(L10N.eventFlat);

      entry.dispatchEvent(new win.Event("command"));

      const sources = await waitFor(() => {
        const rows = win.document.querySelectorAll(
          `#zoterotimeline-editor .${CREATE_SOURCE_ITEM_CLASS}`,
        );
        return rows.length > 0 ? rows : undefined;
      }, "the editor to open on the new event");
      assert.deepEqual(
        Array.from<Element>(sources).map((row) => row.textContent),
        [labelForItem(item)],
      );
    });
  });
});
