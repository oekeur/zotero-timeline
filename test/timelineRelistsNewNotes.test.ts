import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  CONTAINER_TAG,
  findContainers,
  isContainerTrashed,
  STORAGE_TAG,
} from "../src/modules/timeline/storage";
import { CANVAS_EMPTY_PROMPT_CLASS } from "../src/modules/timeline/timelineTab";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * Notes that enter the library after the tab opened: restored from the
 * trash, created while the tab is already open, or created while a second
 * main window is open. Before this fix the tab's canvas-refresh observer
 * only rebuilt on a `modify` of a note it already held, so none of these
 * listed until the tab was closed and reopened.
 */
describe("re-list notes the open tab does not yet hold", function () {
  this.timeout(60000);

  let libraryID: number;

  const api = () => (Zotero as any).ZoteroTimeline.api;

  function doc(id: string, name: string): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id,
      name,
      events: [
        {
          id: "e-1",
          title: "First",
          date: "1600",
          sources: [],
          tags: [],
        },
      ],
    };
  }

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    api().closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    api().closeTimelineTab();
    api().setTimelineDeleteConfirmForTests();
    await eraseAllPluginItems(libraryID);
  });

  async function rowNamed(name: string): Promise<Element | null> {
    const win = Zotero.getMainWindows()[0] as any;
    const sidebar = win.document.getElementById("zoterotimeline-sidebar");
    if (!sidebar) {
      return null;
    }
    return (
      (
        Array.from(
          sidebar.querySelectorAll(".zoterotimeline-sidebar-row-name"),
        ) as HTMLElement[]
      )
        .find((el) => el.textContent === name)
        ?.closest(".zoterotimeline-sidebar-row") ?? null
    );
  }

  it("lists a timeline again once its note is restored from the trash, without closing the tab", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-trash-restore", "Restored Timeline"),
    );
    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Restored Timeline"),
      "the sidebar to list the fixture timeline",
    );

    note.deleted = true;
    await note.saveTx();
    await waitFor(
      async () => (await rowNamed("Restored Timeline")) === null,
      "the trashed timeline to leave the sidebar",
    );

    note.deleted = false;
    await note.saveTx();
    await waitFor(
      () => rowNamed("Restored Timeline"),
      "the restored timeline to reappear in the sidebar without reopening the tab",
    );
  });

  // Trashing the container takes every timeline under it down without
  // flagging any of the notes themselves: Zotero's own item search excludes
  // a child whose parent is trashed, so the notes stay off the sidebar with
  // no `deleted` of their own to notice. Restoring the container - Zotero's
  // own restoreSelectedItems does exactly this: `parent.deleted = false;
  // await parent.save()`, leaving the untouched children to ride along -
  // fires `modify` for the container id alone, never for the notes it was
  // hiding.
  it("lists a timeline again once its trashed container is restored, without closing the tab", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-container-restore", "Container Restored"),
    );
    const [container] = await findContainers(libraryID);
    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Container Restored"),
      "the sidebar to list the fixture timeline",
    );

    await Zotero.Items.trashTx([container.id]);
    await waitFor(
      async () => (await rowNamed("Container Restored")) === null,
      "the timeline under the trashed container to leave the sidebar",
    );

    container.deleted = false;
    await container.saveTx();
    await waitFor(
      () => rowNamed("Container Restored"),
      "the timeline under the restored container to reappear in the sidebar without reopening the tab",
    );
  });

  const CONTAINER_TRASHED_ID =
    "zoterotimeline-timeline-canvas-container-trashed";
  const NO_TIMELINES_ID = "zoterotimeline-timeline-canvas-no-timelines";

  function mainWindow(): any {
    return Zotero.getMainWindows()[0] as any;
  }

  async function promptElement(): Promise<HTMLElement | null> {
    return mainWindow().document.querySelector(`.${CANVAS_EMPTY_PROMPT_CLASS}`);
  }

  /**
   * The prompt's data-l10n-id proves nothing on its own: mainWindow.ftl is
   * the only bundle the main window links (src/hooks.ts), so a key that
   * exists only in addon.ftl resolves to nothing and the canvas renders
   * blank text under a correct-looking attribute. Every assertion on a
   * prompt's id in this file also confirms document.l10n actually produced
   * something for it.
   */
  async function assertPromptRenders(id: string): Promise<void> {
    const el = await waitFor(
      () => promptElement(),
      "the canvas empty prompt to render",
    );
    assert.equal(
      el.getAttribute("data-l10n-id"),
      id,
      "the canvas prompt has the wrong message selected",
    );
    const rendered = await mainWindow().document.l10n.formatValue(id);
    assert.isNotNull(
      rendered,
      `document.l10n.formatValue(${id}) returned null, so the prompt renders blank`,
    );
  }

  // The rebuild the container's own trash now triggers can empty the
  // sidebar with the tab already open, a state the canvas prompt used to be
  // unable to reach (before this fix, nothing rebuilt the tab at all, so
  // the stale pre-trash render just stayed put). The prompt's own selection
  // has to name the trash rather than repeat the generic "use the plus
  // control" line, since the plus control refuses here too.
  it("shows the container-trashed prompt on the canvas while the container is trashed, and clears it once restored", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-container-prompt", "Prompt Timeline"),
    );
    const [container] = await findContainers(libraryID);
    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Prompt Timeline"),
      "the sidebar to list the fixture timeline",
    );

    await Zotero.Items.trashTx([container.id]);
    await waitFor(
      async () => (await rowNamed("Prompt Timeline")) === null,
      "the timeline under the trashed container to leave the sidebar",
    );
    await assertPromptRenders(CONTAINER_TRASHED_ID);

    container.deleted = false;
    await container.saveTx();
    await waitFor(
      () => rowNamed("Prompt Timeline"),
      "the timeline to reappear once the container is restored",
    );
    assert.isNull(
      await promptElement(),
      "the container-trashed prompt is still showing once the timeline is back",
    );
  });

  // The container going down with the trash is the one state where the plus
  // control genuinely refuses (findOrCreateContainer throws container-
  // trashed rather than making a replacement); a trashed note beside a live
  // container is a different state the plus handles fine, so the prompt
  // must not claim otherwise. Reached two ways, both proven here since they
  // exercise different code paths: an external trash lands as a `modify` on
  // the note and a rebuild recomputes isContainerTrashed, while the
  // sidebar's own delete control removes the last timeline through
  // deleteTimeline directly.
  it("keeps the no-timelines prompt, and lets the plus control create, when the last note is trashed outside the container", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-last-note", "Last Note"),
    );
    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Last Note"),
      "the sidebar to list the fixture timeline",
    );

    note.deleted = true;
    await note.saveTx();
    await waitFor(
      async () => (await rowNamed("Last Note")) === null,
      "the trashed timeline to leave the sidebar",
    );
    await assertPromptRenders(NO_TIMELINES_ID);

    const win = mainWindow();
    const sidebar = win.document.getElementById("zoterotimeline-sidebar");
    (
      sidebar.querySelector(
        ".zoterotimeline-sidebar-create-button",
      ) as HTMLButtonElement
    ).click();
    const input = sidebar.querySelector(
      ".zoterotimeline-sidebar-create-name",
    ) as HTMLInputElement;
    input.value = "Fresh One";
    input.dispatchEvent(new Event("input"));
    (
      sidebar.querySelector(
        ".zoterotimeline-sidebar-create-confirm",
      ) as HTMLButtonElement
    ).click();

    await waitFor(
      () => rowNamed("Fresh One"),
      "the plus control to create a timeline over a live container beside a trashed note",
    );
  });

  it("keeps the no-timelines prompt when the last timeline is deleted through the sidebar", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-last-row", "Last Row"),
    );
    await api().openTimelineTab();
    const row = (await waitFor(
      () => rowNamed("Last Row"),
      "the sidebar to list the fixture timeline",
    )) as HTMLElement;

    api().setTimelineDeleteConfirmForTests(() => true);
    (
      row.querySelector(
        ".zoterotimeline-sidebar-row-delete",
      ) as HTMLButtonElement
    ).click();
    await waitFor(
      async () => (await rowNamed("Last Row")) === null,
      "the deleted timeline to leave the sidebar",
    );
    await assertPromptRenders(NO_TIMELINES_ID);
  });

  // The flag rebuildCanvas keeps for the empty prompt used to sit past the
  // drawnMatches early return, so an empty-to-empty pass - the trash emptied
  // entirely, nothing left to draw before or after - never reran it: the
  // prompt kept naming the trash until the tab was closed and reopened,
  // because a rebuild is what recomputes the flag and an empty-to-empty
  // pass never reached the assignment. Erasing fires `delete`, which
  // schedules a rebuild whenever containerTrashed is already true - the
  // reason notifyTimelineChanged reacts to the flag rather than to which id
  // was deleted, see that function's own comment for why an id cached at
  // open time cannot cover every way a container is trashed and erased.
  it("stops naming the trash once the trashed container is erased permanently, without reopening the tab", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-erase-recheck", "Erase Recheck"),
    );
    const [container] = await findContainers(libraryID);
    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Erase Recheck"),
      "the sidebar to list the fixture timeline",
    );

    await Zotero.Items.trashTx([container.id]);
    await waitFor(
      async () => (await rowNamed("Erase Recheck")) === null,
      "the timeline under the trashed container to leave the sidebar",
    );
    await assertPromptRenders(CONTAINER_TRASHED_ID);

    await container.eraseTx();
    assert.isFalse(
      await isContainerTrashed(libraryID),
      "control: storage reports the container is no longer trashed once it is erased",
    );
    await waitFor(
      async () =>
        (await promptElement())?.getAttribute("data-l10n-id") !==
        CONTAINER_TRASHED_ID
          ? true
          : null,
      "the prompt to stop naming the trash once it is emptied, without reopening the tab",
    );
    await assertPromptRenders(NO_TIMELINES_ID);
  });

  // A cached container id (resolved once at open, from a search that
  // already excludes trashed items by construction) never held this one:
  // the container was trashed before the tab ever opened, so the id was
  // never live to be found. containerTrashed itself has no such gap - it is
  // read straight from storage at open the same way it is after a rebuild -
  // which is why the delete branch reacts to that flag rather than to an id.
  it("shows the container-trashed prompt when the tab opens onto an already-trashed container, and clears it on erase", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-open-onto-trashed", "Open Onto Trashed"),
    );
    const [container] = await findContainers(libraryID);
    await Zotero.Items.trashTx([container.id]);

    await api().openTimelineTab();
    await assertPromptRenders(CONTAINER_TRASHED_ID);

    await container.eraseTx();
    await waitFor(
      async () =>
        (await promptElement())?.getAttribute("data-l10n-id") !==
        CONTAINER_TRASHED_ID
          ? true
          : null,
      "the prompt to stop naming the trash once the already-trashed container is erased, without reopening the tab",
    );
    await assertPromptRenders(NO_TIMELINES_ID);
  });

  // A second, uncached container: trashing both and erasing them in either
  // order must still land on the no-timelines prompt once neither is left,
  // not get stuck reacting to whichever one a cached id happened to name.
  it("clears the container-trashed prompt once every trashed container is erased, not only the first", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-two-containers", "Two Containers"),
    );
    const duplicate = new Zotero.Item("document");
    duplicate.libraryID = libraryID;
    duplicate.setField("title", "Duplicate container");
    duplicate.addTag(CONTAINER_TAG);
    await duplicate.saveTx();
    const containers = await findContainers(libraryID);
    assert.lengthOf(containers, 2, "fixture: two live containers");

    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Two Containers"),
      "the sidebar to list the fixture timeline",
    );

    await Zotero.Items.trashTx([containers[1].id]);
    await Zotero.Items.trashTx([containers[0].id]);
    await assertPromptRenders(CONTAINER_TRASHED_ID);

    await containers[0].eraseTx();
    await containers[1].eraseTx();
    await waitFor(
      async () =>
        (await promptElement())?.getAttribute("data-l10n-id") !==
        CONTAINER_TRASHED_ID
          ? true
          : null,
      "the prompt to stop naming the trash once both containers are erased, without reopening the tab",
    );
    await assertPromptRenders(NO_TIMELINES_ID);
  });

  it("lists a storage note created while the tab is already open", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-already-open", "Already Open"),
    );
    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Already Open"),
      "the sidebar to list the fixture timeline",
    );

    await api().createDocumentNoteForTests(
      libraryID,
      doc("doc-created-live", "Created Live"),
    );

    await waitFor(
      () => rowNamed("Created Live"),
      "the newly created timeline to appear in the sidebar without reopening the tab",
    );
  });

  // The observer's tag check alone can't tell a foreign-library note from
  // one of this tab's own - rebuildCanvas's own listTimelinesCached(libraryID)
  // call is what keeps a note in a different library from ever reaching the
  // canvas, since it only ever re-lists the tab's own library.
  it("does not redraw when a storage note is added to a different library", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-home", "Home Timeline"),
    );
    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Home Timeline"),
      "the sidebar to list the fixture timeline",
    );

    const group = new Zotero.Group();
    Object.assign(group as unknown as Record<string, unknown>, {
      id: 636363,
      name: "Elsewhere",
      description: "",
      version: 1,
      editable: true,
      filesEditable: true,
    });
    await group.saveTx();
    try {
      const passesBefore = api().rebuildPassesSoFar();
      const rebuildsBefore = api().rebuildsSoFar();

      await createDocumentNote(
        group.libraryID,
        STORAGE_TAG,
        doc("doc-elsewhere", "Elsewhere Timeline"),
      );

      await waitFor(
        () => api().rebuildPassesSoFar() > passesBefore,
        "the foreign-library add to schedule a rebuild pass",
      );
      // A pass being scheduled is not a redraw: the pass has to actually
      // run and find nothing changed, which has no condition of its own to
      // poll for.
      await Zotero.Promise.delay(300);

      assert.strictEqual(
        api().rebuildsSoFar(),
        rebuildsBefore,
        "a storage note added to a different library redrew this tab's canvas",
      );
      assert.isNull(
        await rowNamed("Elsewhere Timeline"),
        "a note from another library leaked into this tab's sidebar",
      );
    } finally {
      await eraseAllPluginItems(group.libraryID);
      await group.eraseTx();
    }
  });

  describe("a storage note created while a second main window is open", function () {
    this.timeout(120000);

    let second: any;

    async function openSecondWindow(): Promise<any> {
      const existing = new Set(Zotero.getMainWindows());
      (Zotero as any).openMainWindow();
      const opened = await waitFor(
        () => Zotero.getMainWindows().find((w: any) => !existing.has(w)),
        "a second main window to open",
        { timeout: 20000, interval: 250 },
      );
      await waitFor(
        () => (opened as any).document?.getElementById("menu_ToolsPopup"),
        "the second window's Tools menu to exist",
        { timeout: 20000, interval: 250 },
      );
      return opened;
    }

    async function closeSecondWindow(win: any): Promise<void> {
      if (!win || win.closed) {
        return;
      }
      win.close();
      await waitFor(
        () => !Zotero.getMainWindows().includes(win) || undefined,
        "the second main window to close",
        { timeout: 20000, interval: 250 },
      );
      await waitFor(
        () => Zotero.getMainWindows().length === 1 || undefined,
        "exactly one main window to be left behind",
        { timeout: 20000, interval: 250 },
      );
    }

    afterEach(async function () {
      await closeSecondWindow(second);
      second = undefined;
    });

    it("appears in the first window's open tab", async function () {
      await createDocumentNote(
        libraryID,
        STORAGE_TAG,
        doc("doc-first-window", "First Window"),
      );
      await api().openTimelineTab();
      await waitFor(
        () => rowNamed("First Window"),
        "the sidebar to list the fixture timeline",
      );

      second = await openSecondWindow();

      // The write itself carries no window identity - Zotero.Notifier fires
      // the same way no matter which window's code path asked for it - so
      // this is the same mechanism a write issued from the second window's
      // own document would use, exercised with a second window genuinely
      // open at the same time.
      await api().createDocumentNoteForTests(
        libraryID,
        doc("doc-from-second-window", "From Second Window"),
      );

      await waitFor(
        () => rowNamed("From Second Window"),
        "the first window's sidebar to list a timeline created while a second window was open",
      );
    });
  });
});
