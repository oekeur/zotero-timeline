import { assert } from "chai";
import { addSource } from "../src/modules/timeline/mutations";
import { UNKNOWN_TYPE_LABEL } from "../src/modules/timeline/vocabulary";
import { clearCache, parsesSoFar } from "../src/modules/timeline/documentCache";
import {
  CONTAINER_TAG,
  STORAGE_TAG,
  VOCABULARY_TAG,
  findContainers,
  findOrCreateContainer,
  searchVocabularyNotes,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  EMPTY_CLASS,
  GROUP_CLASS,
  GROUP_HEADING_CLASS,
  ROW_CLASS,
  ROW_META_CLASS,
  ROW_TITLE_CLASS,
  UNREADABLE_NOTE_CLASS,
  findCitingEvents,
  isEligibleItem,
  paneItemFor,
  renderCitingEventsContent,
} from "../src/modules/timeline/itemPaneSection";
import {
  createDocumentNote,
  createRawNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

describe("item-pane section: which events cite this item", function () {
  this.timeout(60000);

  let libraryID: number;
  let extras: Zotero.Item[];

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    clearCache();
    extras = [];
  });

  afterEach(async function () {
    for (const item of extras) {
      await item.eraseTx();
    }
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
    clearCache();
  });

  async function regularItem(title = "A cited work"): Promise<Zotero.Item> {
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", title);
    await item.saveTx();
    extras.push(item);
    return item;
  }

  async function linkedAttachment(parent: Zotero.Item): Promise<Zotero.Item> {
    const attachment = new Zotero.Item("attachment");
    attachment.libraryID = libraryID;
    attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
    attachment.setField("url", "https://example.com/paper");
    attachment.parentItemID = parent.id;
    await attachment.saveTx();
    extras.push(attachment);
    return attachment;
  }

  async function documentCiting(
    name: string,
    id: string,
    item: Zotero.Item,
    typeId = "cites",
  ) {
    const base = documentNamed(name, id);
    const doc = addSource(base, base.events[0].id, {
      kind: "item",
      libraryID,
      key: item.key,
      typeId,
    })!;
    return createDocumentNote(libraryID, STORAGE_TAG, doc);
  }

  function container(): HTMLElement {
    const win = Zotero.getMainWindows()[0] as any;
    return win.document.createElement("div");
  }

  describe("eligibility", function () {
    // AC #5
    it("is eligible for a regular item", async function () {
      assert.isTrue(isEligibleItem(await regularItem()));
    });

    it("is not eligible for an attachment", async function () {
      const parent = await regularItem();
      assert.isFalse(isEligibleItem(await linkedAttachment(parent)));
    });

    it("is not eligible for the plugin's own container, storage or vocabulary note", function () {
      for (const tag of [CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG]) {
        const item = new Zotero.Item("note");
        item.libraryID = libraryID;
        item.addTag(tag);
        assert.isFalse(isEligibleItem(item), `tag ${tag} was not rejected`);
      }
    });
  });

  describe("findCitingEvents", function () {
    // AC #1, #7
    it("groups matching events by timeline, and names type and reference", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited, "cites");
      await documentCiting("Timeline B", "tl-b", cited, "supports");

      const { groups, unreadable } = await findCitingEvents(cited);

      assert.isFalse(unreadable);
      assert.lengthOf(groups, 2);
      const ids = groups.map((g) => g.timelineId).sort();
      assert.deepEqual(ids, ["tl-a", "tl-b"]);
      for (const group of groups) {
        assert.lengthOf(group.entries, 1);
        assert.lengthOf(group.entries[0].sources, 1);
      }
    });

    // AC #2
    it("reports cited-by-nothing distinctly from unreadable, when every document reads fine", async function () {
      const cited = await regularItem();
      const other = await regularItem("Not cited");
      await documentCiting("Timeline A", "tl-a", other);

      const { groups, unreadable } = await findCitingEvents(cited);

      assert.isEmpty(groups);
      assert.isFalse(unreadable);
    });

    // AC #2, #3
    it("reports unreadable rather than cited-by-nothing when a document will not parse", async function () {
      const cited = await regularItem();
      await createRawNote(libraryID, STORAGE_TAG, "<p>no data block here</p>");

      const { groups, unreadable } = await findCitingEvents(cited);

      assert.isEmpty(groups);
      assert.isTrue(unreadable);
    });

    // AC #4
    it("parses each document at most once across several selections in the same library", async function () {
      const first = await regularItem("First");
      const second = await regularItem("Second");
      await documentCiting("Timeline A", "tl-a", first);
      await documentCiting("Timeline B", "tl-b", second);

      const before = parsesSoFar();
      await findCitingEvents(first);
      const afterFirst = parsesSoFar();
      assert.equal(
        afterFirst - before,
        2,
        "the first selection did not parse both documents",
      );

      // Arrow-keying to a second item in the same, unchanged library must not
      // re-parse either document.
      await findCitingEvents(second);
      const afterSecond = parsesSoFar();
      assert.equal(
        afterSecond - afterFirst,
        0,
        "selecting a second item re-parsed the library",
      );
    });

    // AC #6
    it("creates neither a container nor a vocabulary note in a library with none", async function () {
      const item = await regularItem();

      await findCitingEvents(item);

      assert.isEmpty(await findContainers(libraryID));
      assert.isEmpty(await searchVocabularyNotes(libraryID));
    });
  });

  describe("renderCitingEventsContent", function () {
    // AC #1, #2
    it("shows the empty state when nothing cites the item", async function () {
      const item = await regularItem();
      const body = container();

      await renderCitingEventsContent(body, item);

      assert.isNotNull(body.querySelector(`.${EMPTY_CLASS}`));
      assert.isNull(body.querySelector(`.${GROUP_CLASS}`));
    });

    // AC #3
    it("shows the unreadable state, not the empty state, when a document will not parse", async function () {
      const item = await regularItem();
      await createRawNote(libraryID, STORAGE_TAG, "<p>no data block here</p>");
      const body = container();

      await renderCitingEventsContent(body, item);

      const empty = body.querySelector(`.${EMPTY_CLASS}`);
      assert.isNotNull(empty);
      assert.equal(
        empty!.getAttribute("data-l10n-id"),
        "zoterotimeline-item-citing-events-unreadable-state",
      );
    });

    // AC #1, #7
    it("renders a group per timeline with the event title and its type", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited, "cites");
      const body = container();

      await renderCitingEventsContent(body, cited);

      const headings = Array.from<HTMLElement>(
        body.querySelectorAll(`.${GROUP_HEADING_CLASS}`),
      ).map((el) => el.textContent);
      assert.deepEqual(headings, ["Timeline A"]);
      assert.equal(
        body.querySelector(`.${ROW_TITLE_CLASS}`)!.textContent,
        "Emancipation",
      );
      assert.include(
        body.querySelector(`.${ROW_META_CLASS}`)!.textContent,
        "cites",
      );
    });

    // AC #7
    it("renders the unknown-type label for a typeId that resolves to nothing", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited, "not-a-real-type");
      const body = container();

      await renderCitingEventsContent(body, cited);

      assert.include(
        body.querySelector(`.${ROW_META_CLASS}`)!.textContent,
        UNKNOWN_TYPE_LABEL,
      );
    });

    // A document unreadable alongside others that resolved: the note still
    // has to say so, not just when it is the reason for an empty state.
    it("adds the unreadable note beside a populated list, not only in place of an empty one", async function () {
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited);
      await createRawNote(libraryID, STORAGE_TAG, "<p>no data block here</p>");
      const body = container();

      await renderCitingEventsContent(body, cited);

      assert.isNotNull(body.querySelector(`.${GROUP_CLASS}`));
      assert.isNotNull(body.querySelector(`.${UNREADABLE_NOTE_CLASS}`));
    });
  });

  // The registration path itself: Zotero's item pane only calls
  // onAsyncRender for a pane currently scrolled into the container's visible
  // viewport (chrome/content/zotero/elements/itemDetails.js's own
  // isPaneVisible gate, read from the running app). A freshly registered
  // section is appended after every one of Zotero's own, so on any item pane
  // with more than a handful of fields it sits below the fold and never
  // receives an onAsyncRender call at all. These specs drive the actual
  // registered section rather than calling renderCitingEventsContent with a
  // caller-built container, which would pass whether or not the section ever
  // renders inside Zotero.
  describe("registration: the real item pane", function () {
    function findRegisteredOption(): any {
      const options = (Zotero.ItemPaneManager as any).customSectionData.options;
      return options.find((o: any) =>
        String(o.paneID).includes("citing-events"),
      );
    }

    it("dispatches from onRender rather than onAsyncRender", function () {
      const entry = findRegisteredOption();
      assert.isDefined(entry, "the section is not registered");
      assert.equal(typeof entry.onRender, "function");
      assert.isUndefined(
        entry.onAsyncRender,
        "onAsyncRender is gated by scroll visibility; content must not depend on it",
      );
    });

    it("populates body when the registered onRender is called directly", async function () {
      const entry = findRegisteredOption();
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited);
      const body = container();

      entry.onRender({ body, item: cited, doc: body.ownerDocument });
      // onRender cannot itself be async; it starts the read and returns.
      await Zotero.Promise.delay(50);

      assert.isAbove(body.children.length, 0);
    });

    it("populates the real registered section's body for a cited item selected through ZoteroPane, even though the section sits below the fold", async function () {
      const win = Zotero.getMainWindows()[0] as any;
      const cited = await regularItem();
      await documentCiting("Timeline A", "tl-a", cited);

      await win.ZoteroPane.selectItem(cited.id);
      // onRender starts renderCitingEventsContent detached (it cannot itself
      // be async) and there is no signal the caller can await; a fixed sleep
      // encodes a guess at how long the read takes instead of the real
      // condition. Poll the body the render actually writes to.
      const section = await waitFor(
        () =>
          win.document.querySelector(
            'item-pane-custom-section[data-pane*="citing-events"]',
          ),
        "the section to register in the real item pane",
      );
      const body = section.querySelector('[data-type="body"]');
      await waitFor(
        () => (body.children.length > 0 ? true : null),
        "the section body to render for the cited item",
      );

      const itemDetails = win.ZoteroPane.itemPane._itemDetails;
      assert.isFalse(
        itemDetails.isPaneVisible(section.dataset.pane),
        "this only proves the fix if the section is actually below the fold; " +
          "if the item pane grew tall enough to always show it, widen the test window",
      );
    });

    it("shows the empty state through the same real path for an item cited by nothing", async function () {
      const win = Zotero.getMainWindows()[0] as any;
      const item = await regularItem();

      await win.ZoteroPane.selectItem(item.id);
      const section = await waitFor(
        () =>
          win.document.querySelector(
            'item-pane-custom-section[data-pane*="citing-events"]',
          ),
        "the section to register in the real item pane",
      );
      const body = section.querySelector('[data-type="body"]');
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the empty state to render for an item cited by nothing",
      );
    });
  });

  // Driven entirely through the real registered section and
  // Zotero.ZoteroTimeline.api, never through this file's own copy of
  // itemPaneSection.ts or timelineTab.ts: the open tab's state lives in
  // whichever module instance actually opened it, which is the plugin's.
  describe("jump to event", function () {
    let api: any;

    // The cross-library confirmation is a real Services.prompt.confirm, which
    // blocks Zotero's main thread with no timeout and nothing to recover it:
    // one unstubbed call hangs the whole run, and every spec after it reports
    // an empty failure because it never ran. So a stub is installed for the
    // lifetime of this block and never handed back, and afterEach restores
    // that stub rather than the real dialog. Resetting the seam to its own
    // default here would re-arm the hazard for every later test.
    const allowSwitch = () => true;

    before(function () {
      api = (Zotero as any).ZoteroTimeline.api;
      api.setCrossLibrarySwitchConfirmForTests(allowSwitch);
    });

    // Writes the citing note through the plugin's own registered storage
    // module (via addon.api) rather than this file's raw-note fixture. These
    // three specs rely on the section refreshing in place after a write - the
    // whole point of the storage-write subscriber under test - and a raw note
    // write never reaches it: emitStorageWrite only fires from storage.ts's
    // own write functions.
    async function documentCitingWritten(
      name: string,
      id: string,
      item: Zotero.Item,
      typeId = "cites",
    ) {
      const base = documentNamed(name, id);
      const doc = addSource(base, base.events[0].id, {
        kind: "item",
        libraryID,
        key: item.key,
        typeId,
      })!;
      return api.createDocumentNoteForTests(libraryID, doc);
    }

    after(function () {
      api.setCrossLibrarySwitchConfirmForTests(allowSwitch);
    });

    beforeEach(function () {
      api.closeTimelineTab();
    });

    afterEach(function () {
      api.setCrossLibrarySwitchConfirmForTests(allowSwitch);
      api.closeTimelineTab();
    });

    async function clickRow(item: Zotero.Item, documentId: string) {
      const win = Zotero.getMainWindows()[0] as any;
      await win.ZoteroPane.selectItem(item.id);
      // The section renders detached: onRender cannot be async, so it starts
      // the read without awaiting it. There is no point after selectItem at
      // which the row is guaranteed to exist, so poll for it rather than
      // guessing how long the read takes.
      const sectionSelector =
        'item-pane-custom-section[data-pane*="citing-events"]';
      const rowSelector = `.${ROW_CLASS}[data-timeline-id="${documentId}"]`;
      const row = await waitFor<HTMLElement>(
        () =>
          win.document
            .querySelector(sectionSelector)
            ?.querySelector('[data-type="body"]')
            ?.querySelector(rowSelector) ?? null,
        `a citing row for document ${documentId} in the real item pane`,
      );
      row.click();
    }

    // AC #1
    it("opens the timeline tab and selects the event when none is open", async function () {
      const cited = await regularItem();
      await documentCitingWritten("Timeline A", "tl-jump-a", cited);

      await clickRow(cited, "tl-jump-a");

      const timeline = await waitFor(
        () => api.getCurrentTimeline(),
        "the timeline tab to open",
      );
      await waitFor(
        () => (timeline.getSelection().length > 0 ? true : null),
        "the jumped-to event to be selected",
      );
      assert.deepEqual(timeline.getSelection(), ["tl-jump-a:e-1"]);
    });

    // AC #2
    it("selects the event on an already-open tab without reopening it", async function () {
      const cited = await regularItem();
      await documentCitingWritten("Timeline A", "tl-jump-a", cited);
      await api.openTimelineTab();
      const before = await waitFor(
        () => api.getCurrentTimeline(),
        "the timeline tab to open",
      );

      await clickRow(cited, "tl-jump-a");
      await waitFor(
        () =>
          api.getCurrentTimeline()?.getSelection().length > 0 ? true : null,
        "the jumped-to event to be selected",
      );

      assert.strictEqual(
        api.getCurrentTimeline(),
        before,
        "the tab was rebuilt rather than reused",
      );
      assert.deepEqual(api.getCurrentTimeline().getSelection(), [
        "tl-jump-a:e-1",
      ]);
    });

    // AC #5, #6 (the jump only ever toggles visibility - selecting the event
    // is what activates its document, through canvas.ts's own
    // handleSelectionChange; see itemPaneSection.ts's jumpToEvent docblock)
    it("toggles a hidden target timeline visible without hiding a sibling that was already showing", async function () {
      const cited = await regularItem();
      const other = await regularItem("Other");
      await documentCitingWritten("Timeline A", "tl-jump-a", cited);
      await documentCitingWritten("Timeline B", "tl-jump-b", other);
      await api.openTimelineTab();

      const win = Zotero.getMainWindows()[0] as any;
      const checkbox = await waitFor<HTMLInputElement>(
        () =>
          win.document.querySelector(
            '.zoterotimeline-sidebar-row[data-timeline-id="tl-jump-a"] .zoterotimeline-sidebar-row-visible',
          ),
        "the sidebar row for tl-jump-a",
      );
      checkbox.click();
      await waitFor(
        () =>
          api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-jump-a")
            ? null
            : true,
        "the checkbox to hide tl-jump-a",
      );

      await clickRow(cited, "tl-jump-a");
      await waitFor(
        () =>
          api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-jump-a")
            ? true
            : null,
        "the jump to reveal tl-jump-a",
      );

      assert.deepEqual(
        api
          .getVisibleTimelines()
          .map((t: any) => t.doc.id)
          .sort(),
        ["tl-jump-a", "tl-jump-b"],
        "the jump must reveal its target without hiding a sibling",
      );
    });

    // AC #3. A real second Zotero library needs live sync machinery this
    // harness has no way to fake, so this reproduces the exact signal
    // ensureDocumentShowing actually reacts to - a document absent from the
    // already-open tab's own loaded groups - by creating it only after the
    // tab opened.
    describe("a timeline not loaded in the already-open tab", function () {
      async function setUp(): Promise<{ cited: Zotero.Item }> {
        const cited = await regularItem();
        await documentCiting(
          "Timeline B",
          "tl-jump-b",
          await regularItem("Other"),
        );
        await api.openTimelineTab();
        const win = Zotero.getMainWindows()[0] as any;
        await waitFor(
          () =>
            win.document.querySelector(
              '.zoterotimeline-sidebar-row[data-timeline-id="tl-jump-b"]',
            ),
          "the tab to load tl-jump-b before the switch",
        );
        await documentCiting("Timeline A", "tl-jump-a", cited);
        return { cited };
      }

      it("prompts naming the target library and re-resolves onto it when confirmed", async function () {
        const { cited } = await setUp();
        let message = "";
        api.setCrossLibrarySwitchConfirmForTests(
          (_win: unknown, _title: string, msg: string) => {
            message = msg;
            return true;
          },
        );

        await clickRow(cited, "tl-jump-a");
        await waitFor(
          () =>
            api.getCurrentTimeline()?.getSelection().length > 0 ? true : null,
          "the jumped-to event to be selected after the switch",
        );

        const libraryName = (Zotero.Libraries.get(libraryID) as any).name;
        assert.include(message, libraryName);
        assert.deepEqual(api.getCurrentTimeline().getSelection(), [
          "tl-jump-a:e-1",
        ]);
        assert.include(
          api.getVisibleTimelines().map((t: any) => t.doc.id),
          "tl-jump-a",
        );
      });

      it("leaves the open tab untouched when the switch is declined", async function () {
        const { cited } = await setUp();
        api.setCrossLibrarySwitchConfirmForTests(() => false);

        await clickRow(cited, "tl-jump-a");
        // Declining has no condition to poll for: the assertion is that
        // nothing changes, so this only gives the click a chance to have
        // acted if it had ignored the decline.
        await Zotero.Promise.delay(500);

        assert.deepEqual(
          api.getVisibleTimelines().map((t: any) => t.doc.id),
          ["tl-jump-b"],
          "declining the switch must not reopen the tab",
        );
      });
    });
  });

  describe("paneItemFor", function () {
    it("returns the item the pane's own item-details element is displaying", async function () {
      const win = Zotero.getMainWindows()[0] as any;
      const item = await regularItem();

      await win.ZoteroPane.selectItem(item.id);
      const section = await waitFor(
        () =>
          win.document.querySelector(
            'item-pane-custom-section[data-pane*="citing-events"]',
          ),
        "the section to register in the real item pane",
      );
      const body = section.querySelector('[data-type="body"]');

      const displayed = paneItemFor(body);
      assert.isDefined(displayed);
      assert.equal(displayed!.id, item.id);
    });

    it("returns undefined for a body that is not connected to any pane", function () {
      const win = Zotero.getMainWindows()[0] as any;
      const body = win.document.createElement("div");
      assert.isUndefined(paneItemFor(body));
    });
  });

  // Driven entirely through the real registered section and
  // Zotero.ZoteroTimeline.api, for the same reason "jump to event" above is:
  // the subscriber lives in the plugin's own running module instance, and a
  // write made through this file's own copy of storage.ts would never reach
  // it. The container is pre-created in every spec so the citing write is
  // never the library's first write - a first write's own container creation
  // is a new top-level item that Zotero auto-selects, which would steal the
  // pane away from the item under test for reasons that have nothing to do
  // with the subscriber (see "jump to event" above for the measured detail).
  describe("re-rendering on a storage write", function () {
    let api: any;
    let win: any;

    before(function () {
      api = (Zotero as any).ZoteroTimeline.api;
      win = Zotero.getMainWindows()[0] as any;
    });

    async function selectAndAwaitBody(item: Zotero.Item): Promise<HTMLElement> {
      await win.ZoteroPane.selectItem(item.id);
      const section = await waitFor(
        () =>
          win.document.querySelector(
            'item-pane-custom-section[data-pane*="citing-events"]',
          ),
        "the section to register in the real item pane",
      );
      return section.querySelector('[data-type="body"]');
    }

    const sectionSelector =
      'item-pane-custom-section[data-pane*="citing-events"]';

    /**
     * Records which element's `_forceRenderAll` actually ran on a write, by
     * wrapping it on the custom element's shared prototype (there is one
     * registered class per tag name, so this covers every citing-events
     * section instance in the window - the library pane's and every open
     * reader or note tab's context pane's alike). Labels each call by its
     * containing item-details' id, or "library" for the one with none,
     * because that id is the one thing that tells apart a copy that should
     * never have been refreshing from the one that should.
     */
    function instrumentSectionRefreshes(): {
      calls: string[];
      restore: () => void;
    } {
      const ctor = win.customElements.get("item-pane-custom-section");
      const original = ctor.prototype._forceRenderAll;
      const calls: string[] = [];
      ctor.prototype._forceRenderAll = async function (
        this: HTMLElement,
        ...args: unknown[]
      ) {
        const details = this.closest("item-details");
        calls.push(details ? details.id : "library");
        return original.apply(this, args);
      };
      return {
        calls,
        restore: () => {
          ctor.prototype._forceRenderAll = original;
        },
      };
    }

    /**
     * Opens an unrelated note in its own tab, which is what actually creates
     * the second item-details (and therefore the second instance of this
     * section) that exposes the per-window keying bug: contextPane.js's
     * `_addItemContext` runs for a note tab exactly as it does for a reader
     * tab. Returns to the library tab once the note tab's own copy of the
     * section has registered, so a caller's write lands with the library
     * pane selected again, matching what opening a PDF or note and returning
     * to the library actually leaves selected.
     */
    async function openNoteTab(): Promise<Zotero.Item> {
      const note = new Zotero.Item("note");
      note.libraryID = libraryID;
      note.setNote("unrelated note");
      await note.saveTx();
      extras.push(note);

      await Zotero.Notes.open(note.id, undefined, { openInWindow: false });
      await waitFor(
        () =>
          win.document.querySelectorAll(sectionSelector).length >= 2
            ? true
            : null,
        "the note tab's own citing-events section to register",
      );
      return note;
    }

    async function openAndReturnFromNoteTab(): Promise<Zotero.Item> {
      const note = await openNoteTab();
      win.Zotero_Tabs.select("zotero-pane");
      return note;
    }

    function closeNoteTab(note: Zotero.Item): void {
      const tabID = win.Zotero_Tabs.getTabIDByItemID(note.id);
      if (tabID) {
        win.Zotero_Tabs.close(tabID);
      }
    }

    it("re-renders in place after a write in the item's own library, without any selection change", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
        kind: "item",
        libraryID,
        key: item.key,
        typeId: "cites",
      })!;
      await api.createDocumentNoteForTests(libraryID, doc);

      await waitFor(
        () => body.querySelector(`.${GROUP_CLASS}`),
        "the section to refresh in place after the citing write",
      );
      assert.isNull(body.querySelector(`.${EMPTY_CLASS}`));
      assert.deepEqual(
        win.ZoteroPane.getSelectedItems().map((i: any) => i.id),
        [item.id],
        "the selection changed",
      );
    });

    // The defect this fixes: adding an item as a source to an event happens
    // from the timeline tab, which is a Zotero_Tabs tab like any reader or
    // note tab, so this is the write path the whole feature is used through.
    // `refresh()` alone leaves the library pane's own item-details stuck
    // with nothing pending (see the write subscriber's own comment); without
    // also arming that element's `_pendingRender`, reselecting the library
    // tab renders nothing and this spec times out still showing the
    // empty-state.
    it("shows a citation once the library tab is reselected after the write landed while the timeline tab was selected", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      await api.openTimelineTab();
      try {
        const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
          kind: "item",
          libraryID,
          key: item.key,
          typeId: "cites",
        })!;
        await api.createDocumentNoteForTests(libraryID, doc);

        win.Zotero_Tabs.select("zotero-pane");

        await waitFor(
          () => body.querySelector(`.${GROUP_CLASS}`),
          "the library pane's section to refresh once its tab is reselected",
        );
        assert.isNull(body.querySelector(`.${EMPTY_CLASS}`));
      } finally {
        api.closeTimelineTab();
      }
    });

    it("does not re-render for a write landing in a different library", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );
      const canary = win.document.createElement("div");
      canary.className = "test-canary";
      body.appendChild(canary);

      const group = new Zotero.Group();
      Object.assign(group as unknown as Record<string, unknown>, {
        id: 424242,
        name: "Other library",
        description: "",
        version: 1,
        editable: true,
        filesEditable: true,
      });
      await group.saveTx();
      try {
        await api.createDocumentNoteForTests(
          group.libraryID,
          documentNamed("Elsewhere", "tl-elsewhere"),
        );

        assert.isNotNull(
          body.querySelector(".test-canary"),
          "a write in a different library re-rendered the section",
        );
        assert.isNull(body.querySelector(`.${GROUP_CLASS}`));
      } finally {
        await eraseAllPluginItems(group.libraryID);
        await group.eraseTx();
      }
    });

    // The library-match check runs before either lever (refresh() or arming
    // the containing item-details' _pendingRender), so a write in a
    // different library must stay inert whether the library pane's own tab
    // is selected or not.
    it("does not arm a re-render for a write landing in a different library while the timeline tab is selected", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      await api.openTimelineTab();
      const group = new Zotero.Group();
      Object.assign(group as unknown as Record<string, unknown>, {
        id: 424243,
        name: "Other library 2",
        description: "",
        version: 1,
        editable: true,
        filesEditable: true,
      });
      await group.saveTx();
      try {
        await api.createDocumentNoteForTests(
          group.libraryID,
          documentNamed("Elsewhere 2", "tl-elsewhere-2"),
        );

        win.Zotero_Tabs.select("zotero-pane");
        await waitFor(
          () => body.querySelector(`.${EMPTY_CLASS}`),
          "the empty state to still be showing once the library tab is reselected",
        );
        assert.isNull(body.querySelector(`.${GROUP_CLASS}`));
      } finally {
        api.closeTimelineTab();
        await eraseAllPluginItems(group.libraryID);
        await group.eraseTx();
      }
    });

    // Reproduces the routing bug a per-window instance registry has: opening
    // a reader or note tab creates a second item-details in the SAME window
    // (contextPane.js's `_addItemContext`), each with its own instance of
    // this section and its own bound `refresh`. A registry keyed by window
    // lets the tab's `onInit` overwrite the library pane's entry, so a write
    // made after returning to the library refreshes the tab's copy - which
    // is not even showing - while the library pane, still holding the
    // pre-write answer, never runs `_forceRenderAll` at all.
    it("refreshes the library pane's own section, not another item-details' copy, when a note tab has also been opened", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      const note = await openAndReturnFromNoteTab();
      const { calls, restore } = instrumentSectionRefreshes();

      try {
        const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
          kind: "item",
          libraryID,
          key: item.key,
          typeId: "cites",
        })!;
        await api.createDocumentNoteForTests(libraryID, doc);

        try {
          await waitFor(
            () => body.querySelector(`.${GROUP_CLASS}`),
            "the library pane's section to refresh in place after the citing write",
          );
        } catch (err) {
          throw new Error(
            `${(err as Error).message} Refresh ran on ${JSON.stringify(calls)}. Body: ${body.textContent}`,
          );
        }
        assert.isNull(body.querySelector(`.${EMPTY_CLASS}`));
      } finally {
        restore();
        closeNoteTab(note);
      }
    });

    // The other direction of the spec above: the write lands while the note
    // tab (not the library tab) is selected, so both the multi-instance
    // routing and the reselect-to-render arming have to be right together for
    // the library pane, and only the library pane, to end up showing it.
    it("refreshes the library pane's own section, not the note tab's copy, once the library tab is reselected after a write made while the note tab was selected", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      const note = await openNoteTab();
      const { calls, restore } = instrumentSectionRefreshes();

      try {
        const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
          kind: "item",
          libraryID,
          key: item.key,
          typeId: "cites",
        })!;
        await api.createDocumentNoteForTests(libraryID, doc);

        win.Zotero_Tabs.select("zotero-pane");

        try {
          await waitFor(
            () => body.querySelector(`.${GROUP_CLASS}`),
            "the library pane's section to refresh once its tab is reselected",
          );
        } catch (err) {
          throw new Error(
            `${(err as Error).message} Refresh ran on ${JSON.stringify(calls)}. Body: ${body.textContent}`,
          );
        }
        assert.isNull(body.querySelector(`.${EMPTY_CLASS}`));
      } finally {
        restore();
        closeNoteTab(note);
      }
    });

    it("keeps refreshing the library pane after a note tab is opened and closed again", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      const note = await openAndReturnFromNoteTab();
      const noteTabID = win.Zotero_Tabs.getTabIDByItemID(note.id);
      win.Zotero_Tabs.close(noteTabID);
      const { calls, restore } = instrumentSectionRefreshes();

      try {
        const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
          kind: "item",
          libraryID,
          key: item.key,
          typeId: "cites",
        })!;
        await api.createDocumentNoteForTests(libraryID, doc);

        try {
          await waitFor(
            () => body.querySelector(`.${GROUP_CLASS}`),
            "the library pane to keep refreshing after the note tab closed",
          );
        } catch (err) {
          throw new Error(
            `${(err as Error).message} Refresh ran on ${JSON.stringify(calls)}. Body: ${body.textContent}`,
          );
        }
        assert.isNull(body.querySelector(`.${EMPTY_CLASS}`));
      } finally {
        restore();
      }
    });

    it("stops refreshing once unregistered", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      api.unregisterItemPaneSection();
      try {
        const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
          kind: "item",
          libraryID,
          key: item.key,
          typeId: "cites",
        })!;
        await api.createDocumentNoteForTests(libraryID, doc);
        await Zotero.Promise.delay(300);

        assert.isNull(
          body.querySelector(`.${GROUP_CLASS}`),
          "a write after unregistering still re-rendered the section",
        );
      } finally {
        api.registerItemPaneSection();
        // A fresh item rather than re-selecting `item`: Zotero's own custom
        // section wrapper skips onRender for an item/tab pairing it has
        // already rendered before, regardless of what happened in between
        // (see "jump to event" above for the measured detail), and `item`
        // was already rendered once at the top of this spec.
        const recovered = await regularItem("Recovery check");
        const recoveredBody = await selectAndAwaitBody(recovered);
        await waitFor(
          () => recoveredBody.querySelector(`.${EMPTY_CLASS}`),
          "the section to render again once re-registered",
        );
      }
    });

    // Zotero disables this section for an item before ever calling its
    // render hook (setEnabled runs inside box.item's setter, ahead of the
    // render loop's own hidden check), so the render-dependency key the loop
    // uses to skip a redundant render is never updated for an ineligible
    // item. Writing straight into the body for it, as an earlier version of
    // this subscriber did, left that wrong answer sitting there permanently:
    // the key still matched the ORIGINAL item once the user came back, so
    // the loop treated it as already rendered and never called the hook
    // again.
    it("leaves the section correct for the original item after a write while the pane shows an item the section is disabled for", async function () {
      await findOrCreateContainer(libraryID);
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      const attachment = await linkedAttachment(item);
      await win.ZoteroPane.selectItem(attachment.id);

      const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
        kind: "item",
        libraryID,
        key: item.key,
        typeId: "cites",
      })!;
      await api.createDocumentNoteForTests(libraryID, doc);

      await win.ZoteroPane.selectItem(item.id);
      await waitFor(
        () => body.querySelector(`.${GROUP_CLASS}`),
        "the section to show the write once the original item is reselected",
      );
      assert.isNull(body.querySelector(`.${EMPTY_CLASS}`));
    });

    // The same defect reached from the other direction: a library with no
    // container yet. Its first write creates one, and Zotero auto-selects
    // that new top-level item - which this section is disabled for, so this
    // hits the same hidden-section path as the spec above without an
    // attachment or a pre-created container anywhere in it.
    it("shows the citation for the displayed item once it is reselected after the write that creates the library's first container", async function () {
      const item = await regularItem();
      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => body.querySelector(`.${EMPTY_CLASS}`),
        "the initial empty-state render",
      );

      const doc = addSource(documentNamed("Timeline A", "tl-a"), "e-1", {
        kind: "item",
        libraryID,
        key: item.key,
        typeId: "cites",
      })!;
      await api.createDocumentNoteForTests(libraryID, doc);

      await win.ZoteroPane.selectItem(item.id);
      await waitFor(
        () => body.querySelector(`.${GROUP_CLASS}`),
        "the section to show the citation once the cited item is reselected",
      );
      assert.isNull(body.querySelector(`.${EMPTY_CLASS}`));
    });
  });
});
