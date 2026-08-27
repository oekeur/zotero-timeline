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
import type { Event } from "../src/modules/timeline/schema";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

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
    const doc = win.document as Document;
    const panel = (await waitFor(
      () => doc.getElementById("zoterotimeline-editor"),
      "the editor panel to render",
    )) as HTMLElement;
    const timeline = api.getCurrentTimeline();
    return { panel, timeline };
  }

  /** Waits for exactly the effect a create drives: a new event id landing in
   * `docId`'s stored document. */
  async function waitForNewEvent(
    docId: string,
    beforeIds: Set<string>,
  ): Promise<Event> {
    return waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const doc = timelines.find((t) => t.doc.id === docId)?.doc;
      const added = doc?.events.filter((e) => !beforeIds.has(e.id));
      return added && added.length > 0 ? added[0] : null;
    }, `a new event to appear in ${docId}`);
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
    // Asserting nothing gets created has no condition to poll for.
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
    const created = await waitForNewEvent("doc-sources", beforeIds);
    assert.equal(created.date, "1633");

    // The write's own select-back is a separate effect from the write
    // landing in storage, so it needs its own wait.
    await waitFor(
      () =>
        timeline.getSelection().length === 1 &&
        timeline.getSelection()[0] === `doc-sources:${created.id}`
          ? true
          : null,
      "the new event to be selected after creation",
    );
    assert.deepEqual(
      timeline.getSelection(),
      [`doc-sources:${created.id}`],
      "the newly created event was not selected after creation",
    );

    const titleInput = (await waitFor(() => {
      const input = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return input && input.value === created.title ? input : null;
    }, "the edit form to reflect the freshly created event")) as HTMLInputElement;
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
    //
    // The typed create above selected the new doc-sources event, which
    // activated doc-sources (TASK-16) - doc-revolt is no longer the active
    // lane, so the first click below only activates it (AC7) and a second
    // click, now that it is active, is what actually creates.
    const revoltBeforeIds = new Set(["ev-fury", "ev-utrecht"]);
    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    await waitFor(
      () =>
        (Zotero as any).ZoteroTimeline.api.getActiveTimeline() === "doc-revolt",
      "the priming click to activate doc-revolt",
    );
    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });
    const clickCreated = await waitForNewEvent("doc-revolt", revoltBeforeIds);
    assert.equal(
      created.title,
      clickCreated.title,
      "the typed route's default title diverged from the click route's",
    );
  });
});
