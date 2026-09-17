import { assert } from "chai";
import {
  STORAGE_TAG,
  findContainers,
  findOrCreateContainer,
  listTimelines,
  searchStorageNotes,
} from "../src/modules/timeline/storage";
import {
  CREATE_BUTTON_CLASS,
  CREATE_DATE_INPUT_CLASS,
  CREATE_DOCUMENT_SELECT_CLASS,
  CREATE_TITLE_INPUT_CLASS,
  SAVE_BUTTON_CLASS,
  TAG_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

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
    const sidebar = (await waitFor(() => {
      const el = doc.getElementById("zoterotimeline-sidebar");
      return el?.querySelector(".zoterotimeline-sidebar-create-button")
        ? el
        : null;
    }, "the sidebar's create control to render")) as HTMLElement;
    return { doc, sidebar };
  }

  // AC #1
  it("creates a timeline from the inline form and lists it in the sidebar", async function () {
    const { sidebar } = await openSidebar();

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
    await waitFor(
      () =>
        api
          .getVisibleTimelines()
          .some((t: any) => t.doc.name === "New Chronology")
          ? true
          : null,
      "the new timeline to appear in the visible set",
    );

    const names = api
      .getVisibleTimelines()
      .map((t: any) => t.doc.name as string);
    assert.include(names, "New Chronology");

    const rowNames = Array.from<HTMLElement>(
      sidebar.querySelectorAll(".zoterotimeline-sidebar-row-name"),
    ).map((el) => el.textContent);
    assert.include(rowNames, "New Chronology");

    assert.lengthOf(await searchStorageNotes(libraryID), 3);
  });

  /**
   * A storage note's own `add` notification can schedule a rebuild that
   * registers the new document before the confirm handler's own continuation
   * does, or the other way around: either ordering has to leave the form
   * closed, exactly one sidebar row and one readable entry for the new
   * document, and no failure logged.
   */
  it("closes the form and registers the new timeline exactly once, whichever of the rebuild or the create resolves first", async function () {
    const { sidebar } = await openSidebar();
    const errorsBefore = new Set(Zotero.getErrors(true) as string[]);

    const createButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-button",
    ) as HTMLButtonElement;
    createButton.click();

    const nameInput = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-name",
    ) as HTMLInputElement;
    nameInput.value = "Once Only";
    nameInput.dispatchEvent(new Event("input"));

    const confirmButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-confirm",
    ) as HTMLButtonElement;
    confirmButton.click();

    const docId = (await waitFor(() => {
      const created = api
        .getVisibleTimelines()
        .find((t: any) => t.doc.name === "Once Only");
      return created ? created.doc.id : null;
    }, "the new timeline to appear in the visible set")) as string;

    await waitFor(
      () =>
        sidebar.querySelector(".zoterotimeline-sidebar-create-form") === null
          ? true
          : null,
      "the create form to close",
    );

    // Long enough for a rebuild scheduled by the note write to have run its
    // course either before or after the assertions above landed.
    await Zotero.Promise.delay(1500);

    assert.isNull(
      sidebar.querySelector(".zoterotimeline-sidebar-create-form"),
      "the create form was open again after the create settled",
    );

    const rows = sidebar.querySelectorAll(`[data-timeline-id="${docId}"]`);
    assert.lengthOf(
      rows,
      1,
      "the sidebar listed the new timeline more than once",
    );

    const visibleMatches = api
      .getVisibleTimelines()
      .filter((t: any) => t.doc.id === docId);
    assert.lengthOf(
      visibleMatches,
      1,
      "the readable set listed the new timeline more than once",
    );

    const newErrors = (Zotero.getErrors(true) as string[]).filter(
      (e) => !errorsBefore.has(e),
    );
    assert.isFalse(
      newErrors.some((e) => e.includes("failed to create a timeline")),
      `unexpected create failure logged: ${newErrors.join(" | ")}`,
    );
  });

  /**
   * A sidebar-created timeline's doc object must be the same object
   * everywhere it is read, whichever of the note-write's own rebuild or the
   * create handler's continuation registers it first: an event typed onto it
   * through the editor, then tagged and saved, has to reach
   * getVisibleTimelines() and the tag chip bank without the tab reloading.
   */
  it("offers a typed event and its tag on a sidebar-created timeline without a further rebuild", async function () {
    const win = Zotero.getMainWindows()[0] as any;
    const winDoc = win.document as Document;
    const { sidebar } = await openSidebar();

    const createButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-button",
    ) as HTMLButtonElement;
    createButton.click();
    const nameInput = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-name",
    ) as HTMLInputElement;
    nameInput.value = "Fresh";
    nameInput.dispatchEvent(new Event("input"));
    (
      sidebar.querySelector(
        ".zoterotimeline-sidebar-create-confirm",
      ) as HTMLButtonElement
    ).click();

    const docId = (await waitFor(() => {
      const created = api
        .getVisibleTimelines()
        .find((t: any) => t.doc.name === "Fresh");
      return created ? created.doc.id : null;
    }, "the new timeline to appear in the visible set")) as string;
    // Long enough for the note write's own rebuild to have run its course
    // either before or after the create handler's continuation, so the
    // assertions below hold under whichever ordering occurs.
    await Zotero.Promise.delay(1500);

    const timeline = api.getCurrentTimeline();
    timeline.setSelection([]);
    const panel = winDoc.getElementById("zoterotimeline-editor") as HTMLElement;
    const select = (await waitFor(() => {
      const s = panel.querySelector(
        `.${CREATE_DOCUMENT_SELECT_CLASS}`,
      ) as HTMLSelectElement | null;
      return s &&
        (Array.from(s.options) as HTMLOptionElement[]).some(
          (o) => o.value === docId,
        )
        ? s
        : null;
    }, "the create picker to list the new document")) as HTMLSelectElement;
    select.value = docId;
    (
      panel.querySelector(`.${CREATE_TITLE_INPUT_CLASS}`) as HTMLInputElement
    ).value = "Typed";
    (
      panel.querySelector(`.${CREATE_DATE_INPUT_CLASS}`) as HTMLInputElement
    ).value = "1650";
    (
      panel.querySelector(`.${CREATE_BUTTON_CLASS}`) as HTMLButtonElement
    ).click();

    const created = await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const d = timelines.find((t) => t.doc.id === docId)?.doc;
      return d && d.events.length > 0 ? d.events[0] : null;
    }, "the typed event to land in storage");
    await waitFor(
      () =>
        timeline.getSelection()[0] === `${docId}:${created.id}` ? true : null,
      "the new event to be selected",
    );

    const tagInput = (await waitFor(
      () => panel.querySelector(`.${TAG_INPUT_CLASS}`),
      "the tag input for the newly created event",
    )) as HTMLInputElement;
    tagInput.value = "freshTag";
    tagInput.dispatchEvent(
      new (winDoc.defaultView as any).Event("input", { bubbles: true }),
    );
    tagInput.dispatchEvent(
      new (winDoc.defaultView as any).KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    (panel.querySelector(`.${SAVE_BUTTON_CLASS}`) as HTMLButtonElement).click();

    await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const d = timelines.find((t) => t.doc.id === docId)?.doc;
      return d?.events[0]?.tags.includes("freshTag") ? true : null;
    }, "the tag to land in storage");
    await Zotero.Promise.delay(1500);

    const visible = api
      .getVisibleTimelines()
      .find((t: any) => t.doc.id === docId);
    assert.equal(
      visible?.doc.events.length,
      1,
      "getVisibleTimelines() did not carry the event created on the sidebar-created timeline",
    );
    assert.include(
      api.getAvailableTags(),
      "freshTag",
      "the chip bank did not carry the tag added on the sidebar-created timeline",
    );
  });

  /**
   * The confirm click disables the button clicked, but creatingTimeline stays
   * true across the create's own await, so a rebuild racing it - here, the
   * new note's own "add" notification - can build a fresh form before the
   * write settles. That fresh form's confirm must stay disabled until the
   * create resolves; otherwise a second click on it creates a duplicate.
   */
  it("keeps a rebuilt create form's confirm disabled while the first create is still in flight", async function () {
    const { doc: winDoc, sidebar } = await openSidebar();

    const createButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-button",
    ) as HTMLButtonElement;
    createButton.click();
    const nameInput = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-name",
    ) as HTMLInputElement;
    nameInput.value = "Dup";
    nameInput.dispatchEvent(new Event("input"));
    const confirmButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-confirm",
    ) as HTMLButtonElement;

    let clickedFresh = false;
    const win = winDoc.defaultView as any;
    const mo = new win.MutationObserver(() => {
      if (clickedFresh) {
        return;
      }
      const form = sidebar.querySelector(".zoterotimeline-sidebar-create-form");
      if (!form) {
        return;
      }
      const freshConfirm = form.querySelector(
        ".zoterotimeline-sidebar-create-confirm",
      ) as HTMLButtonElement;
      const freshInput = form.querySelector(
        ".zoterotimeline-sidebar-create-name",
      ) as HTMLInputElement;
      if (
        freshConfirm !== confirmButton &&
        !freshConfirm.disabled &&
        freshInput.value === "Dup"
      ) {
        clickedFresh = true;
        freshConfirm.click();
      }
    });
    mo.observe(sidebar, { childList: true, subtree: true, attributes: true });
    confirmButton.click();

    await Zotero.Promise.delay(2000);
    mo.disconnect();

    const { timelines } = await listTimelines(libraryID);
    const dups = timelines.filter((t) => t.doc.name === "Dup");
    assert.lengthOf(
      dups,
      1,
      `a click on a rebuilt form's enabled confirm produced ${dups.length} timelines named "Dup" (clickedFresh=${clickedFresh})`,
    );
  });

  // AC #7. Safe to stub with a bare object rather than the real library
  // spread with fields overridden: the tab-open path reads only `editable`
  // and, since the read-only banner, `name` off this library
  // (searchStorageNotes finds the fixtures first and never calls
  // Zotero.Libraries.get for anything else).
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

    // The canvas-refresh observer now reacts to the container's own trash,
    // the same way it reacts to a note's, so the two fixtures - children of
    // the container just trashed - leave the visible set on their own
    // before Create is even clicked: Zotero's item search excludes a child
    // of a deleted parent, and a rebuild picks that up.
    await waitFor(
      () => (api.getVisibleTimelines().length === 0 ? true : null),
      "the fixtures to leave the sidebar once their container is trashed",
    );

    // The rebuild that empties the sidebar also re-renders the still-open
    // create form (creatingTimeline is untouched by any of this), which
    // replaces nameInput and the confirm button with new elements carrying
    // the already-typed name forward - the pre-rebuild references are now
    // detached, so clicking through them again would dispatch nothing and
    // pass vacuously. Re-querying and re-typing is what actually reaches the
    // confirm click the race is testing.
    const nameInputAfter = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-name",
    ) as HTMLInputElement;
    nameInputAfter.value = "Too Late";
    nameInputAfter.dispatchEvent(new Event("input"));
    const confirmButton = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-confirm",
    ) as HTMLButtonElement;
    assert.isFalse(
      confirmButton.disabled,
      "confirm stayed disabled after retyping the name into the rebuilt form",
    );
    confirmButton.click();
    // Asserting nothing gets created has no condition to poll for.
    await Zotero.Promise.delay(500);

    // The click handler's own promise is fire-and-forget, so a rejection it
    // failed to catch would not surface here as a thrown error - it would
    // surface as a replacement container, which findOrCreateContainer's own
    // refusal (proven directly in the storage-level test) is what stops.
    // What this proves at the tab's own level is that clicking Create through
    // the race left the sidebar working normally rather than wedged: no new
    // timeline exists, and the trashed fixtures stay gone rather than the
    // click resurrecting them through some other path.
    const names = api
      .getVisibleTimelines()
      .map((t: any) => t.doc.name as string);
    assert.notInclude(names, "Too Late");
    assert.isEmpty(names);
    assert.lengthOf(
      await findContainers(libraryID),
      0,
      "a replacement container was created over trashed data",
    );
    // Proves the click actually reached createTimelineOrWarn rather than
    // having dispatched nothing: on refusal the handler still sets
    // creatingTimeline = false and re-renders, which is what closes the
    // form. A click that never fired would leave it open.
    assert.isNull(
      sidebar.querySelector(".zoterotimeline-sidebar-create-name"),
      "the create form is still open, so the click never reached the write path",
    );
  });
});
