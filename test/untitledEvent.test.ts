import { assert } from "chai";
import {
  CREATE_BUTTON_CLASS,
  CREATE_DATE_INPUT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

function emptyDocument(name: string, id: string): TimelineDocument {
  return { version: CURRENT_SCHEMA_VERSION, id, name, events: [] };
}

// Both getString("event-editor-untitled-title") call sites fall back to the
// same key when a title is missing: canvas.ts's click-to-create draft, and
// eventEditor.ts's CREATE form when Create is pressed with the title left
// blank. A key defined in a file initLocale() does not load still renders,
// just as the raw Fluent id rather than "Untitled event" -
// localeCopyRules.test.ts's guard catches a getString() key living in the
// wrong file, but only these two specs prove the actual fallback text ends
// up where a reader sees it.
describe("the untitled-event fallback title", function () {
  this.timeout(60000);

  let libraryID: number;
  let extras: Zotero.Item[];

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    extras = [];
  });

  afterEach(async function () {
    for (const item of extras) {
      await item.eraseTx();
    }
    await eraseAllPluginItems(libraryID);
  });

  it("gives a click-created draft the title 'Untitled event'", async function () {
    for (const doc of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, doc);
    }
    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    await api.openTimelineTab();
    const doc = win.document as Document;
    const timeline = await waitFor(
      () => api.getCurrentTimeline(),
      "the timeline to render",
    );

    const { timelines: before } = await listTimelines(libraryID);
    const beforeIds = new Set(
      before
        .find((t) => t.doc.id === "doc-revolt")!
        .doc.events.map((e) => e.id),
    );

    // doc-revolt loads first and starts as the active lane (TASK-16), so one
    // click on it creates directly.
    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });

    const addedId = await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const ids = timelines
        .find((t) => t.doc.id === "doc-revolt")!
        .doc.events.map((e) => e.id);
      return ids.find((id) => !beforeIds.has(id)) ?? null;
    }, "a new event to appear in doc-revolt");

    // The write's own select-back opens the editor on the new event.
    const panel = await waitFor(
      () => doc.getElementById("zoterotimeline-editor"),
      "the editor panel to render",
    );
    const titleInput = await waitFor(() => {
      const el = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return el && el.value !== "" ? el : null;
    }, "the title field to read the new event's title");
    assert.equal(
      titleInput.value,
      "Untitled event",
      `the draft's title field should read "Untitled event", not a raw Fluent key`,
    );
    assert.notInclude(
      titleInput.value,
      "zoterotimeline-",
      `expected addedId=${addedId} not to show its Fluent id`,
    );
  });

  it("stores 'Untitled event' when Create is pressed with the title left blank", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      emptyDocument("Target", "tl-target"),
    );
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", "Source");
    await item.saveTx();
    extras.push(item);

    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    await api.openCreateEventOnTimeline(win, "tl-target", libraryID, [item]);
    const panel = await waitFor(
      () => win.document.getElementById("zoterotimeline-editor"),
      "the editor panel to render",
    );

    (
      panel.querySelector(`.${CREATE_DATE_INPUT_CLASS}`) as HTMLInputElement
    ).value = "1900";
    (
      panel.querySelector(`.${CREATE_BUTTON_CLASS}`) as HTMLButtonElement
    ).click();

    await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      return (timelines.find((t) => t.doc.id === "tl-target")?.doc.events
        .length ?? 0) > 0
        ? true
        : null;
    }, "the new event to be written");

    const reread = (await Zotero.Items.getAsync(note.id)) as Zotero.Item;
    assert.include(
      reread.getNote(),
      '"title":"Untitled event"',
      "the stored note should hold the fallback title, not a raw Fluent key",
    );
  });
});
