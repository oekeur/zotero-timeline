import { assert } from "chai";
import {
  STORAGE_TAG,
  findContainers,
  findOrCreateContainer,
  searchStorageNotes,
} from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("timeline sidebar: creating a timeline", function () {
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
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  async function openSidebar(): Promise<{
    doc: Document;
    sidebar: HTMLElement;
  }> {
    const win = Zotero.getMainWindows()[0] as any;
    const doc = win.document as Document;
    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);
    const sidebar = doc.getElementById("zoterotimeline-sidebar") as HTMLElement;
    assert.ok(sidebar, "no sidebar element in the tab");
    return { doc, sidebar };
  }

  // AC #1
  it("creates a timeline from the inline form and lists it in the sidebar", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    const createButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-button",
    ) as HTMLButtonElement;
    assert.isFalse(createButton.disabled, "the create control is disabled");
    createButton.click();

    const nameInput = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-name",
    ) as HTMLInputElement;
    assert.ok(nameInput, "clicking the create control revealed no form");

    const confirmButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-confirm",
    ) as HTMLButtonElement;
    assert.isTrue(
      confirmButton.disabled,
      "confirm started enabled with a blank name",
    );

    nameInput.value = "   ";
    nameInput.dispatchEvent(new Event("input"));
    assert.isTrue(
      confirmButton.disabled,
      "confirm enabled on a whitespace-only name",
    );

    nameInput.value = "New Chronology";
    nameInput.dispatchEvent(new Event("input"));
    assert.isFalse(confirmButton.disabled);
    confirmButton.click();
    await Zotero.Promise.delay(500);

    const names = api
      .getVisibleTimelines()
      .map((t: any) => t.doc.name as string);
    assert.include(names, "New Chronology");

    const rowNames = Array.from(
      sidebar.querySelectorAll(".zoterotimeline-sidebar-row-name"),
    ).map((el) => el.textContent);
    assert.include(rowNames, "New Chronology");

    assert.lengthOf(await searchStorageNotes(libraryID), 3);
  });

  // AC #7. Safe to stub with a bare object rather than the real library
  // spread with one field overridden: nothing on the tab-open path reads
  // anything off this library besides `editable` (searchStorageNotes finds
  // the fixtures first and never calls Zotero.Libraries.get at all).
  it("disables the create control in a library the user cannot write", async function () {
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

      const createButton = sidebar.querySelector(
        ".zoterotimeline-sidebar-create-button",
      ) as HTMLButtonElement;
      assert.isTrue(
        createButton.disabled,
        "the create control stayed enabled in a read-only library",
      );
      assert.lengthOf(await searchStorageNotes(libraryID), 2);
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });

  // AC #4: the container can land in the trash after the form is opened and
  // before Create is clicked - a real ordering, not a theoretical one - and
  // that refusal must be caught rather than left to reject unhandled.
  it("does not create a replacement container when the container is trashed before Create is clicked", async function () {
    const { sidebar } = await openSidebar();
    await Zotero.Promise.delay(500);

    const createButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-button",
    ) as HTMLButtonElement;
    createButton.click();
    const nameInput = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-name",
    ) as HTMLInputElement;
    nameInput.value = "Too Late";
    nameInput.dispatchEvent(new Event("input"));

    const container = await findOrCreateContainer(libraryID);
    container.deleted = true;
    await container.saveTx();

    const confirmButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-confirm",
    ) as HTMLButtonElement;
    confirmButton.click();
    await Zotero.Promise.delay(500);

    // The click handler's own promise is fire-and-forget, so a rejection it
    // failed to catch would not surface here as a thrown error - it would
    // surface as a replacement container, which findOrCreateContainer's own
    // refusal (proven directly in the storage-level test) is what stops.
    // What this proves at the tab's own level is that clicking Create through
    // the race left the sidebar working normally rather than wedged: no new
    // timeline exists, and the two fixtures are still listed.
    const names = api
      .getVisibleTimelines()
      .map((t: any) => t.doc.name as string);
    assert.notInclude(names, "Too Late");
    assert.sameMembers(names, ["Dutch Revolt", "Source production"]);
    assert.lengthOf(
      await findContainers(libraryID),
      0,
      "a replacement container was created over trashed data",
    );
  });
});
