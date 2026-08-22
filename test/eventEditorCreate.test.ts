import { assert } from "chai";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  CREATE_BUTTON_CLASS,
  CREATE_DATE_INPUT_CLASS,
  CREATE_DOCUMENT_SELECT_CLASS,
  CREATE_TITLE_INPUT_CLASS,
  EMPTY_PROMPT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

// The typed equivalent of clicking empty canvas (TASK-25's "click" handler in
// canvas.ts) - see canvas.ts's own top-of-file gesture-parity audit
// (TASK-27). eventCreation.test.ts already proves the click route calls
// addEvent+updateTimelineDocument; this file proves the typed route reaches
// the same call and, on the one input the two routes share a default for (a
// blank title), writes the same stored value.
describe("event creation through the typed form", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  async function withDocuments(
    docs: ReturnType<typeof canvasFixtureDocuments>,
  ) {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    for (const doc of docs) {
      await createDocumentNote(libraryID, STORAGE_TAG, doc);
    }
  }

  async function openPanel(): Promise<{ panel: HTMLElement; timeline: any }> {
    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);
    const doc = win.document as Document;
    const panel = doc.getElementById("zoterotimeline-editor") as HTMLElement;
    const timeline = api.getCurrentTimeline();
    return { panel, timeline };
  }

  it("shows no document picker when exactly one timeline is loaded", async function () {
    await withDocuments([documentNamed("Solo timeline", "tl-solo")]);
    const { panel } = await openPanel();

    assert.ok(panel.querySelector(`.${EMPTY_PROMPT_CLASS}`));
    assert.notOk(
      panel.querySelector(`.${CREATE_DOCUMENT_SELECT_CLASS}`),
      "a single loaded document should need no picker",
    );
    assert.ok(panel.querySelector(`.${CREATE_TITLE_INPUT_CLASS}`));
    assert.ok(panel.querySelector(`.${CREATE_DATE_INPUT_CLASS}`));
  });

  it("does nothing when the date field is left blank", async function () {
    await withDocuments([documentNamed("Solo timeline", "tl-solo")]);
    const { panel } = await openPanel();

    const before = await listTimelines(libraryID);
    const beforeCount = before.timelines[0].doc.events.length;

    const titleInput = panel.querySelector(
      `.${CREATE_TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "Should not be created";
    const createButton = panel.querySelector(
      `.${CREATE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    createButton.click();
    await Zotero.Promise.delay(500);

    const after = await listTimelines(libraryID);
    assert.equal(
      after.timelines[0].doc.events.length,
      beforeCount,
      "a blank date must not create an event",
    );
  });

  it("creates an event in the picked document, selects it, and defaults an untyped title to the same string the click gesture uses", async function () {
    await withDocuments(canvasFixtureDocuments());
    const { panel, timeline } = await openPanel();

    const select = panel.querySelector(
      `.${CREATE_DOCUMENT_SELECT_CLASS}`,
    ) as HTMLSelectElement;
    assert.ok(select, "expected a document picker with two timelines loaded");
    select.value = "doc-sources";

    const dateInput = panel.querySelector(
      `.${CREATE_DATE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    dateInput.value = "1633";

    const before = await listTimelines(libraryID);
    const beforeIds = new Set(
      before.timelines
        .find((t) => t.doc.id === "doc-sources")!
        .doc.events.map((e) => e.id),
    );

    const createButton = panel.querySelector(
      `.${CREATE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    createButton.click();
    await Zotero.Promise.delay(800);

    const { timelines } = await listTimelines(libraryID);
    const sourcesDoc = timelines.find((t) => t.doc.id === "doc-sources")!.doc;
    const added = sourcesDoc.events.filter((e) => !beforeIds.has(e.id));
    assert.lengthOf(added, 1, "expected exactly one new event in doc-sources");
    const created = added[0];
    assert.equal(created.date, "1633");

    assert.deepEqual(
      timeline.getSelection(),
      [`doc-sources:${created.id}`],
      "the newly created event was not selected after creation",
    );

    await Zotero.Promise.delay(300);
    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    assert.ok(
      titleInput,
      "selecting the new event should open the normal edit form",
    );
    assert.equal(
      titleInput.value,
      created.title,
      "the edit form did not reflect the freshly created event",
    );

    // Same default title the canvas click gesture writes for a blank title -
    // proves the two routes produce the same stored result on equivalent
    // (here: absent) input.
    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    await Zotero.Promise.delay(600);
    const { timelines: after } = await listTimelines(libraryID);
    const revoltDoc = after.find((t) => t.doc.id === "doc-revolt")!.doc;
    const clickCreated = revoltDoc.events.find(
      (e) => e.id !== "ev-fury" && e.id !== "ev-utrecht",
    )!;
    assert.equal(
      created.title,
      clickCreated.title,
      "the typed route's default title diverged from the click route's",
    );
  });
});
