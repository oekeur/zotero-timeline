import { assert } from "chai";
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  listTimelines,
  searchStorageNotes,
  updateTimelineDocument,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  SAVE_BUTTON_CLASS,
  SOURCE_ADD_BUTTON_CLASS,
  SOURCE_CLASS,
  SOURCE_LABEL_TEXT_CLASS,
  SOURCE_REMOVE_BUTTON_CLASS,
  SOURCE_TYPE_SELECT_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import { createDocumentNote, eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

/**
 * TASK-77: Save used to compute which sources to remove or update by
 * indexing the render-time snapshot of event.sources. A Save that removes a
 * source shifts the document's array without re-rendering the panel, so a
 * second Save in the same editor session read that stale index against the
 * now-shifted array and acted on the wrong source. Every spec here drives
 * the real editor through at least one Save that follows an earlier one in
 * the same session, or combines an update and a removal in one Save, and
 * checks what actually landed in storage.
 */
describe("event editor: Save diffs sources by identity", function () {
  this.timeout(60000);

  let libraryID: number;
  let items: Zotero.Item[];
  const api = () => (Zotero as any).ZoteroTimeline.api;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    api().closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    items = [];
  });

  afterEach(async function () {
    api().closeTimelineTab();
    for (const item of items) {
      await item.eraseTx();
    }
    await eraseAllPluginItems(libraryID);
  });

  async function citableItem(title: string): Promise<Zotero.Item> {
    const item = new Zotero.Item("document");
    item.libraryID = libraryID;
    item.setField("title", title);
    await item.saveTx();
    items.push(item);
    return item;
  }

  function aDocument(events: TimelineDocument["events"]): TimelineDocument {
    return {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-second-save",
      name: "Second save fixture",
      events,
    };
  }

  async function openPanel(): Promise<{
    doc: Document;
    panel: HTMLElement;
    timeline: any;
  }> {
    const win = Zotero.getMainWindows()[0] as any;
    await api().openTimelineTab();
    const doc = win.document as Document;
    const panel = (await waitFor(
      () => doc.getElementById("zoterotimeline-editor"),
      "the editor panel to render",
    )) as HTMLElement;
    await waitForResolvedLabels(panel);
    const timeline = api().getCurrentTimeline();
    return { doc, panel, timeline };
  }

  async function waitForResolvedLabels(panel: HTMLElement): Promise<void> {
    await waitFor(() => {
      const labeled = Array.from<HTMLElement>(
        panel.querySelectorAll("[data-l10n-id]"),
      ).filter((el) => {
        const tag = el.tagName.toLowerCase();
        return tag !== "input" && tag !== "select";
      });
      return labeled.every((el) => (el.textContent ?? "").trim() !== "")
        ? true
        : null;
    }, "the panel's Fluent-backed labels to resolve");
  }

  async function selectEvent(
    timeline: any,
    panel: HTMLElement,
    id: string,
    expectedTitle: string,
  ): Promise<void> {
    timeline.setSelection([id]);
    await waitFor(() => {
      const el = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return el && el.value === expectedTitle ? el : null;
    }, `the title field to read "${expectedTitle}"`);
    await waitFor(() => {
      const typeSelects = Array.from<HTMLElement>(
        panel.querySelectorAll(`.${SOURCE_TYPE_SELECT_CLASS}`),
      ) as HTMLSelectElement[];
      return typeSelects.every((select) => select.options.length > 0)
        ? true
        : null;
    }, "every source's type select to have its vocabulary loaded");
    await waitForResolvedLabels(panel);
  }

  // Some saves round-trip to content byte-identical to what was already
  // stored, so there is nothing new to poll for in the document itself.
  // Waiting on the underlying Zotero.Item#save() call resolving is the real
  // condition: updateTimelineDocument awaits exactly that call before the
  // click handler's own promise settles.
  async function waitForSave(trigger: () => void): Promise<void> {
    const original = (Zotero.Item.prototype as any).save;
    let resolved = false;
    (Zotero.Item.prototype as any).save = function (...args: unknown[]) {
      const result = original.apply(this, args);
      Promise.resolve(result).then(() => {
        resolved = true;
      });
      return result;
    };
    try {
      trigger();
      await waitFor(() => (resolved ? true : null), "the note save to resolve");
    } finally {
      (Zotero.Item.prototype as any).save = original;
    }
  }

  function rowByLabel(panel: HTMLElement, label: string): HTMLElement {
    const rows = Array.from<HTMLElement>(
      panel.querySelectorAll(`.${SOURCE_CLASS}`),
    );
    const row = rows.find(
      (r) =>
        r.querySelector(`.${SOURCE_LABEL_TEXT_CLASS}`)!.textContent === label,
    );
    if (!row) {
      throw new Error(`no source row labelled "${label}"`);
    }
    return row;
  }

  // selectItemsDialog is modal and cannot be opened in an automated run, so
  // this stubs Zotero.getMainWindow itself to make openDialog hand back a
  // chosen item synchronously, the same way eventEditor.test.ts's own
  // sources-section tests do.
  function stubPicker(item: Zotero.Item): () => void {
    const original = Zotero.getMainWindow;
    (Zotero as any).getMainWindow = () => ({
      openDialog: (
        _url: string,
        _name: string,
        _features: string,
        io: { dataOut: number[] | null },
      ) => {
        io.dataOut = [item.id];
      },
    });
    return () => {
      (Zotero as any).getMainWindow = original;
    };
  }

  function assertNoSaveFailure(): void {
    const errors = Zotero.getErrors(true);
    assert.isFalse(
      errors.some((message) => message.includes("failed to save event")),
      `a Save logged a failure: ${errors.join("\n")}`,
    );
  }

  // Patches `save` on the storage note itself, an own property shadowing the
  // prototype, rather than the shared prototype method: the suite's other
  // fixtures (the source items, other tests' notes) save through the same
  // prototype method, and a patch there would fire on whichever one happens
  // first rather than on this test's own write.
  async function waitForSaveWithInjectedEdit(
    note: Zotero.Item,
    trigger: () => void,
    inject: () => void,
  ): Promise<void> {
    const hadOwnSave = Object.prototype.hasOwnProperty.call(note, "save");
    const ownSave = hadOwnSave ? (note as any).save : undefined;
    const prototypeSave = (Zotero.Item.prototype as any).save;
    let resolved = false;
    // Runs synchronously the moment the write's own transaction calls
    // Item#save - the note has already been built from what Save read at
    // click time, and the click handler's own post-save reset is still many
    // promise-chain hops away. That is "the save is in flight" from the
    // task's description, staged deterministically (the injection point
    // itself is exact) rather than guessed at with a sleep.
    (note as any).save = function (...args: unknown[]) {
      inject();
      const result = prototypeSave.apply(this, args);
      Promise.resolve(result).then(() => {
        resolved = true;
      });
      return result;
    };
    try {
      trigger();
      await waitFor(() => (resolved ? true : null), "the note save to resolve");
    } finally {
      if (hadOwnSave) {
        (note as any).save = ownSave;
      } else {
        delete (note as any).save;
      }
    }
  }

  // Counts Item#save calls that resolve while `trigger` runs, waits for
  // `expected` of them (or 4s), then lets the storage queue drain and the
  // click handlers' continuations settle. Used by specs (7) and (8), where
  // two Save clicks land before either's own promise has been awaited.
  async function waitForSaves(
    trigger: () => void,
    expected: number,
  ): Promise<void> {
    const original = (Zotero.Item.prototype as any).save;
    let resolved = 0;
    (Zotero.Item.prototype as any).save = function (...args: unknown[]) {
      const result = original.apply(this, args);
      Promise.resolve(result).then(() => {
        resolved += 1;
      });
      return result;
    };
    try {
      trigger();
      await waitFor(
        () => (resolved >= expected ? true : null),
        `${expected} note save(s) to resolve`,
        { timeout: 4000 },
      ).catch(() => undefined);
      await whenStorageIdle();
    } finally {
      (Zotero.Item.prototype as any).save = original;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // Spec (1)
  it("keeps every remaining source across a removal, then a title-only Save", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    const c = await citableItem("Source C");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: b.key, typeId: "cites" },
            { kind: "item", libraryID, key: c.key, typeId: "cites" },
          ],
          tags: [],
        },
      ]),
    );

    const { panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    (
      rowByLabel(panel, "Source B").querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    let saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites" },
        { kind: "item", libraryID, key: c.key, typeId: "cites" },
      ],
      "the first Save did not drop exactly the removed source",
    );

    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "A retitled event";

    saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "A retitled event");
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites" },
        { kind: "item", libraryID, key: c.key, typeId: "cites" },
      ],
      "a second, title-only Save re-diffed sources against the render-time " +
        "snapshot instead of what is actually stored",
    );
  });

  // Spec (2)
  it("keeps the one remaining source across two Saves that each remove one", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    const c = await citableItem("Source C");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: b.key, typeId: "cites" },
            { kind: "item", libraryID, key: c.key, typeId: "cites" },
          ],
          tags: [],
        },
      ]),
    );

    const { panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    (
      rowByLabel(panel, "Source B").querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    let saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    (
      rowByLabel(panel, "Source C").querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    const { timelines } = await listTimelines(libraryID);
    const stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(stored.sources, [
      { kind: "item", libraryID, key: a.key, typeId: "cites" },
    ]);
  });

  // Spec (3)
  it("applies a type change and a removal made in one Save, both by identity", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    const c = await citableItem("Source C");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: b.key, typeId: "supports" },
            { kind: "item", libraryID, key: c.key, typeId: "contradicts" },
          ],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const typeSelect = rowByLabel(panel, "Source A").querySelector(
      `.${SOURCE_TYPE_SELECT_CLASS}`,
    ) as HTMLSelectElement;
    typeSelect.value = "related-to";
    typeSelect.dispatchEvent(
      new (doc.defaultView as any).Event("change", { bubbles: true }),
    );

    (
      rowByLabel(panel, "Source B").querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    const { timelines } = await listTimelines(libraryID);
    const stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(stored.sources, [
      { kind: "item", libraryID, key: a.key, typeId: "related-to" },
      { kind: "item", libraryID, key: c.key, typeId: "contradicts" },
    ]);
  });

  // Spec (4). Identity is many-to-one: two stored sources can carry the same
  // kind/key/typeId/name. Removing one of them by identity has to consume
  // exactly one matching stored source per row, or the removal is a silent
  // no-op because the surviving row's `original` still matches both.
  it("removes one of two stored sources that are the same claim", async function () {
    const a = await citableItem("Source A");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
          ],
          tags: [],
        },
      ]),
    );

    const { panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const rows = Array.from<HTMLElement>(
      panel.querySelectorAll(`.${SOURCE_CLASS}`),
    );
    (
      rows[1].querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    const { timelines } = await listTimelines(libraryID);
    const stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(stored.sources, [
      { kind: "item", libraryID, key: a.key, typeId: "cites" },
    ]);
  });

  // Spec (5). Swapping two rows' types on the same item in one Save must not
  // have the second update land on the index the first update just vacated:
  // each row's own consumed index, computed once before either update runs,
  // has to stay fixed for the rest of the Save.
  it("swaps two rows' types on the same item in one Save", async function () {
    const a = await citableItem("Source A");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: a.key, typeId: "supports" },
          ],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const rows = Array.from<HTMLElement>(
      panel.querySelectorAll(`.${SOURCE_CLASS}`),
    );
    const typeSelect = (row: HTMLElement) =>
      row.querySelector(`.${SOURCE_TYPE_SELECT_CLASS}`) as HTMLSelectElement;
    typeSelect(rows[0]).value = "supports";
    typeSelect(rows[0]).dispatchEvent(
      new (doc.defaultView as any).Event("change", { bubbles: true }),
    );
    typeSelect(rows[1]).value = "cites";
    typeSelect(rows[1]).dispatchEvent(
      new (doc.defaultView as any).Event("change", { bubbles: true }),
    );

    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    const { timelines } = await listTimelines(libraryID);
    const stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(stored.sources, [
      { kind: "item", libraryID, key: a.key, typeId: "supports" },
      { kind: "item", libraryID, key: a.key, typeId: "cites" },
    ]);
  });

  // Spec (6). The post-save reset has to key off what Save actually read at
  // click time, not off `row.ref` as it stands once the write resolves: an
  // edit landing while the write is in flight must stay live and unsaved,
  // and must not make the row's `original` go stale (which the next Save
  // would otherwise read as "this source was removed elsewhere" and drop
  // it). The injection point itself is staged deterministically, on a patch
  // of the storage note's own `save` rather than the shared prototype (see
  // waitForSaveWithInjectedEdit) - but waiting for the click handler's own
  // continuation, several promise-chain hops past that patched call, still
  // needs a settle wait; polling for a side effect of the reset was not
  // reliable, so this follows the adversary probe's own P4 shape here.
  it("keeps a live edit unsaved when it lands while an earlier Save is in flight", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: b.key, typeId: "cites" },
          ],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const nameInput = rowByLabel(panel, "Source A").querySelector(
      "input[type=text]",
    ) as HTMLInputElement;
    nameInput.value = "x";
    nameInput.dispatchEvent(
      new (doc.defaultView as any).Event("input", { bubbles: true }),
    );

    const [note] = await searchStorageNotes(libraryID);
    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSaveWithInjectedEdit(
      note,
      () => saveButton.click(),
      () => {
        nameInput.value = "";
        nameInput.dispatchEvent(
          new (doc.defaultView as any).Event("input", { bubbles: true }),
        );
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assertNoSaveFailure();

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites", name: "x" },
        { kind: "item", libraryID, key: b.key, typeId: "cites" },
      ],
      "the first Save should write what it read at click time, not the edit that landed mid-flight",
    );

    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites" },
        { kind: "item", libraryID, key: b.key, typeId: "cites" },
      ],
      "the in-flight edit should still be live and diff correctly against the next Save, not be lost to a stale original",
    );
  });

  // Spec (7). A second Save click landing before the first one's own promise
  // has been awaited (a double click) must not run against a snapshot taken
  // before the first Save's post-save reset: that snapshot's `original`
  // would still name the pre-Save claim, which the removal pass would then
  // read as "not in the as-read document" and delete.
  it("keeps a retyped source across two Save clicks with no await between", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: b.key, typeId: "cites" },
          ],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const typeSelect = rowByLabel(panel, "Source A").querySelector(
      `.${SOURCE_TYPE_SELECT_CLASS}`,
    ) as HTMLSelectElement;
    typeSelect.value = "supports";
    typeSelect.dispatchEvent(
      new (doc.defaultView as any).Event("change", { bubbles: true }),
    );

    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSaves(() => {
      saveButton.click();
      saveButton.click();
    }, 2);
    assertNoSaveFailure();

    const { timelines } = await listTimelines(libraryID);
    const stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(stored.sources, [
      { kind: "item", libraryID, key: a.key, typeId: "supports" },
      { kind: "item", libraryID, key: b.key, typeId: "cites" },
    ]);
  });

  // Spec (8). Same hazard on a rename, plus a third Save once both earlier
  // ones have settled: the renamed source must still be there, not deleted
  // by the second click's stale snapshot and then absent for good.
  it("keeps a renamed source across a double-click Save and a third Save", async function () {
    const a = await citableItem("Source A");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const nameInput = rowByLabel(panel, "Source A").querySelector(
      "input[type=text]",
    ) as HTMLInputElement;
    nameInput.value = "n";
    nameInput.dispatchEvent(
      new (doc.defaultView as any).Event("input", { bubbles: true }),
    );

    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSaves(() => {
      saveButton.click();
      saveButton.click();
    }, 2);
    assertNoSaveFailure();

    await waitForSaves(() => saveButton.click(), 1);
    assertNoSaveFailure();

    const { timelines } = await listTimelines(libraryID);
    const stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(stored.sources, [
      { kind: "item", libraryID, key: a.key, typeId: "cites", name: "n" },
    ]);
  });

  // Spec (9). Mirrors the adversary probe's P1: a rename lands, and while
  // that Save's write is still in flight the same event is re-selected -
  // what a click on an already-selected canvas item does, since vis emits
  // `select` even when the selection doesn't change. The new render's row
  // for the renamed source is built from the tab's still-stale `documents`,
  // so its `original` names the pre-rename claim. A later Save from that
  // render, with only the title touched, must not treat that stale
  // `original` as unmatched-and-therefore-removed: nothing here removes a
  // row the user never clicked Remove on.
  it("keeps a renamed source when the panel is re-rendered from a stale document before a later Save", async function () {
    const a = await citableItem("Source A");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const oldTitleEl = panel.querySelector(`.${TITLE_INPUT_CLASS}`);
    const nameInput = rowByLabel(panel, "Source A").querySelector(
      "input[type=text]",
    ) as HTMLInputElement;
    nameInput.value = "n";
    nameInput.dispatchEvent(
      new (doc.defaultView as any).Event("input", { bubbles: true }),
    );

    const [note] = await searchStorageNotes(libraryID);
    let saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    let rerendered = false;
    await waitForSaveWithInjectedEdit(
      note,
      () => saveButton.click(),
      () => {
        timeline.setSelection(["doc-second-save:ev-1"]);
        rerendered =
          panel.querySelector(`.${TITLE_INPUT_CLASS}`) !== oldTitleEl;
      },
    );
    await waitFor(() => {
      const el = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return el && el.value === "An event" ? el : null;
    }, 'the re-rendered title field to read "An event"');
    await waitForResolvedLabels(panel);
    assertNoSaveFailure();
    assert.isTrue(rerendered, "the panel was not re-rendered mid-write");

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [{ kind: "item", libraryID, key: a.key, typeId: "cites", name: "n" }],
      "the first Save did not land the rename",
    );

    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "Retitled";

    saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "Retitled");
    assert.deepEqual(
      stored.sources,
      [{ kind: "item", libraryID, key: a.key, typeId: "cites", name: "n" }],
      "the second render's Save removed the source the first Save renamed",
    );
  });

  // Spec (10). The note is rewritten from outside the editor (an
  // add-sources dialog, the item pane's add-to-event, or a sync merge)
  // while the panel sits open on the pre-write event. A title-only Save on
  // that still-live panel must leave the outside addition alone: nothing
  // here infers a removal from a source the render never had a row for.
  it("keeps a source added from outside the open editor across a title-only Save", async function () {
    const a = await citableItem("Source A");
    const d = await citableItem("Source D");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
          tags: [],
        },
      ]),
    );

    const { panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: current.events.map((e) =>
          e.id === "ev-1"
            ? {
                ...e,
                sources: [
                  ...e.sources,
                  { kind: "item", libraryID, key: d.key, typeId: "cites" },
                ],
              }
            : e,
        ),
      }),
      "doc-second-save",
      libraryID,
    );

    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "Retitled";

    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    const { timelines } = await listTimelines(libraryID);
    const stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "Retitled");
    assert.deepEqual(stored.sources, [
      { kind: "item", libraryID, key: a.key, typeId: "cites" },
      { kind: "item", libraryID, key: d.key, typeId: "cites" },
    ]);
  });

  // Spec (11). A Remove click landing while that same row's own Save is
  // still writing used to record the row's pre-Save `original` (the
  // retype's old claim), which the second Save's removal then matched
  // against nothing in storage: the removal was silently dropped. The
  // injection point is the same own-property `save` shadow spec (6) uses
  // (see waitForSaveWithInjectedEdit), landing the Remove click
  // deterministically mid-write.
  it("keeps a removal made against a row while that row's own retype Save is in flight", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: b.key, typeId: "cites" },
          ],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const typeSelect = rowByLabel(panel, "Source A").querySelector(
      `.${SOURCE_TYPE_SELECT_CLASS}`,
    ) as HTMLSelectElement;
    typeSelect.value = "supports";
    typeSelect.dispatchEvent(
      new (doc.defaultView as any).Event("change", { bubbles: true }),
    );

    const [note] = await searchStorageNotes(libraryID);
    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSaveWithInjectedEdit(
      note,
      () => saveButton.click(),
      () => {
        (
          rowByLabel(panel, "Source A").querySelector(
            `.${SOURCE_REMOVE_BUTTON_CLASS}`,
          ) as HTMLButtonElement
        ).click();
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assertNoSaveFailure();

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "supports" },
        { kind: "item", libraryID, key: b.key, typeId: "cites" },
      ],
      "the first Save did not land the retype",
    );
    assert.deepEqual(
      Array.from<HTMLElement>(
        panel.querySelectorAll(`.${SOURCE_LABEL_TEXT_CLASS}`),
      ).map((el) => el.textContent),
      ["Source B"],
      "the panel did not drop the removed row",
    );

    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [{ kind: "item", libraryID, key: b.key, typeId: "cites" }],
      "the second Save's removal did not match what the first Save actually wrote",
    );
  });

  // Spec (12). An addition this session (`original` still null) whose
  // addSource call is refused at write time, because it duplicates a claim
  // the same write keeps, used to be promoted to `original` by the
  // post-save reset as if it had actually been written. A later Save
  // removing its twin then consumed the only stored claim while the
  // refused row's `original` matched nothing, leaving the panel showing a
  // source storage no longer had.
  it("retries an addition a Save refused as a duplicate, once its twin is removed", async function () {
    const a = await citableItem("Source A");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const rows = () =>
      Array.from<HTMLElement>(panel.querySelectorAll(`.${SOURCE_CLASS}`));
    const retype = (row: HTMLElement, typeId: string) => {
      const select = row.querySelector(
        `.${SOURCE_TYPE_SELECT_CLASS}`,
      ) as HTMLSelectElement;
      select.value = typeId;
      select.dispatchEvent(
        new (doc.defaultView as any).Event("change", { bubbles: true }),
      );
    };

    // Retype the existing row away so the picker accepts A(cites) again,
    // then retype it back: two rows, both A(cites), one stored.
    retype(rowByLabel(panel, "Source A"), "supports");
    const restorePicker = stubPicker(a);
    try {
      (
        panel.querySelector(`.${SOURCE_ADD_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      await waitFor(
        () => (rows().length === 2 ? true : null),
        "the picked source row to render",
      );
    } finally {
      restorePicker();
    }
    retype(rows()[0], "cites");

    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "Retitled";

    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "Retitled");
    assert.deepEqual(
      stored.sources,
      [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
      "after the first Save",
    );
    assert.deepEqual(
      rows().map(
        (r) => r.querySelector(`.${SOURCE_LABEL_TEXT_CLASS}`)!.textContent,
      ),
      ["Source A", "Source A"],
    );

    (
      rows()[0].querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
      "the twin's own addition, refused as a duplicate by the first Save, was not retried by the second",
    );
  });

  // Spec (13). Mirrors the adversary probe's P1: stored [A]; B is picked
  // through the add-sources path, a row whose `original` is still null. The
  // first Save's own write (the one adding B) is in flight when the user
  // clicks Remove on B's row. The Remove handler used to record a removal
  // only `if (row.original)`, so B's click was never recorded, and a later
  // title-only Save had no removal to match: B stayed stored even though the
  // user clicked Remove on it. The handler now records every removed row
  // regardless of `original`, and the post-save reset promotes B's
  // `original` once its own addition actually lands, so the next Save's
  // removal matches it.
  it("drops a session-added row Remove'd while its own addition Save is in flight", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
          tags: [],
        },
      ]),
    );

    const { panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const restorePicker = stubPicker(b);
    try {
      (
        panel.querySelector(`.${SOURCE_ADD_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      await waitFor(() => {
        const rowsNow = Array.from<HTMLElement>(
          panel.querySelectorAll(`.${SOURCE_CLASS}`),
        );
        return rowsNow.length === 2 ? true : null;
      }, "the picked Source B row to render");
    } finally {
      restorePicker();
    }

    const [note] = await searchStorageNotes(libraryID);
    const saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSaveWithInjectedEdit(
      note,
      () => saveButton.click(),
      () => {
        (
          rowByLabel(panel, "Source B").querySelector(
            `.${SOURCE_REMOVE_BUTTON_CLASS}`,
          ) as HTMLButtonElement
        ).click();
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assertNoSaveFailure();

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites" },
        { kind: "item", libraryID, key: b.key, typeId: "cites" },
      ],
      "the first Save should have landed B (it was in the snapshot it read)",
    );

    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "Retitled";

    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "Retitled");
    assert.deepEqual(
      stored.sources,
      [{ kind: "item", libraryID, key: a.key, typeId: "cites" }],
      "B was Remove'd while its own addition Save was in flight and must not survive",
    );
  });

  // Spec (14). A completed removal used to sit in `removed` forever: the
  // post-save clearing ran only when that Save's mutate call returned a
  // document, which happens whenever *anything* in the write differed, not
  // only when the removal itself matched. Chosen shape: stored [A, B];
  // Remove A; Save (the removal lands, so this Save's mutate does return a
  // document, exercising the clearing path that already existed); a write
  // from outside the editor then re-adds the same claim; a title-only Save
  // on the still-open panel must leave that re-added A alone rather than
  // matching it against a stale removal intent.
  it("does not let a completed removal delete a later outside re-add of the same claim", async function () {
    const a = await citableItem("Source A");
    const b = await citableItem("Source B");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: b.key, typeId: "cites" },
          ],
          tags: [],
        },
      ]),
    );

    const { panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    (
      rowByLabel(panel, "Source A").querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();

    let saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [{ kind: "item", libraryID, key: b.key, typeId: "cites" }],
      "the first Save did not land the removal",
    );

    await updateTimelineDocument(
      (current) => ({
        ...current,
        events: current.events.map((e) =>
          e.id === "ev-1"
            ? {
                ...e,
                sources: [
                  ...e.sources,
                  { kind: "item", libraryID, key: a.key, typeId: "cites" },
                ],
              }
            : e,
        ),
      }),
      "doc-second-save",
      libraryID,
    );

    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "Retitled";

    saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "Retitled");
    assert.sameDeepMembers(
      stored.sources,
      [
        { kind: "item", libraryID, key: b.key, typeId: "cites" },
        { kind: "item", libraryID, key: a.key, typeId: "cites" },
      ],
      "the outside re-add of A did not survive the title-only Save",
    );
  });

  // Spec (15). Mirrors the adversary probe's P1 in full, staging the stale
  // re-render as spec (9) does. Stored [A(cites), A(supports)]; rename row 1
  // and Save while the panel re-renders mid-write from the still-stale
  // document, leaving row 1's `original` naming the pre-rename claim. In
  // that stale render, retype row 1 to supports and retitle, then Save: the
  // update pass looks for A(cites) in storage and finds nothing (storage now
  // holds A(cites, "n")), so the update is skipped. That skip must leave row
  // 1's `original` untouched rather than promoting it to A(supports), or the
  // next Remove on that row matches row 2's claim instead of its own.
  it("keeps a skipped update retriable instead of deleting an unrelated source on the next Remove", async function () {
    const a = await citableItem("Source A");
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      aDocument([
        {
          id: "ev-1",
          title: "An event",
          date: "1600",
          sources: [
            { kind: "item", libraryID, key: a.key, typeId: "cites" },
            { kind: "item", libraryID, key: a.key, typeId: "supports" },
          ],
          tags: [],
        },
      ]),
    );

    const { doc, panel, timeline } = await openPanel();
    await selectEvent(timeline, panel, "doc-second-save:ev-1", "An event");

    const oldTitleEl = panel.querySelector(`.${TITLE_INPUT_CLASS}`);
    let rows = Array.from<HTMLElement>(
      panel.querySelectorAll(`.${SOURCE_CLASS}`),
    );
    assert.lengthOf(rows, 2);
    const nameInput = rows[0].querySelector(
      "input[type=text]",
    ) as HTMLInputElement;
    nameInput.value = "n";
    nameInput.dispatchEvent(
      new (doc.defaultView as any).Event("input", { bubbles: true }),
    );

    const [note] = await searchStorageNotes(libraryID);
    let saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    let rerendered = false;
    await waitForSaveWithInjectedEdit(
      note,
      () => saveButton.click(),
      () => {
        timeline.setSelection(["doc-second-save:ev-1"]);
        rerendered =
          panel.querySelector(`.${TITLE_INPUT_CLASS}`) !== oldTitleEl;
      },
    );
    await waitFor(() => {
      const el = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return el && el.value === "An event" ? el : null;
    }, 'the re-rendered title field to read "An event"');
    // Waits on the mid-write render in place rather than selecting the event
    // again: a second select re-renders from the tab's document, which the
    // first Save's own continuation may already have updated, and a panel
    // rendered after that is fresh rather than the stale one this spec needs.
    await waitFor(() => {
      const typeSelects = Array.from<HTMLElement>(
        panel.querySelectorAll(`.${SOURCE_TYPE_SELECT_CLASS}`),
      ) as HTMLSelectElement[];
      return typeSelects.every((select) => select.options.length > 0)
        ? true
        : null;
    }, "every source's type select to have its vocabulary loaded");
    await waitForResolvedLabels(panel);
    assertNoSaveFailure();
    assert.isTrue(rerendered, "the panel was not re-rendered mid-write");

    let { timelines } = await listTimelines(libraryID);
    let stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites", name: "n" },
        { kind: "item", libraryID, key: a.key, typeId: "supports" },
      ],
      "the first Save did not land the rename",
    );

    // Stale panel: row 1 still shows A(cites) with no name.
    rows = Array.from<HTMLElement>(panel.querySelectorAll(`.${SOURCE_CLASS}`));
    assert.lengthOf(rows, 2);
    assert.equal(
      (rows[0].querySelector("input[type=text]") as HTMLInputElement).value,
      "",
      "the panel is not stale: row 0 already shows the first Save's rename",
    );
    const typeSelect = rows[0].querySelector(
      `.${SOURCE_TYPE_SELECT_CLASS}`,
    ) as HTMLSelectElement;
    assert.equal(typeSelect.value, "cites");
    typeSelect.value = "supports";
    typeSelect.dispatchEvent(
      new (doc.defaultView as any).Event("change", { bubbles: true }),
    );
    (panel.querySelector(`.${TITLE_INPUT_CLASS}`) as HTMLInputElement).value =
      "Retitled";

    saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "Retitled");
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites", name: "n" },
        { kind: "item", libraryID, key: a.key, typeId: "supports" },
      ],
      "the skipped update must not touch storage",
    );

    // Remove row 1 (still showing the retyped, unsaved supports) and Save,
    // retitling too so this Save actually writes (a Save that changes
    // nothing at all never calls Item#save, which waitForSave has nothing to
    // wait on). Row 1's `original` still names A(cites): the removal pass
    // looks for that and finds nothing either, so it too is skipped.
    rows = Array.from<HTMLElement>(panel.querySelectorAll(`.${SOURCE_CLASS}`));
    (
      rows[0].querySelector(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement
    ).click();
    (panel.querySelector(`.${TITLE_INPUT_CLASS}`) as HTMLInputElement).value =
      "Retitled again";
    saveButton = panel.querySelector(
      `.${SAVE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    await waitForSave(() => saveButton.click());
    assertNoSaveFailure();

    ({ timelines } = await listTimelines(libraryID));
    stored = timelines
      .find((t) => t.doc.id === "doc-second-save")!
      .doc.events.find((e) => e.id === "ev-1")!;
    assert.equal(stored.title, "Retitled again");
    assert.deepEqual(
      stored.sources,
      [
        { kind: "item", libraryID, key: a.key, typeId: "cites", name: "n" },
        { kind: "item", libraryID, key: a.key, typeId: "supports" },
      ],
      "row 2's A(supports), never Remove'd, must survive",
    );
  });
});
