import { assert } from "chai";
import {
  STORAGE_TAG,
  searchStorageNotes,
} from "../src/modules/timeline/storage";
import {
  EMPTY_PROMPT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

// Driven through Zotero.ZoteroTimeline.api, the same way timelineSidebar.test.ts
// is: the sidebar state (the vis groups DataSet, the documents map) lives in
// whichever module instance actually opened the tab, not this file's own copy.
describe("timeline sidebar: renaming and deleting a timeline", function () {
  this.timeout(60000);

  let libraryID: number;
  let api: any;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
    api = (Zotero as any).ZoteroTimeline.api;
  });

  function threeFixtureDocuments() {
    return [
      ...canvasFixtureDocuments(),
      documentNamed("Third Timeline", "doc-third"),
    ];
  }

  beforeEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    for (const document of threeFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, document);
    }
  });

  afterEach(async function () {
    api.closeTimelineTab();
    api.setTimelineDeleteConfirmForTests();
    await eraseAllPluginItems(libraryID);
  });

  async function openSidebar(): Promise<{
    win: any;
    doc: Document;
    sidebar: HTMLElement;
  }> {
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document as Document;
    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);
    const sidebar = doc.getElementById("zoterotimeline-sidebar") as HTMLElement;
    assert.ok(sidebar, "no sidebar element in the tab");
    return { win, doc, sidebar };
  }

  // AC #6
  it("renames only the timeline whose row the control sits in", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-sources"]',
    ) as HTMLElement;
    (
      row.querySelector(
        ".zoterotimeline-sidebar-row-rename",
      ) as HTMLButtonElement
    ).click();

    const nameInput = sidebar.querySelector(
      ".zoterotimeline-sidebar-row-rename-name",
    ) as HTMLInputElement;
    assert.equal(nameInput.value, "Source production");
    nameInput.value = "Print culture";
    nameInput.dispatchEvent(new Event("input"));

    (
      sidebar.querySelector(
        ".zoterotimeline-sidebar-row-rename-confirm",
      ) as HTMLButtonElement
    ).click();
    await Zotero.Promise.delay(500);

    const names = api.getVisibleTimelines().map((t: any) => t.doc.name);
    assert.include(names, "Print culture");
    assert.include(names, "Dutch Revolt");
    assert.include(names, "Third Timeline");
    assert.notInclude(names, "Source production");

    const rowNames = Array.from(
      sidebar.querySelectorAll(".zoterotimeline-sidebar-row-name"),
    ).map((el) => el.textContent);
    assert.include(rowNames, "Print culture");
  });

  // AC #2, the sidebar-level guard for the same refusal storage.ts makes
  it("does not let the rename confirm button submit a blank name", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-revolt"]',
    ) as HTMLElement;
    (
      row.querySelector(
        ".zoterotimeline-sidebar-row-rename",
      ) as HTMLButtonElement
    ).click();

    const nameInput = sidebar.querySelector(
      ".zoterotimeline-sidebar-row-rename-name",
    ) as HTMLInputElement;
    const confirmButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-row-rename-confirm",
    ) as HTMLButtonElement;

    nameInput.value = "   ";
    nameInput.dispatchEvent(new Event("input"));
    assert.isTrue(confirmButton.disabled);
  });

  // AC #3
  it("confirms before deleting, naming the timeline and its event count, and does nothing on cancel", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    let confirmTitle: string | undefined;
    let confirmMessage: string | undefined;
    api.setTimelineDeleteConfirmForTests(
      (_win: unknown, title: string, message: string) => {
        confirmTitle = title;
        confirmMessage = message;
        return false;
      },
    );

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-revolt"]',
    ) as HTMLElement;
    (
      row.querySelector(
        ".zoterotimeline-sidebar-row-delete",
      ) as HTMLButtonElement
    ).click();
    await Zotero.Promise.delay(300);

    assert.isDefined(confirmTitle);
    assert.include(confirmMessage, "Dutch Revolt");
    assert.include(confirmMessage!, "2");

    const names = api.getVisibleTimelines().map((t: any) => t.doc.name);
    assert.include(
      names,
      "Dutch Revolt",
      "cancelling the confirm deleted it anyway",
    );
    assert.lengthOf(await searchStorageNotes(libraryID), 3);
  });

  // AC #6, for delete
  it("deletes only the timeline whose row the control sits in", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    api.setTimelineDeleteConfirmForTests(() => true);

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-sources"]',
    ) as HTMLElement;
    (
      row.querySelector(
        ".zoterotimeline-sidebar-row-delete",
      ) as HTMLButtonElement
    ).click();
    await Zotero.Promise.delay(500);

    const names = api.getVisibleTimelines().map((t: any) => t.doc.name);
    assert.notInclude(names, "Source production");
    assert.include(names, "Dutch Revolt");
    assert.include(names, "Third Timeline");
    assert.lengthOf(await searchStorageNotes(libraryID), 2);
  });

  // AC #4. The detach has to happen ahead of the erase settling, so this
  // reads the canvas state synchronously right after the click - before any
  // delay - which is only possible if everything up to the detach ran
  // before the handler's first await.
  it("detaches the deleted timeline from the canvas before the erase resolves", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    api.setTimelineDeleteConfirmForTests(() => true);

    assert.include(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      "doc-revolt",
    );

    const row = sidebar.querySelector(
      '[data-timeline-id="doc-revolt"]',
    ) as HTMLElement;
    (
      row.querySelector(
        ".zoterotimeline-sidebar-row-delete",
      ) as HTMLButtonElement
    ).click();

    // No delay: the click handler's synchronous portion, which includes the
    // canvas detach, has already run by the time click() returns.
    assert.notInclude(
      api.getVisibleTimelines().map((t: any) => t.doc.id),
      "doc-revolt",
      "the canvas still rendered the timeline right after the delete click",
    );

    await Zotero.Promise.delay(500);
    assert.lengthOf(await searchStorageNotes(libraryID), 2);
  });

  // AC #5
  it("clears the editor panel's selection when its timeline is deleted", async function () {
    const { doc, sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    const timeline = api.getCurrentTimeline();
    timeline.setSelection(["doc-revolt:ev-fury"]);
    await Zotero.Promise.delay(300);

    const panel = doc.getElementById("zoterotimeline-editor") as HTMLElement;
    assert.ok(
      panel.querySelector(`.${TITLE_INPUT_CLASS}`),
      "selecting the event did not open the editor",
    );

    api.setTimelineDeleteConfirmForTests(() => true);
    const row = sidebar.querySelector(
      '[data-timeline-id="doc-revolt"]',
    ) as HTMLElement;
    (
      row.querySelector(
        ".zoterotimeline-sidebar-row-delete",
      ) as HTMLButtonElement
    ).click();
    await Zotero.Promise.delay(500);

    assert.ok(
      panel.querySelector(`.${EMPTY_PROMPT_CLASS}`),
      "the editor kept offering Save on an event in a deleted timeline",
    );
  });

  // AC #8
  it("disables rename and delete rather than hiding them in a library the user cannot write", async function () {
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
      const { sidebar } = await openSidebar();
      await Zotero.Promise.delay(500);

      const row = sidebar.querySelector(
        '[data-timeline-id="doc-revolt"]',
      ) as HTMLElement;
      const renameButton = row.querySelector(
        ".zoterotimeline-sidebar-row-rename",
      );
      const deleteButton = row.querySelector(
        ".zoterotimeline-sidebar-row-delete",
      );

      assert.ok(
        renameButton,
        "the read-only rule hid rename rather than disabling it",
      );
      assert.ok(
        deleteButton,
        "the read-only rule hid delete rather than disabling it",
      );
      assert.isTrue(
        (renameButton as HTMLButtonElement).disabled,
        "rename stayed enabled",
      );
      assert.isTrue(
        (deleteButton as HTMLButtonElement).disabled,
        "delete stayed enabled",
      );
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });
});
