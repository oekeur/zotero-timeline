import { assert } from "chai";
import { trackGroupId } from "../src/modules/timeline/canvas";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import { SIDEBAR_ROW_CLASS } from "../src/modules/timeline/timelineTab";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * Sub-lanes within a timeline, drawn as vis-timeline nested groups (TASK-15).
 *
 * AC #2: a timeline with sub-lanes renders as nested groups, and the
 * combined view still maps each document to one top-level group. The nested
 * DOM classes (`vis-nesting-group` on the parent, `vis-nested-group` on each
 * child) are vis-timeline's own, applied only where a group's data carries
 * `nestedGroups` - so their presence is real evidence sub-lanes actually
 * nested rather than merely that this document's name appears somewhere. The
 * sidebar row count is the other half: it must count documents, never
 * sub-lanes, or "one top-level group per document" would be false in the one
 * place a user reads it.
 */
describe("sub-lanes within a timeline (TASK-15)", function () {
  this.timeout(60000);

  let libraryID: number;
  const api = () => (Zotero as any).ZoteroTimeline.api;

  function trackedDocument(): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-tracks",
      name: "Tracked timeline",
      events: [
        {
          id: "ev-plain",
          title: "Untracked",
          date: "1700",
          sources: [],
          tags: [],
        },
        {
          id: "ev-military",
          title: "Military event",
          date: "1701",
          sources: [],
          tags: [],
          track: "military",
        },
        {
          id: "ev-diplomatic",
          title: "Diplomatic event",
          date: "1702",
          sources: [],
          tags: [],
          track: "diplomatic",
        },
      ],
    };
  }

  function plainDocument(): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-plain",
      name: "Plain timeline",
      events: [
        {
          id: "ev-only",
          title: "Only event",
          date: "1750",
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
    await eraseAllPluginItems(libraryID);
  });

  async function openTab(): Promise<{ win: any; doc: Document }> {
    const win = Zotero.getMainWindows()[0] as any;
    await api().openTimelineTab();
    await waitFor(() => api().getCurrentTimeline(), "the canvas to render");
    return { win, doc: win.document as Document };
  }

  it("nests a document's tracks under its own row, and leaves an untracked document flat", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, trackedDocument());
    await createDocumentNote(libraryID, STORAGE_TAG, plainDocument());
    const { doc } = await openTab();

    const nestingLabels = await waitFor(
      () =>
        Array.from(
          doc.querySelectorAll(".vis-label.vis-nesting-group"),
        ) as HTMLElement[],
      "the tracked document's nesting row to render",
    );
    assert.lengthOf(
      nestingLabels,
      1,
      "expected exactly one nesting parent - the plain document must not gain one",
    );
    assert.include(nestingLabels[0].textContent ?? "", "Tracked timeline");

    const nestedLabels = Array.from(
      doc.querySelectorAll(".vis-label.vis-nested-group"),
    ) as HTMLElement[];
    assert.lengthOf(nestedLabels, 2, "expected one sub-lane row per track");
    const nestedText = nestedLabels.map((el) => el.textContent ?? "");
    assert.include(nestedText.join("|"), "military");
    assert.include(nestedText.join("|"), "diplomatic");

    // The combined view still maps each document to one top-level group: the
    // sidebar - the surface that actually claims "one row per timeline" - has
    // exactly two rows, never four.
    const sidebarRows = doc.querySelectorAll(`.${SIDEBAR_ROW_CLASS}`);
    assert.lengthOf(sidebarRows, 2);
  });

  it("creates an event in the clicked sub-lane, not the document's own lane", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, trackedDocument());
    await openTab();
    const timeline = await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    );

    const before = await listTimelines(libraryID);
    const beforeIds = new Set(
      before.timelines
        .find((t) => t.doc.id === "doc-tracks")!
        .doc.events.map((e) => e.id),
    );

    // doc-tracks is the only (and therefore default-active) timeline, so this
    // single click falls straight through to create rather than needing a
    // first click to activate.
    timeline.emit("click", {
      item: null,
      group: trackGroupId("doc-tracks", "military"),
      time: new Date(Date.UTC(1701, 5, 1)),
    });

    const addedEvent = await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const events = timelines.find((t) => t.doc.id === "doc-tracks")!.doc
        .events;
      return events.find((e) => !beforeIds.has(e.id)) ?? null;
    }, "a new event to land in doc-tracks");

    assert.equal(addedEvent!.track, "military");
  });
});
