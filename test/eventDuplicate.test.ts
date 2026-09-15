import { assert } from "chai";
import { copyEventInto, updateEvent } from "../src/modules/timeline/mutations";
import {
  CURRENT_SCHEMA_VERSION,
  serializeDocument,
  type Event as TimelineEvent,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  listTimelines,
  updateTimelineDocument,
} from "../src/modules/timeline/storage";
import {
  DESCRIPTION_INPUT_CLASS,
  DUPLICATE_BUTTON_CLASS,
  DUPLICATE_CONFIRM_CLASS,
  DUPLICATE_TARGET_CLASS,
  SAVE_BUTTON_CLASS,
  TAG_INPUT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * Duplicating an event onto another timeline (TASK-47).
 *
 * The copy rules are pure and are asserted through copyEventInto directly;
 * only the picker and the write need a rendered tab. Sources are the whole
 * reason the feature exists, so most of what is checked here is what happens
 * to them.
 */
describe("duplicate an event onto another timeline", function () {
  this.timeout(60000);

  let libraryID: number;
  const api = () => (Zotero as any).ZoteroTimeline.api;

  const aSource = (key: string) => ({
    kind: "item" as const,
    libraryID: 1,
    key,
    typeId: "cites",
    name: "a note about it",
  });

  function anEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
    return {
      id: "ev-original",
      title: "The original",
      description: "with a description",
      date: "1789-07-14",
      endDate: "1789-07-15",
      sources: [aSource("AAAAAAAA"), aSource("BBBBBBBB")],
      tags: ["revolution", "paris"],
      ...overrides,
    } as TimelineEvent;
  }

  function aDocument(id: string, events: TimelineEvent[]): TimelineDocument {
    return { version: CURRENT_SCHEMA_VERSION, id, name: id, events };
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

  // AC #1
  it("carries every field and mints an id fresh in the target", function () {
    const source = anEvent();
    const target = aDocument("doc-target", [
      { ...anEvent(), id: "ev-already-here" },
    ]);
    const { doc, event } = copyEventInto(target, source, true);

    assert.notEqual(event.id, source.id, "the copy reused the original's id");
    assert.notEqual(
      event.id,
      "ev-already-here",
      "the copy collided with an event already in the target",
    );
    assert.equal(event.title, source.title);
    assert.equal(event.description, source.description);
    assert.equal(event.date, source.date);
    assert.equal(event.endDate, source.endDate);
    assert.deepEqual(event.tags, source.tags);
    assert.deepEqual(
      event.sources,
      source.sources,
      "the sources did not come across, which is the point of duplicating",
    );
    assert.lengthOf(doc.events, 2, "the target lost or gained the wrong count");
  });

  // AC #5, the half that is a property of the copy rather than of a write.
  it("clones the source list rather than aliasing it", function () {
    const source = anEvent();
    const { event } = copyEventInto(aDocument("doc-target", []), source, true);
    assert.notStrictEqual(
      event.sources[0],
      source.sources[0],
      "the copy shares a SourceRef object with the original, so editing one edits both",
    );
  });

  // TASK-15: track carries across exactly like every other optional field
  // this test suite already covers - a copy tagged for a sub-lane keeps
  // naming it, and lands in that sub-lane in the target document too (the
  // target's sub-lanes are derived from its events, not stored separately).
  it("carries track across, the same as every other optional field", function () {
    const source = anEvent({ track: "military" });
    const { event } = copyEventInto(aDocument("doc-target", []), source, true);
    assert.equal(event.track, "military");
  });

  // AC #3 and #4
  it("drops every source when the copy lands in another library", function () {
    const source = anEvent();
    const { event } = copyEventInto(aDocument("doc-target", []), source, false);
    assert.isEmpty(
      event.sources,
      "a cross-library copy kept its sources, so a document now cites another library",
    );
    // Everything else still crosses.
    assert.equal(event.title, source.title);
    assert.deepEqual(event.tags, source.tags);
  });

  // AC #5
  it("leaves the original untouched when the copy is edited", function () {
    const source = anEvent();
    const before = JSON.stringify(source);
    const { doc, event } = copyEventInto(
      aDocument("doc-target", []),
      source,
      true,
    );
    const edited = updateEvent(doc, event.id, { title: "changed" });
    assert.ok(edited, "editing the copy did nothing");
    assert.equal(
      JSON.stringify(source),
      before,
      "editing the copy changed the original event object",
    );
    assert.equal(
      edited!.events[0].title,
      "changed",
      "the copy was not the event that changed",
    );
  });

  // AC #2: the source document is not written at all. Asserted on stored
  // bytes, which is the only thing that cannot be true by accident.
  it("does not write the source document", async function () {
    const sourceNote = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-source", [anEvent()]),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-target", []),
    );
    const bytesBefore = sourceNote.getNote();

    const { timelines } = await listTimelines(libraryID);
    const source = timelines.find((t) => t.doc.id === "doc-source")!;
    await updateTimelineDocument(
      (current) => copyEventInto(current, source.doc.events[0], true).doc,
      "doc-target",
      libraryID,
    );

    const after = await Zotero.Items.getAsync(sourceNote.id);
    assert.equal(
      (after as any).getNote(),
      bytesBefore,
      "the source document was rewritten by a duplication",
    );
  });

  // AC #6
  it("leaves both documents unchanged when the target write fails", async function () {
    const sourceNote = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-source", [anEvent()]),
    );
    const targetNote = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-target", []),
    );
    const sourceBytes = sourceNote.getNote();
    const targetBytes = targetNote.getNote();

    let threw = false;
    try {
      await updateTimelineDocument(
        () => {
          throw new Error("the write refused");
        },
        "doc-target",
        libraryID,
      );
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "the failing write did not fail");

    const source = (await Zotero.Items.getAsync(sourceNote.id)) as any;
    const target = (await Zotero.Items.getAsync(targetNote.id)) as any;
    assert.equal(source.getNote(), sourceBytes, "the source changed");
    assert.equal(target.getNote(), targetBytes, "the target changed");
  });

  // AC #8 and #9
  it("groups targets by library, offers the own timeline, and preselects another", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-source", [anEvent()]),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-target", []),
    );

    const win = Zotero.getMainWindows()[0] as any;
    await api().openTimelineTab();
    const timeline = (await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    )) as any;
    const doc = win.document as Document;

    timeline.setSelection(["doc-source:ev-original"]);
    const button = (await waitFor(
      () => doc.querySelector(`.${DUPLICATE_BUTTON_CLASS}`),
      "the duplicate control to render",
    )) as HTMLButtonElement;
    button.click();

    const select = (await waitFor(() => {
      const el = doc.querySelector(
        `.${DUPLICATE_TARGET_CLASS}`,
      ) as HTMLSelectElement | null;
      return el && el.options.length > 0 ? el : null;
    }, "the target list to fill")) as HTMLSelectElement;

    const groups = Array.from<HTMLOptGroupElement>(
      select.querySelectorAll("optgroup"),
    );
    assert.isNotEmpty(groups, "targets are not grouped by library");
    for (const group of groups) {
      assert.isNotEmpty(
        group.label,
        "an optgroup carries no library name, so two same-named timelines are indistinguishable",
      );
    }

    const values = (Array.from(select.options) as HTMLOptionElement[]).map(
      (o) => o.value,
    );
    assert.include(
      values,
      `${libraryID}:doc-source`,
      "the event's own timeline is not offered, though copying onto it is legal",
    );
    assert.notEqual(
      select.value,
      `${libraryID}:doc-source`,
      "the event's own timeline is preselected, so a stray confirm copies onto itself",
    );

    // Every offered library must be one the user can write.
    for (const value of values) {
      const id = Number(value.split(":")[0]);
      assert.isTrue(
        (Zotero.Libraries.get(id) as { editable: boolean } | false) !== false &&
          (Zotero.Libraries.get(id) as { editable: boolean }).editable,
        `a library the user cannot write is offered as a target: ${id}`,
      );
    }
  });

  // AC #10
  it("disables the duplicate controls when the library cannot be written", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-source", [anEvent()]),
    );
    const originalGet = Zotero.Libraries.get;
    (Zotero.Libraries as any).get = (id: number) =>
      id === libraryID
        ? { editable: false, name: "Read-only Library" }
        : originalGet.call(Zotero.Libraries, id);
    try {
      const win = Zotero.getMainWindows()[0] as any;
      await api().openTimelineTab();
      const timeline = (await waitFor(
        () => api().getCurrentTimeline(),
        "the canvas to render",
      )) as any;
      const doc = win.document as Document;
      timeline.setSelection(["doc-source:ev-original"]);

      const button = (await waitFor(
        () => doc.querySelector(`.${DUPLICATE_BUTTON_CLASS}`),
        "the duplicate control to render",
      )) as HTMLButtonElement;
      assert.isTrue(
        button.disabled,
        "Duplicate is enabled in a library that cannot be written",
      );
      assert.isFalse(
        button.hidden,
        "Duplicate is hidden rather than disabled, so the panel changes shape",
      );
      const confirm = doc.querySelector(
        `.${DUPLICATE_CONFIRM_CLASS}`,
      ) as HTMLButtonElement | null;
      assert.isTrue(
        confirm?.disabled,
        "Copy is enabled in a read-only library",
      );
    } finally {
      (Zotero.Libraries as any).get = originalGet;
    }
  });

  // The write itself, end to end through the same call the control makes.
  it("lands the copy on the chosen timeline with its sources", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-source", [anEvent()]),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-target", []),
    );
    const { timelines } = await listTimelines(libraryID);
    const source = timelines.find((t) => t.doc.id === "doc-source")!;

    const written = await updateTimelineDocument(
      (current) => copyEventInto(current, source.doc.events[0], true).doc,
      "doc-target",
      libraryID,
    );
    assert.ok(written, "the copy was not written");
    assert.lengthOf(written!.events, 1);
    assert.equal(written!.events[0].title, "The original");
    assert.lengthOf(
      written!.events[0].sources,
      2,
      "the copy landed without its sources",
    );
    assert.notEqual(
      serializeDocument(written!),
      serializeDocument(source.doc),
      "the target now serialises identically to the source, which cannot be right",
    );
  });

  // Duplicate reads the event as it stands at click time, not as the render
  // that opened the panel captured it (TASK-74). Both specs below drive the
  // real editor end to end rather than copyEventInto directly, since the bug
  // was in the control's own closure, not in the pure mutation.
  function pressEnter(doc: Document, input: HTMLInputElement): void {
    input.dispatchEvent(
      new (doc.defaultView as any).KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
  }

  it("duplicates an existing event as it was saved a moment ago, not as the panel opened", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-source", [anEvent()]),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument("doc-target", []),
    );

    const win = Zotero.getMainWindows()[0] as any;
    await api().openTimelineTab();
    const timeline = (await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    )) as any;
    const doc = win.document as Document;
    const panel = doc.getElementById("zoterotimeline-editor") as HTMLElement;

    timeline.setSelection(["doc-source:ev-original"]);
    const titleInput = (await waitFor(() => {
      const el = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return el && el.value === "The original" ? el : null;
    }, "the title field to show the original title")) as HTMLInputElement;

    titleInput.value = "Copy test";
    const descriptionInput = panel.querySelector(
      `.${DESCRIPTION_INPUT_CLASS}`,
    ) as HTMLTextAreaElement;
    descriptionInput.value = "a revised account";
    const tagInput = panel.querySelector(
      `.${TAG_INPUT_CLASS}`,
    ) as HTMLInputElement;
    tagInput.value = "renamed";
    pressEnter(doc, tagInput);

    (panel.querySelector(`.${SAVE_BUTTON_CLASS}`) as HTMLButtonElement).click();
    await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const saved = timelines
        .find((t) => t.doc.id === "doc-source")
        ?.doc.events.find((e) => e.id === "ev-original");
      return saved?.title === "Copy test" ? true : null;
    }, "the save to land");

    (
      (await waitFor(
        () => panel.querySelector(`.${DUPLICATE_BUTTON_CLASS}`),
        "the duplicate control to render",
      )) as HTMLButtonElement
    ).click();

    const select = (await waitFor(() => {
      const el = panel.querySelector(
        `.${DUPLICATE_TARGET_CLASS}`,
      ) as HTMLSelectElement | null;
      return el && el.options.length > 0 ? el : null;
    }, "the target list to fill")) as HTMLSelectElement;
    select.value = `${libraryID}:doc-target`;

    (
      panel.querySelector(`.${DUPLICATE_CONFIRM_CLASS}`) as HTMLButtonElement
    ).click();

    const targetDoc = (await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const found = timelines.find((t) => t.doc.id === "doc-target")?.doc;
      return found && found.events.length > 0 ? found : null;
    }, "the copy to land on the target")) as TimelineDocument;

    const copy = targetDoc.events[0];
    assert.equal(
      copy.title,
      "Copy test",
      "the copy carried the title from when the panel opened, not the one just saved",
    );
    assert.equal(
      copy.description,
      "a revised account",
      "the copy carried the description from when the panel opened, not the one just saved",
    );
    assert.include(
      copy.tags,
      "renamed",
      "the copy dropped the tag added just before saving",
    );
    assert.notEqual(
      copy.id,
      "ev-original",
      "the copy reused the original's id",
    );

    // The title alone can't tell the original from the copy - both now read
    // "Copy test". The selection can: it still names the original event's own
    // id, not the copy's, which a duplicate that reselected onto its own
    // output would get wrong. The rebuild the target's write fires (TASK-43)
    // replaces the timeline instance wholesale, so it's fetched fresh rather
    // than reusing the one captured at the top of the test.
    await waitFor(() => {
      const current = api().getCurrentTimeline() as any;
      const selection = current?.getSelection?.() as string[] | undefined;
      return selection?.length === 1 &&
        selection[0] === "doc-source:ev-original"
        ? true
        : null;
    }, "the selection to still name the original event");

    await waitFor(() => {
      const current = api().getCurrentTimeline() as any;
      return current?.itemsData?.get(`doc-target:${copy.id}`) != null
        ? true
        : null;
    }, "the copy to be drawn on the target lane");
  });

  it("duplicates a click-created draft as it stood after its first save", async function () {
    for (const document of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, document);
    }

    const win = Zotero.getMainWindows()[0] as any;
    await api().openTimelineTab();
    const timeline = (await waitFor(
      () => api().getCurrentTimeline(),
      "the canvas to render",
    )) as any;
    const doc = win.document as Document;
    const panel = doc.getElementById("zoterotimeline-editor") as HTMLElement;

    const { timelines: before } = await listTimelines(libraryID);
    const beforeIds = new Set(
      before
        .find((t) => t.doc.id === "doc-revolt")!
        .doc.events.map((e) => e.id),
    );

    // doc-revolt loads first and is already the active lane, so one click
    // creates directly rather than needing a priming click first.
    timeline.emit("click", {
      item: null,
      group: "doc-revolt",
      time: new Date(Date.UTC(1580, 6, 13)),
    });

    const draftId = (await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const ids = timelines
        .find((t) => t.doc.id === "doc-revolt")!
        .doc.events.map((e) => e.id);
      const added = ids.filter((id) => !beforeIds.has(id));
      return added[0] ?? null;
    }, "a new event to appear in doc-revolt")) as string;

    await waitFor(
      () =>
        timeline.getSelection().length === 1 &&
        timeline.getSelection()[0] === `doc-revolt:${draftId}`
          ? true
          : null,
      "the new draft to be selected",
    );

    const titleInput = (await waitFor(
      () => panel.querySelector(`.${TITLE_INPUT_CLASS}`),
      "the editor to render for the draft",
    )) as HTMLInputElement;

    titleInput.value = "Bastille falls";
    const tagInput = panel.querySelector(
      `.${TAG_INPUT_CLASS}`,
    ) as HTMLInputElement;
    tagInput.value = "alpha";
    pressEnter(doc, tagInput);

    (panel.querySelector(`.${SAVE_BUTTON_CLASS}`) as HTMLButtonElement).click();
    await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const saved = timelines
        .find((t) => t.doc.id === "doc-revolt")
        ?.doc.events.find((e) => e.id === draftId);
      return saved?.title === "Bastille falls" ? true : null;
    }, "the draft's save to land");

    (
      (await waitFor(
        () => panel.querySelector(`.${DUPLICATE_BUTTON_CLASS}`),
        "the duplicate control to render",
      )) as HTMLButtonElement
    ).click();

    const select = (await waitFor(() => {
      const el = panel.querySelector(
        `.${DUPLICATE_TARGET_CLASS}`,
      ) as HTMLSelectElement | null;
      return el && el.options.length > 0 ? el : null;
    }, "the target list to fill")) as HTMLSelectElement;
    select.value = `${libraryID}:doc-sources`;

    (
      panel.querySelector(`.${DUPLICATE_CONFIRM_CLASS}`) as HTMLButtonElement
    ).click();

    const targetDoc = (await waitFor(async () => {
      const { timelines } = await listTimelines(libraryID);
      const found = timelines.find((t) => t.doc.id === "doc-sources")!.doc;
      return found.events.length > 2 ? found : null;
    }, "the copy to land on doc-sources")) as TimelineDocument;

    const copy = targetDoc.events.find(
      (e) => e.id !== "ev-pamphlets" && e.id !== "ev-truce",
    )!;
    assert.equal(
      copy.title,
      "Bastille falls",
      "the copy landed as the untitled fallback instead of the title saved a moment before",
    );
    assert.deepEqual(
      copy.tags,
      ["alpha"],
      "the copy landed with no tags instead of the tag saved a moment before",
    );
    assert.notEqual(copy.id, draftId, "the copy reused the draft's own id");

    // The selection still names the draft's own id, not the copy's - the
    // fresh fetch is needed for the same reason as the previous spec.
    await waitFor(() => {
      const current = api().getCurrentTimeline() as any;
      const selection = current?.getSelection?.() as string[] | undefined;
      return selection?.length === 1 && selection[0] === `doc-revolt:${draftId}`
        ? true
        : null;
    }, "the selection to still name the draft");

    await waitFor(() => {
      const current = api().getCurrentTimeline() as any;
      return current?.itemsData?.get(`doc-sources:${copy.id}`) != null
        ? true
        : null;
    }, "the copy to be drawn on doc-sources's lane");
  });
});
