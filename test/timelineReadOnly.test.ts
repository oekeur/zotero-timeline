import { assert } from "chai";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_LINK_TYPES,
} from "../src/modules/timeline/schema";
import {
  SAVE_BUTTON_CLASS,
  DELETE_BUTTON_CLASS,
  SOURCE_ADD_BUTTON_CLASS,
  SOURCE_TYPE_SELECT_CLASS,
  SOURCE_NAME_INPUT_CLASS,
  SOURCE_REMOVE_BUTTON_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  READ_ONLY_BANNER_CLASS,
  SIDEBAR_CREATE_BUTTON_CLASS,
} from "../src/modules/timeline/timelineTab";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

// The one input the read-only rule follows: whether the open library can be
// written, read once through Zotero.Libraries.get and never re-derived from
// how many timelines happen to be loaded or visible. Own fixture throughout
// (canvasRangeRendering.test.ts's own fixture docblock says why): vis-timeline
// auto-fits its window to every event's span, and a shared fixture stretched
// by an unrelated test breaks the pixel assertions elsewhere.
describe("read-only when the library cannot be written", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    await createDocumentNote(libraryID, STORAGE_TAG, {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-read-only",
      name: "Read-only fixture",
      events: [
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            {
              kind: "item",
              libraryID,
              key: "AAAAAAAA",
              typeId: DEFAULT_LINK_TYPES[0].id,
            },
          ],
          tags: [],
        },
      ],
    });
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  // Safe to stub with a bare object rather than the real library spread with
  // fields overridden: the tab-open path reads only `editable` and, since
  // this task, `name` off this library (searchStorageNotes finds the fixture
  // first and never calls Zotero.Libraries.get itself).
  function stubNotWritable(): typeof Zotero.Libraries.get {
    const originalGet = Zotero.Libraries.get;
    Zotero.Libraries.get = ((id: number) =>
      id === libraryID
        ? ({
            editable: false,
            name: "Read-only Library",
          } as unknown as ReturnType<typeof Zotero.Libraries.get>)
        : originalGet.call(
            Zotero.Libraries,
            id,
          )) as typeof Zotero.Libraries.get;
    return originalGet;
  }

  async function openTab(): Promise<{
    win: any;
    doc: Document;
    panel: HTMLElement;
    timeline: any;
  }> {
    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    await api.openTimelineTab();
    const doc = win.document as Document;
    const panel = (await waitFor(
      () => doc.getElementById("zoterotimeline-editor"),
      "the editor panel to render",
    )) as HTMLElement;
    const timeline = api.getCurrentTimeline();
    return { win, doc, panel, timeline };
  }

  async function selectAndWait(
    timeline: any,
    panel: HTMLElement,
    id: string,
  ): Promise<HTMLInputElement> {
    timeline.setSelection([id]);
    return (await waitFor(() => {
      const input = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return input && input.value === "An event" ? input : null;
    }, 'the title field to read "An event"')) as HTMLInputElement;
  }

  // AC #1, #2, #5
  it("shows a banner naming the library when it can't be written, and none when it can", async function () {
    const originalGet = stubNotWritable();
    try {
      const { doc } = await openTab();
      const banner = doc.querySelector(`.${READ_ONLY_BANNER_CLASS}`);
      assert.ok(
        banner,
        "no read-only banner rendered for an unwritable library",
      );
      assert.include(
        banner!.textContent,
        "Read-only Library",
        "the banner did not name the library",
      );
    } finally {
      Zotero.Libraries.get = originalGet;
    }

    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    const { doc } = await openTab();
    assert.notOk(
      doc.querySelector(`.${READ_ONLY_BANNER_CLASS}`),
      "the banner showed even though the library can be written",
    );
  });

  // AC #3, #9: every write control in the event editor is disabled, not
  // removed, and AC #4: the panel still shows the event's own fields.
  it("disables the event editor's write controls without hiding them, and keeps reading the event", async function () {
    const originalGet = stubNotWritable();
    try {
      const { panel, timeline } = await openTab();
      const titleInput = await selectAndWait(
        timeline,
        panel,
        "doc-read-only:ev-1",
      );

      for (const cls of [
        SAVE_BUTTON_CLASS,
        DELETE_BUTTON_CLASS,
        SOURCE_ADD_BUTTON_CLASS,
        SOURCE_TYPE_SELECT_CLASS,
        SOURCE_NAME_INPUT_CLASS,
        SOURCE_REMOVE_BUTTON_CLASS,
      ]) {
        const control = panel.querySelector(`.${cls}`) as
          | HTMLButtonElement
          | HTMLInputElement
          | HTMLSelectElement
          | null;
        assert.ok(control, `${cls} was not rendered at all`);
        assert.isTrue(control!.disabled, `${cls} stayed enabled`);
      }

      assert.equal(
        titleInput.value,
        "An event",
        "the event's own title did not keep showing",
      );
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });

  // AC #6: the same controls stay enabled in a library the user can write.
  it("keeps the event editor's write controls enabled in a library the user can write", async function () {
    const { panel, timeline } = await openTab();
    await selectAndWait(timeline, panel, "doc-read-only:ev-1");

    for (const cls of [
      SAVE_BUTTON_CLASS,
      DELETE_BUTTON_CLASS,
      SOURCE_ADD_BUTTON_CLASS,
      SOURCE_TYPE_SELECT_CLASS,
      SOURCE_NAME_INPUT_CLASS,
      SOURCE_REMOVE_BUTTON_CLASS,
    ]) {
      const control = panel.querySelector(`.${cls}`) as
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLSelectElement;
      assert.isFalse(
        control.disabled,
        `${cls} was disabled in a library the user can write`,
      );
    }
  });

  // AC #7: no lane's items carry a drag handle when the library can't be
  // written - the same per-item editable flag TASK-38's parked events use,
  // never a global option.
  it("gives no item a drag handle when the library can't be written", async function () {
    const originalGet = stubNotWritable();
    try {
      const { doc, panel, timeline } = await openTab();
      await selectAndWait(timeline, panel, "doc-read-only:ev-1");

      assert.notOk(
        doc.querySelector(".vis-drag-center"),
        "a read-only library still drew a drag handle",
      );
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });

  // AC #6, #7: click-to-create is refused, the one canvas gesture with no
  // control of its own to disable.
  it("creates nothing from a click on empty canvas when the library can't be written", async function () {
    const originalGet = stubNotWritable();
    try {
      const { timeline } = await openTab();
      timeline.emit("click", {
        item: null,
        group: "doc-read-only",
        time: new Date(Date.UTC(1650, 0, 1)),
      });
      // Asserting nothing gets created has no condition to poll for.
      await Zotero.Promise.delay(600);

      const { timelines } = await listTimelines(libraryID);
      const doc = timelines.find((t) => t.doc.id === "doc-read-only")!;
      assert.lengthOf(
        doc.doc.events,
        1,
        "a click on empty canvas created an event in a read-only library",
      );
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });

  // AC #3, #5: the rule is inherited by a control this task never named -
  // the sidebar's own create button, already disabled by TASK-45's local
  // implementation, now converged onto the same libraryEditable this task
  // threads everywhere else. Confirms the count of loaded documents (one,
  // here) never enters the decision.
  it("disables the sidebar create control too, on the same libraryEditable input", async function () {
    const originalGet = stubNotWritable();
    try {
      const { doc } = await openTab();
      const createButton = doc.querySelector(
        `.${SIDEBAR_CREATE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      assert.isTrue(createButton.disabled);
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });
});
