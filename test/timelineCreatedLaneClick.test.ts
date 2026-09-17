import { assert } from "chai";
import {
  STORAGE_TAG,
  listTimelines,
  updateTimelineDocument,
} from "../src/modules/timeline/storage";
import {
  SIDEBAR_CREATE_BUTTON_CLASS,
  SIDEBAR_CREATE_CONFIRM_CLASS,
  SIDEBAR_CREATE_NAME_INPUT_CLASS,
} from "../src/modules/timeline/timelineTab";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * A timeline created through the sidebar's + form has to reach canvas.ts's
 * own `documents` map, not just the tab's: the click handler reads that map
 * to find the document to create an event into, and used to find nothing and
 * return silently for a document added after the canvas last rendered.
 */
describe("clicking the lane of a timeline created from the sidebar", function () {
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
      return el?.querySelector(`.${SIDEBAR_CREATE_BUTTON_CLASS}`) ? el : null;
    }, "the sidebar's create control to render")) as HTMLElement;
    return { doc, sidebar };
  }

  /** Drives the inline create form to completion and returns the new doc id. */
  async function createTimelineNamed(
    sidebar: HTMLElement,
    name: string,
  ): Promise<string> {
    const createButton = sidebar.querySelector(
      `.${SIDEBAR_CREATE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    createButton.click();

    const nameInput = sidebar.querySelector(
      `.${SIDEBAR_CREATE_NAME_INPUT_CLASS}`,
    ) as HTMLInputElement;
    nameInput.value = name;
    nameInput.dispatchEvent(new Event("input"));

    const confirmButton = sidebar.querySelector(
      `.${SIDEBAR_CREATE_CONFIRM_CLASS}`,
    ) as HTMLButtonElement;
    confirmButton.click();

    const created = await waitFor(
      () =>
        api.getVisibleTimelines().find((t: any) => t.doc.name === name) ?? null,
      `the new timeline "${name}" to appear in the visible set`,
    );
    return created.doc.id;
  }

  /**
   * A click on an inactive lane only activates it (TASK-16's priming click),
   * so creating into a lane that was not already active needs two: the
   * fixtures load doc-revolt as the initial active lane, and a freshly
   * created timeline is never the active one.
   */
  async function clickTwiceToCreate(
    timeline: any,
    docId: string,
  ): Promise<void> {
    timeline.emit("click", {
      item: null,
      group: docId,
      time: new Date(Date.UTC(1600, 0, 1)),
    });
    await Zotero.Promise.delay(300);
    timeline.emit("click", {
      item: null,
      group: docId,
      time: new Date(Date.UTC(1600, 0, 1)),
    });
  }

  async function eventCount(docId: string): Promise<number> {
    const { timelines } = await listTimelines(libraryID);
    return timelines.find((t) => t.doc.id === docId)?.doc.events.length ?? -1;
  }

  it("creates an event when the newly created timeline's lane is clicked, in the same tab session", async function () {
    const { sidebar } = await openSidebar();
    const docId = await createTimelineNamed(sidebar, "Fresh");
    const timeline = api.getCurrentTimeline();

    await clickTwiceToCreate(timeline, docId);

    await waitFor(
      async () => ((await eventCount(docId)) === 1 ? true : null),
      "the clicked-in event to reach the stored document",
    );
    assert.equal(
      await eventCount(docId),
      1,
      "the new timeline's lane click created no event",
    );
  });

  it("still works after a rebuild replaces the canvas the timeline was created against", async function () {
    const { sidebar } = await openSidebar();

    const before = api.rebuildsSoFar();
    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [
          ...current.events,
          {
            id: "ev-outside",
            title: "Written from outside",
            date: "1700",
            sources: [],
            tags: [],
          },
        ],
      }),
      "doc-revolt",
      libraryID,
    );
    await waitFor(
      () => (api.rebuildsSoFar() > before ? true : null),
      "a rebuild after the outside write",
    );

    const docId = await createTimelineNamed(sidebar, "Fresh After Rebuild");
    const timeline = api.getCurrentTimeline();

    await clickTwiceToCreate(timeline, docId);

    await waitFor(
      async () => ((await eventCount(docId)) === 1 ? true : null),
      "the clicked-in event to reach the stored document after a rebuild",
    );
    assert.equal(
      await eventCount(docId),
      1,
      "the new timeline's lane click created no event after a rebuild",
    );
  });

  it("logs a failure naming the group id when a click's group parses to a document the canvas does not hold", async function () {
    await openSidebar();
    const timeline = api.getCurrentTimeline();
    // A group vis-timeline itself treats as real and visible (so activation
    // sticks rather than falling back to the topmost visible lane), backed by
    // no document at all - the exact shape a canvas that never learned about
    // a newly created document leaves behind.
    (
      timeline.groupsData as {
        getDataSet: () => { add: (row: unknown) => unknown };
      }
    )
      .getDataSet()
      .add({
        id: "doc-ghost",
        content: "Ghost",
        order: 999,
        visible: true,
      });

    // Both emitted in the same synchronous turn, with no await between them:
    // a group with no matching document never counts as a real lane
    // (documentGroupRows() filters on exactly that), so the fallback that
    // reactivates the topmost visible lane once activation settles would
    // otherwise undo the first click's activation before the second lands.
    timeline.emit("click", {
      item: null,
      group: "doc-ghost",
      time: new Date(Date.UTC(1600, 0, 1)),
    });
    timeline.emit("click", {
      item: null,
      group: "doc-ghost",
      time: new Date(Date.UTC(1600, 0, 1)),
    });

    await waitFor(
      () =>
        Zotero.getErrors(true).some((entry: string) =>
          entry.includes("doc-ghost"),
        )
          ? true
          : null,
      "a logged failure naming the unknown group id",
    );
  });
});
