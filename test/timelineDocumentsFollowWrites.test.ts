import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  listTimelines,
  updateTimelineDocument,
} from "../src/modules/timeline/storage";
import { TAG_FILTER_CHIP_CLASS } from "../src/modules/timeline/tagFilter";
import {
  SAVE_BUTTON_CLASS,
  TAG_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * readableTimelines[].doc goes stale after a click-to-create: canvas.ts
 * replaces its own `documents` entry with the freshly written document
 * (addEvent returns a new object rather than mutating in place) and calls
 * back through onDocumentChange, but until this fix only the tab's
 * `documents` map heard about it. getVisibleTimelines() and
 * getAvailableTags() read readableTimelines, which kept pointing at the
 * pre-create document, so a tag added to a click-created event through the
 * editor never reached the chip bank until the tab was reopened.
 *
 * renderCanvas is given onDocumentChange twice: once when the tab first opens
 * and again every time rebuildCanvas re-renders the canvas. Both have to keep
 * readableTimelines current, so this file drives the sequence through each.
 */
describe("readableTimelines follows a click-to-create", function () {
  this.timeout(60000);

  let libraryID: number;
  let api: any;

  function doc(
    id: string,
    name: string,
    events: TimelineDocument["events"],
  ): TimelineDocument {
    return { version: CURRENT_SCHEMA_VERSION, id, name, events };
  }

  const anEvent = (id: string, title: string, date: string) => ({
    id,
    title,
    date,
    sources: [],
    tags: [],
  });

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
    api = (Zotero as any).ZoteroTimeline.api;
  });

  beforeEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  async function eventIdsByDoc(): Promise<Map<string, Set<string>>> {
    const { timelines } = await listTimelines(libraryID);
    return new Map(
      timelines.map((t) => [t.doc.id, new Set(t.doc.events.map((e) => e.id))]),
    );
  }

  /** Waits for exactly the effect a click-to-create drives: a new event id
   * landing in `docId`'s stored document. */
  async function waitForNewEvent(
    docId: string,
    beforeIds: Set<string>,
  ): Promise<string> {
    return waitFor(async () => {
      const ids = await eventIdsByDoc();
      const added = [...(ids.get(docId) ?? new Set())].filter(
        (id) => !beforeIds.has(id),
      );
      return added[0] ?? null;
    }, `a new event to appear in ${docId}`);
  }

  function chipFor(sidebar: HTMLElement, tag: string): HTMLButtonElement {
    return Array.from<HTMLButtonElement>(
      sidebar.querySelectorAll(`.${TAG_FILTER_CHIP_CLASS}`),
    ).find((chip) => chip.textContent === tag) as HTMLButtonElement;
  }

  /**
   * Adds `tag` to whatever event the editor currently shows and saves,
   * through the real DOM rather than the change handler - the seam this task
   * fixes is exactly what wires a save to the offered tag set, so calling the
   * handler directly would pass against the bug.
   */
  async function addTagToSelectedEvent(
    winDoc: Document,
    tag: string,
  ): Promise<void> {
    const panel = winDoc.querySelector("#zoterotimeline-editor") as HTMLElement;
    const tagInput = (await waitFor(
      () => panel.querySelector(`.${TAG_INPUT_CLASS}`),
      "the editor's tag input for the selected event",
    )) as HTMLInputElement;
    tagInput.value = tag;
    tagInput.dispatchEvent(
      new (winDoc.defaultView as any).Event("input", { bubbles: true }),
    );
    tagInput.dispatchEvent(
      new (winDoc.defaultView as any).KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    const saveButton = (await waitFor(
      () => panel.querySelector(`.${SAVE_BUTTON_CLASS}`),
      "the editor's save button",
    )) as HTMLButtonElement;
    saveButton.click();
  }

  async function openWithSidebar(): Promise<{ win: any; winDoc: Document }> {
    const win = Zotero.getMainWindows()[0] as any;
    const winDoc = win.document as Document;
    await api.openTimelineTab();
    await waitFor(() => api.getCurrentTimeline(), "the timeline to render");
    await waitFor(() => {
      const el = winDoc.getElementById("zoterotimeline-sidebar");
      return el && el.querySelector(".zoterotimeline-sidebar-row") ? el : null;
    }, "the sidebar to render its rows");
    return { win, winDoc };
  }

  it("offers a tag added to a click-created event without reopening the tab", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-a", "A", [anEvent("ev-1", "First", "1600")]),
    );
    const { winDoc } = await openWithSidebar();
    const sidebar = winDoc.getElementById(
      "zoterotimeline-sidebar",
    ) as HTMLElement;

    const beforeIds = (await eventIdsByDoc()).get("doc-a") ?? new Set();

    // doc-a is the only, and therefore default-active, lane (canvas.ts's
    // activeDocumentId starts as timelines[0].doc.id), so one click creates
    // directly rather than just activating it (canvas.ts:1023-1028).
    const timeline = api.getCurrentTimeline();
    timeline.emit("click", {
      item: null,
      group: "doc-a",
      time: new Date(Date.UTC(1650, 0, 1)),
    });
    const addedId = await waitForNewEvent("doc-a", beforeIds);
    await waitFor(
      () =>
        timeline.getSelection().length === 1 &&
        timeline.getSelection()[0] === `doc-a:${addedId}`
          ? true
          : null,
      "the newly created event to be selected",
    );

    assert.notInclude(
      api.getAvailableTags(),
      "freshlyAdded",
      "the fixture already carried the tag this spec adds",
    );

    await addTagToSelectedEvent(winDoc, "freshlyAdded");

    try {
      await waitFor(
        () => (api.getAvailableTags().includes("freshlyAdded") ? true : null),
        "getAvailableTags() to include the tag added to the click-created event",
      );
    } catch (err) {
      throw new Error(
        `${(err as Error).message}; errors:\n${Zotero.getErrors(true).join("\n")}`,
      );
    }
    await waitFor(
      () => chipFor(sidebar, "freshlyAdded"),
      "a chip for the tag added to the click-created event",
    );
  });

  it("offers a tag added to a click-created event after a rebuild", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-a", "A", [anEvent("ev-1", "First", "1600")]),
    );
    const { winDoc } = await openWithSidebar();
    const sidebar = winDoc.getElementById(
      "zoterotimeline-sidebar",
    ) as HTMLElement;

    const rebuildsBefore = api.rebuildsSoFar();
    const idsBeforeOutsideWrite =
      (await eventIdsByDoc()).get("doc-a") ?? new Set();

    // A write that does not go through the canvas at all, the same way
    // timelineRefresh.test.ts forces a rebuild: creating a different document
    // from outside would arrive as an `add` notification, which
    // notifyTimelineChanged ignores, so this rewrites the held note instead.
    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: [...current.events, anEvent("ev-2", "Second", "1700")],
      }),
      "doc-a",
      libraryID,
    );
    await waitFor(
      () => (api.rebuildsSoFar() > rebuildsBefore ? true : null),
      "a rebuild after an outside write",
    );

    // rebuildCanvas destroys and replaces the vis-timeline instance, so the
    // reference from before the rebuild is dead; the plugin's own instance
    // has to be re-read.
    const timeline = await waitFor(
      () => api.getCurrentTimeline(),
      "the timeline to render again after the rebuild",
    );
    const beforeIds =
      (await eventIdsByDoc()).get("doc-a") ?? idsBeforeOutsideWrite;

    // Same reasoning as the first spec: doc-a is still the only, and
    // therefore default-active, lane after the rebuild.
    timeline.emit("click", {
      item: null,
      group: "doc-a",
      time: new Date(Date.UTC(1650, 0, 1)),
    });
    const addedId = await waitForNewEvent("doc-a", beforeIds);
    await waitFor(
      () =>
        timeline.getSelection().length === 1 &&
        timeline.getSelection()[0] === `doc-a:${addedId}`
          ? true
          : null,
      "the newly created event to be selected",
    );

    assert.notInclude(
      api.getAvailableTags(),
      "freshlyAddedAfterRebuild",
      "the fixture already carried the tag this spec adds",
    );

    await addTagToSelectedEvent(winDoc, "freshlyAddedAfterRebuild");

    try {
      await waitFor(
        () =>
          api.getAvailableTags().includes("freshlyAddedAfterRebuild")
            ? true
            : null,
        "getAvailableTags() to include the tag added after a rebuild",
      );
    } catch (err) {
      throw new Error(
        `${(err as Error).message}; errors:\n${Zotero.getErrors(true).join("\n")}`,
      );
    }
    await waitFor(
      () => chipFor(sidebar, "freshlyAddedAfterRebuild"),
      "a chip for the tag added after a rebuild",
    );
  });

  it("reports a click-created event's id through getVisibleTimelines()", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-a", "A", [anEvent("ev-1", "First", "1600")]),
    );
    await openWithSidebar();

    const beforeIds = (await eventIdsByDoc()).get("doc-a") ?? new Set();
    const timeline = api.getCurrentTimeline();
    timeline.emit("click", {
      item: null,
      group: "doc-a",
      time: new Date(Date.UTC(1650, 0, 1)),
    });
    const addedId = await waitForNewEvent("doc-a", beforeIds);

    await waitFor(() => {
      const visible = api.getVisibleTimelines() as Array<{
        doc: TimelineDocument;
      }>;
      const docA = visible.find((t) => t.doc.id === "doc-a");
      return docA && docA.doc.events.some((e) => e.id === addedId)
        ? true
        : null;
    }, "getVisibleTimelines() to report the click-created event's id");
  });
});
