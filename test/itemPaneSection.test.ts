import { assert } from "chai";
import { addSource } from "../src/modules/timeline/mutations";
import { CURRENT_SCHEMA_VERSION } from "../src/modules/timeline/schema";
import { UNKNOWN_TYPE_LABEL } from "../src/modules/timeline/vocabulary";
import { clearCache, parsesSoFar } from "../src/modules/timeline/documentCache";
import {
  SAVE_BUTTON_CLASS,
  TAG_CLASS,
  TAG_REMOVE_BUTTON_CLASS,
  TAG_TEXT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  TAG_FILTER_CHIP_CLASS,
  TAG_FILTER_CHIP_SELECTED_CLASS,
  TAG_FILTER_NOTICE_CLASS,
} from "../src/modules/timeline/tagFilter";
import {
  CONTAINER_TAG,
  STORAGE_TAG,
  VOCABULARY_TAG,
  buildNoteHtml,
  buildVocabularyNoteHtml,
  createTaggedNote,
  findContainers,
  findOrCreateContainer,
  listTimelines,
  searchVocabularyNotes,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  EDIT_BUTTON_CLASS,
  ERROR_CLASS as VOCAB_ERROR_CLASS,
  FIELD_INPUT_CLASS,
  ROW_CLASS as VOCAB_ROW_CLASS,
  SAVE_BUTTON_CLASS as VOCAB_SAVE_BUTTON_CLASS,
} from "../src/modules/timeline/vocabularySettings";
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

    // AC #3. The canvas-refresh observer now relists a storage note added to
    // the tab's own library while the tab is open (the fix for a timeline
    // restored from the trash, or created elsewhere, not appearing until the
    // tab was closed and reopened), so a document written after the tab
    // opened is no longer reliably absent from its loaded groups by the time
    // a jump reaches ensureDocumentShowing: this exercises that ordinary
    // path, and asserts the jump lands on the event without the cross-
    // library-style prompt, rather than exploiting the old timing gap to
    // force one.
    describe("a timeline added to the same library while the tab is open", function () {
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

      it("relists the new timeline and jumps straight to its event, without prompting", async function () {
        const { cited } = await setUp();
        let promptCalled = false;
        api.setCrossLibrarySwitchConfirmForTests(() => {
          promptCalled = true;
          return true;
        });

        await clickRow(cited, "tl-jump-a");
        await waitFor(
          () =>
            api.getCurrentTimeline()?.getSelection().length > 0 ? true : null,
          "the jumped-to event to be selected once the relist catches up",
        );

        assert.deepEqual(api.getCurrentTimeline().getSelection(), [
          "tl-jump-a:e-1",
        ]);
        assert.include(
          api.getVisibleTimelines().map((t: any) => t.doc.id),
          "tl-jump-a",
        );
        assert.isFalse(
          promptCalled,
          "a note added to the tab's own library prompted for a library switch",
        );
      });
    });

    // AC #3, the genuinely cross-library half. The observer above only ever
    // re-lists the open tab's own libraryID (rebuildCanvas calls
    // listTimelinesCached(libraryID)), so a document that lives in a
    // different library stays outside readableTimelines no matter how fast
    // it runs; this is the one case ensureDocumentShowing's confirm-and-
    // switch path still fires for, and the only place left to prove it does.
    describe("a timeline not loaded in the already-open tab", function () {
      let group: any;

      beforeEach(async function () {
        group = new Zotero.Group();
        Object.assign(group as unknown as Record<string, unknown>, {
          id: 424244,
          name: "Switch target",
          description: "",
          version: 1,
          editable: true,
          filesEditable: true,
        });
        await group.saveTx();
      });

      afterEach(async function () {
        // Before erasing, not after: a confirmed switch reopens the tab on
        // the group library, so this hook - which runs before the outer
        // describe's own closeTimelineTab, Mocha unwinds afterEach
        // innermost-first - is closing a tab that may now be watching
        // exactly the notes it is about to erase. Zotero_Tabs.close() runs
        // the tab's onClose, which releases the canvas-refresh observer,
        // asynchronously (see timelineMenuShortcut.test.ts's own teardown),
        // so erasing has to wait for the tab to actually be gone rather than
        // just for the close call to return.
        const win = Zotero.getMainWindows()[0] as any;
        // Away from the group's own item before its library is wiped: the
        // confirmed-switch spec leaves it selected, and eraseTx on the
        // Zotero.Group cascades to erase that very item while it is still
        // showing, which is a harsher operation than the per-item eraseTx
        // the outer afterEach uses and not one to leave anything watching.
        win.ZoteroPane.collectionsView.selectLibrary(libraryID);
        api.closeTimelineTab();
        await waitFor(
          () =>
            !(win.Zotero_Tabs?._tabs ?? []).some(
              (t: any) => t.type === "zoterotimeline-timeline",
            ) || undefined,
          "the timeline tab to be gone before erasing the group library",
        );
        await eraseAllPluginItems(group.libraryID);
        await group.eraseTx();
      });

      // Deliberately not pushed onto the shared `extras` array the outer
      // describe's afterEach erases one by one: group.eraseTx() above
      // already cascades every item in that library, this one included, and
      // a second eraseTx() on an already-erased item throws.
      async function citedInGroup(title: string): Promise<Zotero.Item> {
        const item = new Zotero.Item("document");
        item.libraryID = group.libraryID;
        item.setField("title", title);
        await item.saveTx();
        return item;
      }

      async function documentCitingInGroup(
        name: string,
        id: string,
        item: Zotero.Item,
      ) {
        const base = documentNamed(name, id);
        const doc = addSource(base, base.events[0].id, {
          kind: "item",
          libraryID: group.libraryID,
          key: item.key,
          typeId: "cites",
        })!;
        return createDocumentNote(group.libraryID, STORAGE_TAG, doc);
      }

      async function setUp(): Promise<{ cited: Zotero.Item }> {
        const cited = await citedInGroup("Group cited");
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
        await documentCitingInGroup("Timeline A", "tl-jump-a", cited);
        return { cited };
      }

      it("prompts naming the target library and re-resolves onto it when confirmed", async function () {
        const { cited } = await setUp();
        let message = "";
        let calls = 0;
        api.setCrossLibrarySwitchConfirmForTests(
          (_win: unknown, _title: string, msg: string) => {
            calls += 1;
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

        assert.strictEqual(
          calls,
          1,
          "the switch prompt must fire exactly once",
        );
        const currentLibraryName = (Zotero.Libraries.get(libraryID) as any)
          .name;
        assert.include(
          message,
          currentLibraryName,
          "prompt names the current library",
        );
        assert.include(
          message,
          "Switch target",
          "prompt names the target library",
        );
        assert.deepEqual(api.getCurrentTimeline().getSelection(), [
          "tl-jump-a:e-1",
        ]);
        assert.include(
          api.getVisibleTimelines().map((t: any) => t.doc.id),
          "tl-jump-a",
        );
        assert.notInclude(
          api.getVisibleTimelines().map((t: any) => t.doc.id),
          "tl-jump-b",
          "the reopened tab must be on the group library, not the one it started on",
        );
      });

      it("leaves the open tab untouched when the switch is declined", async function () {
        const { cited } = await setUp();
        let calls = 0;
        api.setCrossLibrarySwitchConfirmForTests(() => {
          calls += 1;
          return false;
        });
        const before = api.getCurrentTimeline();

        await clickRow(cited, "tl-jump-a");
        // Declining has no condition to poll for: the assertion is that
        // nothing changes, so this only gives the click a chance to have
        // acted if it had ignored the decline.
        await Zotero.Promise.delay(500);

        assert.strictEqual(
          calls,
          1,
          "the switch prompt must fire exactly once",
        );
        assert.strictEqual(
          api.getCurrentTimeline(),
          before,
          "declining the switch must not reopen the tab",
        );
        assert.deepEqual(
          api.getVisibleTimelines().map((t: any) => t.doc.id),
          ["tl-jump-b"],
          "declining the switch must not reopen the tab",
        );
      });
    });

    // The active tag filter narrows the canvas's own data view, so even a
    // revealed timeline can leave a jump's target undrawn. The jump clears
    // the filter and says so, rather than widening it or refusing - widening
    // cannot serve an untagged target, since itemMatchesTagFilter never
    // admits an item with no tags under any non-empty filter.
    describe("clearing a tag filter that hides the jump target", function () {
      const NOTICE_TEXT = "Tag filter cleared to show this event.";

      function chipFor(sidebar: HTMLElement, tag: string): HTMLButtonElement {
        return Array.from<HTMLButtonElement>(
          sidebar.querySelectorAll(`.${TAG_FILTER_CHIP_CLASS}`),
        ).find((chip) => chip.textContent === tag) as HTMLButtonElement;
      }

      async function selectFilterChip(tag: string): Promise<HTMLElement> {
        const win = Zotero.getMainWindows()[0] as any;
        const sidebar = win.document.getElementById(
          "zoterotimeline-sidebar",
        ) as HTMLElement;
        const chip = await waitFor(
          () => chipFor(sidebar, tag),
          `a "${tag}" tag filter chip to render`,
        );
        chip.click();
        await waitFor(
          () => (api.getSelectedTagFilter().includes(tag) ? true : null),
          `the "${tag}" filter to apply`,
        );
        return sidebar;
      }

      async function documentCitingTagged(
        name: string,
        id: string,
        item: Zotero.Item,
        tags: string[],
      ) {
        const base = documentNamed(name, id);
        base.events[0].tags = tags;
        const doc = addSource(base, base.events[0].id, {
          kind: "item",
          libraryID,
          key: item.key,
          typeId: "cites",
        })!;
        return api.createDocumentNoteForTests(libraryID, doc);
      }

      // vis-timeline's ItemSet.setSelection stores every id it is handed
      // (`this.selection = [...ids]`) whether or not an item by that id is
      // currently in its filtered view, so getSelection() alone cannot tell a
      // landed jump from a phantom one - itemsData, the filtered DataView the
      // Timeline actually draws from, is the honest check.
      function isDrawn(timeline: any, id: string): boolean {
        return timeline.itemsData.get(id) != null;
      }

      it("clears the filter and lands on an untagged target it hides, and drops the notice on the next chip click", async function () {
        const cited = await regularItem();
        const other = await regularItem("Other");
        await documentCitingTagged("Timeline A", "tl-jump-untagged", cited, []);
        await documentCitingTagged("Timeline B", "tl-jump-other-1", other, [
          "beta",
        ]);
        await api.openTimelineTab();
        const sidebar = await selectFilterChip("beta");

        await clickRow(cited, "tl-jump-untagged");

        const timeline = await waitFor(
          () => api.getCurrentTimeline(),
          "the timeline tab to open",
        );
        await waitFor(
          () => (timeline.getSelection().length > 0 ? true : null),
          "the jumped-to event to be selected",
        );
        assert.deepEqual(timeline.getSelection(), ["tl-jump-untagged:e-1"]);
        assert.isTrue(
          isDrawn(timeline, "tl-jump-untagged:e-1"),
          "the jumped-to event was selected but never actually drawn",
        );
        assert.isEmpty(
          api.getSelectedTagFilter(),
          "the filter must be cleared once it stood between the jump and an untagged target",
        );

        const win = Zotero.getMainWindows()[0] as any;
        const titleInput = (await waitFor(
          () =>
            win.document
              .getElementById("zoterotimeline-editor")
              ?.querySelector(`.${TITLE_INPUT_CLASS}`),
          "the editor panel to show the jumped-to event",
        )) as HTMLInputElement;
        assert.equal(titleInput.value, "Emancipation");

        assert.lengthOf(
          Array.from(sidebar.querySelectorAll(`.${TAG_FILTER_NOTICE_CLASS}`)),
          1,
          "exactly one notice should explain the cleared filter",
        );
        assert.equal(
          sidebar.querySelector(`.${TAG_FILTER_NOTICE_CLASS}`)!.textContent,
          NOTICE_TEXT,
        );
        assert.lengthOf(
          Array.from(
            sidebar.querySelectorAll(
              `.${TAG_FILTER_CHIP_CLASS}.${TAG_FILTER_CHIP_SELECTED_CLASS}`,
            ),
          ),
          0,
          "a chip still showed selected after the filter was cleared",
        );

        // The notice belongs to exactly the render the clearing jump caused;
        // the next renderSidebar() - here, a chip click - must drop it.
        await selectFilterChip("beta");
        assert.lengthOf(
          Array.from(sidebar.querySelectorAll(`.${TAG_FILTER_NOTICE_CLASS}`)),
          0,
          "the notice must not survive the next chip click",
        );
      });

      it("clears the filter and lands on a tagged target the filter hides", async function () {
        const cited = await regularItem();
        const other = await regularItem("Other");
        await documentCitingTagged("Timeline A", "tl-jump-tagged", cited, [
          "alpha",
        ]);
        await documentCitingTagged("Timeline B", "tl-jump-other-2", other, [
          "beta",
        ]);
        await api.openTimelineTab();
        const sidebar = await selectFilterChip("beta");

        await clickRow(cited, "tl-jump-tagged");

        const timeline = await waitFor(
          () => api.getCurrentTimeline(),
          "the timeline tab to open",
        );
        await waitFor(
          () => (timeline.getSelection().length > 0 ? true : null),
          "the jumped-to event to be selected",
        );
        assert.deepEqual(timeline.getSelection(), ["tl-jump-tagged:e-1"]);
        assert.isTrue(
          isDrawn(timeline, "tl-jump-tagged:e-1"),
          "the jumped-to event was selected but never actually drawn",
        );
        assert.isEmpty(
          api.getSelectedTagFilter(),
          "the filter must be cleared once it stood between the jump and its target",
        );

        assert.lengthOf(
          Array.from(sidebar.querySelectorAll(`.${TAG_FILTER_NOTICE_CLASS}`)),
          1,
          "exactly one notice should explain the cleared filter",
        );
        assert.equal(
          sidebar.querySelector(`.${TAG_FILTER_NOTICE_CLASS}`)!.textContent,
          NOTICE_TEXT,
        );
        assert.lengthOf(
          Array.from(
            sidebar.querySelectorAll(
              `.${TAG_FILTER_CHIP_CLASS}.${TAG_FILTER_CHIP_SELECTED_CLASS}`,
            ),
          ),
          0,
          "a chip still showed selected after the filter was cleared",
        );
      });

      it("changes nothing about the filter when it already admits the target", async function () {
        const cited = await regularItem();
        await documentCitingTagged("Timeline A", "tl-jump-admitted", cited, [
          "gamma",
        ]);
        await api.openTimelineTab();
        const sidebar = await selectFilterChip("gamma");
        const before = api.getSelectedTagFilter();

        await clickRow(cited, "tl-jump-admitted");

        const timeline = await waitFor(
          () => api.getCurrentTimeline(),
          "the timeline tab to open",
        );
        await waitFor(
          () => (timeline.getSelection().length > 0 ? true : null),
          "the jumped-to event to be selected",
        );
        assert.deepEqual(timeline.getSelection(), ["tl-jump-admitted:e-1"]);
        assert.isTrue(
          isDrawn(timeline, "tl-jump-admitted:e-1"),
          "the jumped-to event was selected but never actually drawn",
        );
        assert.deepEqual(
          api.getSelectedTagFilter(),
          before,
          "a jump onto an already-admitted event must not touch the filter",
        );
        assert.isNull(
          sidebar.querySelector(`.${TAG_FILTER_NOTICE_CLASS}`),
          "a jump that changed nothing about the filter must show no notice",
        );
      });

      // readableTimelines - a wholesale snapshot refreshed only on a rebuild
      // or a re-open - is not what admitEventThroughTagFilter reads: it reads
      // the tab's own `documents` map instead, the one every write path
      // (click-to-create, an editor save) keeps current. Reproduces the
      // adversary's finding: click-to-create replaces the tab's `documents`
      // entry for tl-stale with a new object (canvas.ts's addEvent returns a
      // new document rather than mutating the old one in place), so a save
      // straight afterward - which mutates that new object - would be
      // invisible to a reader still holding the object from tab-open.
      async function landsOnARetaggedEvent(
        withClickToCreate: boolean,
      ): Promise<void> {
        const cited = await regularItem();
        const other = await regularItem("Other");
        await documentCitingTagged("Timeline A", "tl-stale", cited, ["alpha"]);
        await documentCitingTagged("Timeline B", "tl-stale-other", other, [
          "alpha",
        ]);
        await api.openTimelineTab();
        const timeline = await waitFor(
          () => api.getCurrentTimeline(),
          "the timeline tab to open",
        );
        const win = Zotero.getMainWindows()[0] as any;
        const panel = win.document.getElementById(
          "zoterotimeline-editor",
        ) as HTMLElement;

        if (withClickToCreate) {
          timeline.emit("click", {
            item: null,
            group: "tl-stale",
            time: new Date(Date.UTC(1870, 0, 1)),
          });
          // Read back through a fresh storage parse, not
          // api.getVisibleTimelines(): that reads readableTimelines, which
          // (like the bug this file's own describe block is otherwise about)
          // a click-to-create's write never updates - only the tab's own
          // `documents` map and the canvas's in-memory copy get the result.
          // Pre-existing and filed separately; this spec just has to avoid
          // reading through it to observe the write at all.
          await waitFor(async () => {
            const { timelines } = await listTimelines(libraryID);
            const doc = timelines.find((t) => t.doc.id === "tl-stale")?.doc;
            return doc && doc.events.length === 2 ? true : null;
          }, "click-to-create to land in storage");
          await whenStorageIdle();
        }

        timeline.setSelection(["tl-stale:e-1"]);
        await waitFor(() => {
          const t = panel.querySelector(
            `.${TITLE_INPUT_CLASS}`,
          ) as HTMLInputElement | null;
          return t && t.value === "Emancipation" ? t : null;
        }, "the editor to open on e-1");
        const remove = await waitFor(
          () =>
            Array.from<HTMLElement>(panel.querySelectorAll(`.${TAG_CLASS}`))
              .find(
                (chip) =>
                  chip.querySelector(`.${TAG_TEXT_CLASS}`)?.textContent ===
                  "alpha",
              )
              ?.querySelector(
                `.${TAG_REMOVE_BUTTON_CLASS}`,
              ) as HTMLButtonElement,
          "the alpha tag's remove button",
        );
        remove.click();
        (
          panel.querySelector(`.${SAVE_BUTTON_CLASS}`) as HTMLButtonElement
        ).click();
        await waitFor(async () => {
          const { timelines } = await listTimelines(libraryID);
          const e1 = timelines
            .find((t) => t.doc.id === "tl-stale")
            ?.doc.events.find((e) => e.id === "e-1");
          return e1 && e1.tags.length === 0 ? true : null;
        }, "the tag removal to be stored");
        await whenStorageIdle();
        // Lets the storage-write observer's rebuild pass settle either way.
        await Zotero.Promise.delay(500);

        await selectFilterChip("alpha");
        assert.notInclude(
          timeline.itemsData.get().map((i: any) => String(i.id)),
          "tl-stale:e-1",
          "precondition: e-1 must be hidden by the alpha filter",
        );

        await clickRow(cited, "tl-stale");

        await waitFor(
          () => (timeline.getSelection().length > 0 ? true : null),
          "the jumped-to event to be selected",
        );
        assert.deepEqual(timeline.getSelection(), ["tl-stale:e-1"]);
        assert.isTrue(
          isDrawn(timeline, "tl-stale:e-1"),
          "the jumped-to event was selected but never actually drawn",
        );
        assert.isEmpty(
          api.getSelectedTagFilter(),
          "the filter must be cleared once it stood between the jump and the retagged target",
        );
      }

      it("lands on an event whose tag was removed in the editor after a click-to-create in the same timeline", async function () {
        await landsOnARetaggedEvent(true);
      });

      it("lands on an event whose tag was removed in the editor (control: no click-to-create)", async function () {
        await landsOnARetaggedEvent(false);
      });

      it("clears the filter and lands on a target whose own timeline was hidden too", async function () {
        const cited = await regularItem();
        const other = await regularItem("Other");
        await documentCitingTagged("Timeline A", "tl-both-a", cited, []);
        await documentCitingTagged("Timeline B", "tl-both-b", other, ["beta"]);
        await api.openTimelineTab();
        const timeline = await waitFor(
          () => api.getCurrentTimeline(),
          "the timeline tab to open",
        );

        const win = Zotero.getMainWindows()[0] as any;
        const checkbox = await waitFor<HTMLInputElement>(
          () =>
            win.document.querySelector(
              '.zoterotimeline-sidebar-row[data-timeline-id="tl-both-a"] .zoterotimeline-sidebar-row-visible',
            ),
          "the sidebar row for tl-both-a",
        );
        checkbox.click();
        await waitFor(
          () =>
            api.getVisibleTimelines().some((t: any) => t.doc.id === "tl-both-a")
              ? null
              : true,
          "the checkbox to hide tl-both-a",
        );
        await selectFilterChip("beta");

        await clickRow(cited, "tl-both-a");

        await waitFor(
          () => (timeline.getSelection().length > 0 ? true : null),
          "the jumped-to event to be selected",
        );
        assert.deepEqual(timeline.getSelection(), ["tl-both-a:e-1"]);
        assert.isTrue(
          isDrawn(timeline, "tl-both-a:e-1"),
          "the jumped-to event was selected but never actually drawn",
        );
        assert.isEmpty(api.getSelectedTagFilter(), "filter not cleared");
        assert.include(
          api.getVisibleTimelines().map((t: any) => t.doc.id),
          "tl-both-a",
          "the reveal must still happen alongside the filter clear",
        );
      });

      it("leaves the filter untouched when the jumped-to event no longer resolves in the loaded document", async function () {
        const cited = await regularItem();
        const noteItem: Zotero.Item = await documentCitingTagged(
          "Timeline X",
          "tl-stale-resolve",
          cited,
          ["zeta"],
        );

        const win = Zotero.getMainWindows()[0] as any;
        await win.ZoteroPane.selectItem(cited.id);
        const sectionSelector =
          'item-pane-custom-section[data-pane*="citing-events"]';
        const rowSelector = `.${ROW_CLASS}[data-timeline-id="tl-stale-resolve"]`;
        await waitFor(
          () =>
            win.document
              .querySelector(sectionSelector)
              ?.querySelector('[data-type="body"]')
              ?.querySelector(rowSelector),
          "the citing row to render for the original event id",
        );

        // Renamed directly on the note, bypassing the plugin's own write
        // queue - the same raw-write seam the "re-rendering on a storage
        // write" specs above use to prove a write outside storage.ts's own
        // functions reaches no subscriber - so the item pane's
        // already-rendered row keeps pointing at an event id that no longer
        // exists once the tab (re)loads the document fresh.
        const renamedBase = documentNamed("Timeline X", "tl-stale-resolve");
        renamedBase.events[0].id = "e-1-renamed";
        renamedBase.events[0].tags = ["zeta"];
        const renamed = addSource(renamedBase, "e-1-renamed", {
          kind: "item",
          libraryID,
          key: cited.key,
          typeId: "cites",
        })!;
        noteItem.setNote(buildNoteHtml(renamed));
        await noteItem.saveTx();

        await api.openTimelineTab();
        const timeline = await waitFor(
          () => api.getCurrentTimeline(),
          "the timeline tab to open",
        );
        await waitFor(
          () =>
            api
              .getVisibleTimelines()
              .find((t: any) => t.doc.id === "tl-stale-resolve")
              ?.doc.events.some((e: any) => e.id === "e-1-renamed")
              ? true
              : null,
          "the tab to load the renamed event",
        );
        await selectFilterChip("zeta");

        await clickRow(cited, "tl-stale-resolve");
        // Nothing ever resolves to a drawn item on this path, so there is no
        // positive condition to poll for; this only gives the click a chance
        // to have acted if admitEventThroughTagFilter had wrongly cleared the
        // filter for an event it could not find.
        await Zotero.Promise.delay(500);

        assert.deepEqual(
          api.getSelectedTagFilter(),
          ["zeta"],
          "an event that no longer resolves in the loaded document must not touch the filter",
        );
        assert.isFalse(
          isDrawn(timeline, "tl-stale-resolve:e-1"),
          "the stale event id must not appear drawn",
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

    function citingRowMetaText(body: HTMLElement): string {
      return body.querySelector(`.${ROW_META_CLASS}`)?.textContent ?? "";
    }

    // Rename runs through the real vocabulary editor (api.renderVocabularySettings)
    // rather than a spec-imported updateVocabulary: the latter emits into the
    // test bundle's own listener set, which this section's real subscriber
    // never hears.
    it("repaints the row's type label after a vocabulary rename, without reselecting the item", async function () {
      await findOrCreateContainer(libraryID);
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [{ id: "cites", label: "cites" }],
        }),
      );
      const item = await regularItem();
      const doc = addSource(
        documentNamed("Timeline A", "tl-vocab-rename"),
        "e-1",
        { kind: "item", libraryID, key: item.key, typeId: "cites" },
      )!;
      await api.createDocumentNoteForTests(libraryID, doc);

      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => (citingRowMetaText(body).includes("cites") ? true : null),
        "the citing row to show the original type label",
      );

      const editor = win.document.createElement("div");
      await api.renderVocabularySettings(editor);
      (editor.querySelector(`.${VOCAB_ROW_CLASS}`) as HTMLElement).click();
      (
        editor.querySelector(`.${EDIT_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      const input = editor.querySelector(
        `.${FIELD_INPUT_CLASS}`,
      ) as HTMLInputElement;
      input.value = "directly cites";
      (
        editor.querySelector(`.${VOCAB_SAVE_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();

      await waitFor(
        () =>
          citingRowMetaText(body).includes("directly cites") ? true : null,
        "the citing row to repaint with the renamed label without reselecting the item",
      );
      assert.deepEqual(
        win.ZoteroPane.getSelectedItems().map((i: any) => i.id),
        [item.id],
        "the selection changed",
      );
    });

    it("leaves the citing row showing the old label when a vocabulary rename is refused", async function () {
      await findOrCreateContainer(libraryID);
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [{ id: "cites", label: "cites" }],
        }),
      );
      const item = await regularItem();
      const doc = addSource(
        documentNamed("Timeline A", "tl-vocab-refused"),
        "e-1",
        { kind: "item", libraryID, key: item.key, typeId: "cites" },
      )!;
      await api.createDocumentNoteForTests(libraryID, doc);

      const body = await selectAndAwaitBody(item);
      await waitFor(
        () => (citingRowMetaText(body).includes("cites") ? true : null),
        "the citing row to show the original type label",
      );
      const originalText = citingRowMetaText(body);

      const editor = win.document.createElement("div");
      await api.renderVocabularySettings(editor);
      (editor.querySelector(`.${VOCAB_ROW_CLASS}`) as HTMLElement).click();
      (
        editor.querySelector(`.${EDIT_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      const input = editor.querySelector(
        `.${FIELD_INPUT_CLASS}`,
      ) as HTMLInputElement;
      input.value = "directly cites";

      const originalGet = Zotero.Libraries.get;
      Zotero.Libraries.get = ((id: number) =>
        id === libraryID
          ? ({ editable: false } as unknown as ReturnType<
              typeof Zotero.Libraries.get
            >)
          : originalGet.call(
              Zotero.Libraries,
              id,
            )) as typeof Zotero.Libraries.get;
      try {
        (
          editor.querySelector(
            `.${VOCAB_SAVE_BUTTON_CLASS}`,
          ) as HTMLButtonElement
        ).click();
        await waitFor(
          () => editor.querySelector(`.${VOCAB_ERROR_CLASS}`),
          "the editor to show a write-refused error",
        );
      } finally {
        Zotero.Libraries.get = originalGet;
      }

      // No emit is a negative assertion with no condition to poll for; a
      // fixed delay is the honest way to give a (wrongly) refreshing section
      // time to show it.
      await Zotero.Promise.delay(300);
      assert.equal(
        citingRowMetaText(body),
        originalText,
        "the row changed even though the write was refused",
      );
      assert.notInclude(citingRowMetaText(body), "directly cites");
    });
  });
});
