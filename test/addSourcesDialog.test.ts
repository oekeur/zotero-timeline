import { assert } from "chai";
import {
  ADD_SOURCES_DIALOG_CONTENT_ID,
  ATTACH_BUTTON_CLASS,
  DISMISS_BUTTON_CLASS,
  EVENT_SELECT_CLASS,
  TYPE_SELECT_CLASS,
  attachItemsToEvent,
  defaultTypeId,
} from "../src/modules/timeline/addSourcesDialog";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_LINK_TYPES,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { labelForItem } from "../src/modules/timeline/sourceLabels";
import {
  STORAGE_TAG,
  readDocumentFromNote,
  refreshNote,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

describe("addSourcesDialog", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
  });

  async function savedItem(title: string): Promise<Zotero.Item> {
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", title);
    await item.saveTx();
    return item;
  }

  describe("defaultTypeId", function () {
    // AC #3 - the default comes from the vocabulary's own first type, never
    // a hardcoded id.
    it("is the first type in the list", function () {
      const types = [
        { id: "b", label: "B" },
        { id: "a", label: "A" },
      ];
      assert.equal(defaultTypeId(types), "b");
    });

    it("is undefined for an empty list", function () {
      assert.isUndefined(defaultTypeId([]));
    });
  });

  describe("attachItemsToEvent", function () {
    // AC #2, #4, #5 - one write, one ref per new item, a duplicate refused
    // and named rather than doubled, another event on the same document
    // untouched.
    it("attaches new items, refuses a duplicate by name, and touches no other event", async function () {
      const cited = await savedItem("Already cited");
      const first = await savedItem("First new source");
      const second = await savedItem("Second new source");

      const fixture: TimelineDocument = {
        version: CURRENT_SCHEMA_VERSION,
        id: "tl-attach",
        name: "Attach target",
        events: [
          {
            id: "e-target",
            title: "Target event",
            date: "1900",
            sources: [
              {
                kind: "item",
                libraryID,
                key: cited.key,
                typeId: "cites",
              },
            ],
            tags: [],
          },
          {
            id: "e-other",
            title: "Untouched event",
            date: "1901",
            sources: [],
            tags: [],
          },
        ],
      };
      const note = await createDocumentNote(libraryID, STORAGE_TAG, fixture);

      const outcome = await attachItemsToEvent(
        fixture.id,
        libraryID,
        "e-target",
        [cited, first, second],
        "cites",
      );

      assert.deepEqual(outcome.attached, [
        labelForItem(first),
        labelForItem(second),
      ]);
      assert.deepEqual(outcome.alreadyCited, [labelForItem(cited)]);

      await refreshNote(note);
      const { doc: written } = readDocumentFromNote(note);
      const target = written.events.find((event) => event.id === "e-target")!;
      const other = written.events.find((event) => event.id === "e-other")!;
      assert.equal(target.sources.length, 3, "the duplicate was not doubled");
      assert.sameMembers(
        target.sources.map((source) => source.key),
        [cited.key, first.key, second.key],
      );
      assert.equal(
        other.sources.length,
        0,
        "an event this attach never named must stay untouched",
      );
    });

    // AC #4 - a selection made entirely of duplicates writes nothing.
    it("writes nothing when every item already cited", async function () {
      const cited = await savedItem("Already cited");
      const fixture: TimelineDocument = {
        version: CURRENT_SCHEMA_VERSION,
        id: "tl-noop",
        name: "No-op target",
        events: [
          {
            id: "e-target",
            title: "Target event",
            date: "1900",
            sources: [
              { kind: "item", libraryID, key: cited.key, typeId: "cites" },
            ],
            tags: [],
          },
        ],
      };
      await createDocumentNote(libraryID, STORAGE_TAG, fixture);

      const outcome = await attachItemsToEvent(
        fixture.id,
        libraryID,
        "e-target",
        [cited],
        "cites",
      );

      assert.deepEqual(outcome.attached, []);
      assert.deepEqual(outcome.alreadyCited, [labelForItem(cited)]);
    });
  });

  describe("the standalone dialog", function () {
    /**
     * nsIWindowMediator only tracks windows carrying a windowtype, which this
     * dialog's <window> does not declare, so nsIWindowWatcher's enumerator is
     * what finds it - the same reason zoteroMindmap's addLinkDialog.test.ts
     * uses it for its own standalone window.
     */
    function dialogWindows(): Window[] {
      const found: Window[] = [];
      const enumerator = Services.ww.getWindowEnumerator();
      while (enumerator.hasMoreElements()) {
        const win = enumerator.getNext() as unknown as Window;
        try {
          if (win.document?.getElementById(ADD_SOURCES_DIALOG_CONTENT_ID)) {
            found.push(win);
          }
        } catch {
          // A window whose document can't be read from here isn't ours.
        }
      }
      return found;
    }

    async function closeOpenDialogs(): Promise<void> {
      for (const win of dialogWindows()) {
        win.close();
      }
    }

    beforeEach(async function () {
      await closeOpenDialogs();
    });

    afterEach(async function () {
      await closeOpenDialogs();
    });

    interface OpenDialog {
      content: HTMLElement;
      win: Window;
      closed: Promise<void>;
    }

    /**
     * Opens the picker through the real registered plugin instance
     * (Zotero.ZoteroTimeline.api), the same way eventEditor.test.ts drives
     * the tab through addon.api rather than importing renderEventEditor
     * directly. A direct import pulls in the test bundle's own separate copy
     * of the module, whose getString calls throw: initLocale() only ever
     * runs once, inside the real plugin's onStartup, so only the real
     * instance's copy of addon.data.locale is ever populated.
     */
    async function openDialog(): Promise<{
      result: OpenDialog;
      noteItemID: number;
      items: Zotero.Item[];
    }> {
      const cited = await savedItem("Already cited");
      const fresh = await savedItem("A fresh source");

      const fixture: TimelineDocument = {
        version: CURRENT_SCHEMA_VERSION,
        id: "tl-dialog",
        name: "Dialog target",
        events: [
          {
            id: "e-first",
            title: "First event",
            date: "1900",
            sources: [
              { kind: "item", libraryID, key: cited.key, typeId: "cites" },
            ],
            tags: [],
          },
          {
            id: "e-second",
            title: "Second event",
            date: "1950",
            sources: [],
            tags: [],
          },
        ],
      };
      const note = await createDocumentNote(libraryID, STORAGE_TAG, fixture);

      const closed = (Zotero as any).ZoteroTimeline.api.openAddSourcesDialog(
        { noteItemID: note.id, libraryID, name: fixture.name },
        [cited, fresh],
      ) as Promise<void>;

      let content: { win: Window; found: Element };
      try {
        content = await waitFor(
          () => {
            const win = dialogWindows()[0];
            const found = win?.document.getElementById(
              ADD_SOURCES_DIALOG_CONTENT_ID,
            );
            return found?.querySelector("select") ? { win, found } : null;
          },
          "the Add as sources dialog to open",
          { timeout: 15000, interval: 100 },
        );
      } catch (err) {
        throw new Error(
          `${(err as Error).message}; errors:\n${Zotero.getErrors(true).join("\n")}`,
        );
      }
      return {
        result: {
          content: content.found as HTMLElement,
          win: content.win,
          closed,
        },
        noteItemID: note.id,
        items: [cited, fresh],
      };
    }

    // AC #1 - a real HTML select, in the namespace the item pane's own
    // pickers build one in, is what proves this is a real chrome document
    // rather than the blank window a ztoolkit.Dialog opens: that window will
    // not build a working select at all.
    it("builds the event field as an HTML select carrying every event", async function () {
      this.timeout(45000);
      const { result } = await openDialog();
      const select = result.content.querySelector(
        `.${EVENT_SELECT_CLASS}`,
      ) as HTMLSelectElement;

      assert.isNotNull(select);
      assert.equal(select.namespaceURI, "http://www.w3.org/1999/xhtml");
      assert.equal(select.options.length, 2);
      assert.sameMembers(
        Array.from(select.options).map((option) => option.value),
        ["e-first", "e-second"],
      );

      result.win.close();
      await result.closed;
    });

    // AC #3
    it("defaults the type field to the vocabulary's first type", async function () {
      this.timeout(45000);
      const { result } = await openDialog();
      const select = result.content.querySelector(
        `.${TYPE_SELECT_CLASS}`,
      ) as HTMLSelectElement;

      assert.equal(select.value, DEFAULT_LINK_TYPES[0].id);

      result.win.close();
      await result.closed;
    });

    // AC #2, #4, #5 - attaching through the real dialog writes one ref per
    // new item onto the chosen event, and reports the duplicate by name
    // rather than silently dropping it.
    it("reports a partial result naming the item already cited", async function () {
      this.timeout(45000);
      const { result, noteItemID, items } = await openDialog();
      const [cited, fresh] = items;

      const select = result.content.querySelector(
        `.${EVENT_SELECT_CLASS}`,
      ) as HTMLSelectElement;
      select.value = "e-first";

      const attachButton = result.content.querySelector(
        `.${ATTACH_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      attachButton.click();

      const resultText = await waitFor(
        () => {
          const text = result.content.textContent ?? "";
          return text.includes(labelForItem(cited)) ? text : null;
        },
        "the attach result to name the already-cited item",
        { timeout: 10000, interval: 100 },
      );
      assert.include(resultText, "Attached 1");
      assert.include(resultText, labelForItem(cited));

      const note = (await Zotero.Items.getAsync(noteItemID)) as Zotero.Item;
      await refreshNote(note);
      const { doc: written } = readDocumentFromNote(note);
      const target = written.events.find((event) => event.id === "e-first")!;
      assert.sameMembers(
        target.sources.map((source) => source.key),
        [cited.key, fresh.key],
      );

      result.win.close();
      await result.closed;
    });

    // AC #1, negative control - Cancel closes the window and writes nothing.
    it("closes on Cancel without writing anything", async function () {
      this.timeout(45000);
      const { result, noteItemID } = await openDialog();

      const dismissButton = result.content.querySelector(
        `.${DISMISS_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      dismissButton.click();
      await result.closed;

      const note = (await Zotero.Items.getAsync(noteItemID)) as Zotero.Item;
      await refreshNote(note);
      const { doc: written } = readDocumentFromNote(note);
      const target = written.events.find((event) => event.id === "e-first")!;
      assert.equal(target.sources.length, 1);
    });
  });
});
