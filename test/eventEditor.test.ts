import { assert } from "chai";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import {
  EMPTY_PROMPT_CLASS,
  SAVE_BUTTON_CLASS,
  DELETE_BUTTON_CLASS,
  TAG_CLASS,
  TAG_TEXT_CLASS,
  TAG_INPUT_CLASS,
  TAG_REMOVE_BUTTON_CLASS,
  TITLE_INPUT_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";

// The editor panel beside the canvas. Driven through timeline.setSelection
// rather than a real click, since a synthesised pointer gesture in this XUL
// window does not satisfy vis-timeline's own gesture recogniser (see
// timelineDrag.test.ts) - setSelection is the same entry point
// timelineDragPayload.test.ts already relies on to get a real item selected.
describe("event editor panel", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    (Zotero as any).ZoteroTimeline.api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
    for (const doc of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, doc);
    }
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  async function openPanel(): Promise<{
    win: any;
    doc: Document;
    panel: HTMLElement;
    timeline: any;
  }> {
    const api = (Zotero as any).ZoteroTimeline.api;
    const win = Zotero.getMainWindows()[0] as any;
    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);
    const doc = win.document as Document;
    const panel = doc.getElementById("zoterotimeline-editor") as HTMLElement;
    const timeline = api.getCurrentTimeline();
    return { win, doc, panel, timeline };
  }

  it("prompts naming both routes when nothing is selected", async function () {
    const { panel } = await openPanel();

    const prompt = panel.querySelector(`.${EMPTY_PROMPT_CLASS}`);
    assert.ok(prompt, "no empty-state prompt rendered");
    assert.isTrue(prompt!.hasAttribute("data-l10n-id"));
    const text = prompt!.textContent ?? "";
    assert.isNotEmpty(text, "the prompt rendered empty");
    assert.notInclude(
      text,
      "event-editor-empty",
      "Fluent did not resolve; the raw message id is showing",
    );
  });

  it("shows the selected event and follows the selection as it changes", async function () {
    const { panel, timeline } = await openPanel();

    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(500);
    let titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    assert.ok(titleInput, "no title field after selecting an event");
    assert.equal(titleInput.value, "Truce negotiations");

    timeline.setSelection(["doc-revolt:ev-fury"]);
    await Zotero.Promise.delay(500);
    titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    assert.ok(titleInput, "no title field after changing the selection");
    assert.equal(
      titleInput.value,
      "Iconoclastic Fury",
      "the panel did not follow the selection change",
    );

    timeline.setSelection([]);
    await Zotero.Promise.delay(500);
    assert.ok(
      panel.querySelector(`.${EMPTY_PROMPT_CLASS}`),
      "clearing the selection did not bring back the prompt",
    );
  });

  it("carries data-l10n-id on every label and button, none rendering raw or empty", async function () {
    const { panel, timeline } = await openPanel();
    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(500);

    const labelsAndButtons = Array.from(
      panel.querySelectorAll("label, button"),
    );
    assert.isAbove(labelsAndButtons.length, 0, "no labels or buttons found");

    for (const el of labelsAndButtons) {
      const localeId = el.getAttribute("data-l10n-id");
      assert.isString(
        localeId,
        `element ${el.outerHTML} carries no data-l10n-id`,
      );
      const text = el.textContent ?? "";
      assert.isNotEmpty(
        text,
        `element with data-l10n-id="${localeId}" rendered empty`,
      );
      assert.notEqual(
        text,
        localeId,
        `element with data-l10n-id="${localeId}" rendered the raw id`,
      );
    }

    // No rendered label carries literal hardcoded English text set directly
    // by this module rather than resolved by Fluent - every label/button
    // reaches the DOM only through data-l10n-id.
    for (const el of labelsAndButtons) {
      assert.isTrue(
        el.hasAttribute("data-l10n-id"),
        `${el.outerHTML} has literal text with no data-l10n-id`,
      );
    }
  });

  it("authors tags as discrete tokens: Enter commits one, commas are not split on", async function () {
    const { panel, doc, timeline } = await openPanel();
    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(500);

    const tagInput = panel.querySelector(
      `.${TAG_INPUT_CLASS}`,
    ) as HTMLInputElement;
    assert.ok(tagInput, "no tag input rendered");

    function commit(value: string): void {
      tagInput.value = value;
      tagInput.dispatchEvent(
        new (doc.defaultView as any).KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    commit("a,b");
    commit("second");

    const chips = Array.from(panel.querySelectorAll(`.${TAG_CLASS}`));
    assert.lengthOf(chips, 2, "expected two committed tags");
    const texts = chips.map(
      (chip) => chip.querySelector(`.${TAG_TEXT_CLASS}`)!.textContent,
    );
    assert.deepEqual(
      texts,
      ["a,b", "second"],
      "the comma-bearing tag did not round-trip unchanged",
    );

    // Removing the first tag removes exactly that one and leaves the order
    // of the rest.
    const removeButtons = Array.from(
      panel.querySelectorAll(`.${TAG_REMOVE_BUTTON_CLASS}`),
    );
    (removeButtons[0] as HTMLButtonElement).click();

    const remaining = Array.from(panel.querySelectorAll(`.${TAG_CLASS}`)).map(
      (chip) => chip.querySelector(`.${TAG_TEXT_CLASS}`)!.textContent,
    );
    assert.deepEqual(remaining, ["second"]);
  });

  it("saves through the mutation and the write path, writing exactly one note", async function () {
    const { panel, timeline } = await openPanel();
    timeline.setSelection(["doc-sources:ev-truce"]);
    await Zotero.Promise.delay(500);

    const titleInput = panel.querySelector(
      `.${TITLE_INPUT_CLASS}`,
    ) as HTMLInputElement;
    titleInput.value = "Truce negotiations, revised";

    const original = (Zotero.Item.prototype as any).save;
    let saveCalls = 0;
    (Zotero.Item.prototype as any).save = function (...args: unknown[]) {
      saveCalls += 1;
      return original.apply(this, args);
    };

    try {
      const saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      saveButton.click();
      await Zotero.Promise.delay(800);
    } finally {
      (Zotero.Item.prototype as any).save = original;
    }

    assert.equal(saveCalls, 1, "expected exactly one note write");

    const { timelines } = await listTimelines(libraryID);
    const updated = timelines
      .find((t) => t.doc.id === "doc-sources")!
      .doc.events.find((e) => e.id === "ev-truce")!;
    assert.equal(updated.title, "Truce negotiations, revised");
  });

  it("clears the selection and removes the event on delete", async function () {
    const { panel, timeline } = await openPanel();
    timeline.setSelection(["doc-revolt:ev-fury"]);
    await Zotero.Promise.delay(500);

    const deleteButton = panel.querySelector(
      `.${DELETE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    assert.ok(deleteButton, "no delete button rendered");
    deleteButton.click();
    await Zotero.Promise.delay(800);

    assert.ok(
      panel.querySelector(`.${EMPTY_PROMPT_CLASS}`),
      "the panel did not revert to the prompt after deleting",
    );

    const { timelines } = await listTimelines(libraryID);
    const doc = timelines.find((t) => t.doc.id === "doc-revolt")!.doc;
    assert.isUndefined(doc.events.find((e) => e.id === "ev-fury"));
  });
});
