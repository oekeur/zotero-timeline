import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  findContainers,
  listTimelines,
  STORAGE_TAG,
} from "../src/modules/timeline/storage";
import { CANVAS_EMPTY_PROMPT_CLASS } from "../src/modules/timeline/timelineTab";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * A storage note or its container can leave the library without ever being
 * trashed first: that is the path Zotero's own sync takes for a remote
 * deletion, calling erase() directly. Before this fix the open tab kept
 * drawing a row for whatever it had erased, since only a container already
 * flagged trashed rescheduled a rebuild on `delete`.
 */
describe("the open tab rebuilds when an erase reaches it directly", function () {
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

  async function promptElement(): Promise<HTMLElement | null> {
    const win = Zotero.getMainWindows()[0] as any;
    return win.document.querySelector(`.${CANVAS_EMPTY_PROMPT_CLASS}`);
  }

  it("drops a drawn note's row without reopening the tab when it is erased outright", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, doc("doc-kept", "Kept"));
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-erased", "Erased"),
    );

    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("Kept"),
      "the sidebar to list the kept timeline",
    );
    await waitFor(
      () => rowNamed("Erased"),
      "the sidebar to list the timeline about to be erased",
    );

    const { timelines } = await listTimelines(libraryID);
    const noteItemID = timelines.find(
      (t) => t.doc.id === "doc-erased",
    )!.noteItemID;
    const note = (await Zotero.Items.getAsync(noteItemID)) as Zotero.Item;
    await note.eraseTx();

    await waitFor(
      async () => (await rowNamed("Erased")) === null,
      "the erased timeline's row to leave the sidebar without reopening the tab",
    );
    assert.ok(
      await rowNamed("Kept"),
      "erasing one note's row also dropped the timeline it left standing",
    );
  });

  it("empties the canvas and shows the prompt when the live container is erased outright", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-a", "First timeline"),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      doc("doc-b", "Second timeline"),
    );

    await api().openTimelineTab();
    await waitFor(
      () => rowNamed("First timeline"),
      "the sidebar to list the first fixture timeline",
    );
    await waitFor(
      () => rowNamed("Second timeline"),
      "the sidebar to list the second fixture timeline",
    );

    const [container] = await findContainers(libraryID);
    await container.eraseTx();

    await waitFor(
      async () => (await rowNamed("First timeline")) === null,
      "the first timeline's row to leave the sidebar",
    );
    await waitFor(
      async () => (await rowNamed("Second timeline")) === null,
      "the second timeline's row to leave the sidebar",
    );
    await waitFor(
      () => promptElement(),
      "the canvas empty prompt to render once the container is gone",
    );
  });
});
