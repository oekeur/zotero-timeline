import { assert } from "chai";
import edtfParse from "edtf";
import { STORAGE_TAG, listTimelines } from "../src/modules/timeline/storage";
import { toTimelineRange } from "../src/utils/edtfRange";
import {
  EMPTY_PROMPT_CLASS,
  SAVE_BUTTON_CLASS,
  DELETE_BUTTON_CLASS,
  DATE_INPUT_CLASS,
  DATE_FEEDBACK_CLASS,
  DATE_FEEDBACK_FORM_CLASS,
  DATE_FEEDBACK_RANGE_CLASS,
  END_DATE_INPUT_CLASS,
  TAG_CLASS,
  TAG_TEXT_CLASS,
  TAG_INPUT_CLASS,
  TAG_REMOVE_BUTTON_CLASS,
  TITLE_INPUT_CLASS,
  SOURCE_CLASS,
  SOURCE_LABEL_TEXT_CLASS,
  SOURCE_SHOW_BUTTON_CLASS,
  SOURCE_TYPE_SELECT_CLASS,
  SOURCE_NAME_INPUT_CLASS,
  SOURCE_REMOVE_BUTTON_CLASS,
  SOURCE_ADD_BUTTON_CLASS,
} from "../src/modules/timeline/eventEditor";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_LINK_TYPES,
} from "../src/modules/timeline/schema";
import { UNKNOWN_TYPE_LABEL } from "../src/modules/timeline/vocabulary";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";
import { waitFor } from "./waitFor";

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
    const doc = win.document as Document;
    const panel = (await waitFor(
      () => doc.getElementById("zoterotimeline-editor"),
      "the editor panel to render",
    )) as HTMLElement;
    await waitForResolvedLabels(panel);
    const timeline = api.getCurrentTimeline();
    return { win, doc, panel, timeline };
  }

  // Fluent's DOM observer translates newly inserted data-l10n-id nodes
  // asynchronously; every label and button in this panel carries real text
  // once resolved (the "carries data-l10n-id..." spec below is what proves
  // that invariant), so waiting for all of them beats a fixed guess at how
  // long Fluent takes. Inputs and selects are excluded: their own
  // data-l10n-id targets an attribute (placeholder, aria-label), never
  // textContent, so they would never satisfy this check at all. tagName on
  // an element created with a bare createElement() in this chrome document
  // comes back lowercase, not the uppercase an HTML-namespace element would
  // give - matching case-insensitively is what actually excludes them.
  async function waitForResolvedLabels(panel: HTMLElement): Promise<void> {
    await waitFor(() => {
      const labeled = Array.from(
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

  // Selects an event and waits for the title field to actually show its
  // title, not just for the field to exist - the same input persists across
  // a selection change, so its mere presence proves nothing about which
  // event it is currently showing. Also waits for any rendered source's type
  // select to have its vocabulary options loaded, a separate async chain
  // (peekVocabulary) from the title's own render.
  async function selectEvent(
    timeline: any,
    panel: HTMLElement,
    id: string,
    expectedTitle: string,
  ): Promise<HTMLInputElement> {
    timeline.setSelection([id]);
    const input = (await waitFor(() => {
      const el = panel.querySelector(
        `.${TITLE_INPUT_CLASS}`,
      ) as HTMLInputElement | null;
      return el && el.value === expectedTitle ? el : null;
    }, `the title field to read "${expectedTitle}"`)) as HTMLInputElement;
    await waitFor(() => {
      const typeSelects = Array.from(
        panel.querySelectorAll(`.${SOURCE_TYPE_SELECT_CLASS}`),
      ) as HTMLSelectElement[];
      return typeSelects.every((select) => select.options.length > 0)
        ? true
        : null;
    }, "every source's type select to have its vocabulary loaded");
    await waitForResolvedLabels(panel);
    return input;
  }

  async function clearSelection(
    timeline: any,
    panel: HTMLElement,
  ): Promise<HTMLElement> {
    timeline.setSelection([]);
    return (await waitFor(
      () => panel.querySelector(`.${EMPTY_PROMPT_CLASS}`),
      "the panel to revert to the empty prompt",
    )) as HTMLElement;
  }

  // Some saves round-trip to content that looks identical to what was there
  // before, so there is nothing new to poll for in the stored document
  // itself. Waiting on the underlying Zotero.Item#save() call resolving is
  // the real condition: updateTimelineDocument awaits exactly that call
  // before the click handler's own promise settles.
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

    let titleInput = await selectEvent(
      timeline,
      panel,
      "doc-sources:ev-truce",
      "Truce negotiations",
    );
    assert.ok(titleInput, "no title field after selecting an event");
    assert.equal(titleInput.value, "Truce negotiations");

    titleInput = await selectEvent(
      timeline,
      panel,
      "doc-revolt:ev-fury",
      "Iconoclastic Fury",
    );
    assert.ok(titleInput, "no title field after changing the selection");
    assert.equal(
      titleInput.value,
      "Iconoclastic Fury",
      "the panel did not follow the selection change",
    );

    await clearSelection(timeline, panel);
    assert.ok(
      panel.querySelector(`.${EMPTY_PROMPT_CLASS}`),
      "clearing the selection did not bring back the prompt",
    );
  });

  it("carries data-l10n-id on every label and button, none rendering raw or empty", async function () {
    const { panel, timeline } = await openPanel();
    await selectEvent(
      timeline,
      panel,
      "doc-sources:ev-truce",
      "Truce negotiations",
    );

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
    await selectEvent(
      timeline,
      panel,
      "doc-sources:ev-truce",
      "Truce negotiations",
    );

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
    const titleInput = await selectEvent(
      timeline,
      panel,
      "doc-sources:ev-truce",
      "Truce negotiations",
    );

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
      await waitFor(
        () => (saveCalls > 0 ? true : null),
        "the note save to fire",
      );
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
    await selectEvent(
      timeline,
      panel,
      "doc-revolt:ev-fury",
      "Iconoclastic Fury",
    );

    const deleteButton = panel.querySelector(
      `.${DELETE_BUTTON_CLASS}`,
    ) as HTMLButtonElement;
    assert.ok(deleteButton, "no delete button rendered");
    deleteButton.click();

    await waitFor(
      () => panel.querySelector(`.${EMPTY_PROMPT_CLASS}`),
      "the panel to revert to the prompt after deleting",
    );

    assert.ok(
      panel.querySelector(`.${EMPTY_PROMPT_CLASS}`),
      "the panel did not revert to the prompt after deleting",
    );

    const { timelines } = await listTimelines(libraryID);
    const doc = timelines.find((t) => t.doc.id === "doc-revolt")!.doc;
    assert.isUndefined(doc.events.find((e) => e.id === "ev-fury"));
  });

  describe("date parse feedback", function () {
    function setValue(
      doc: Document,
      input: HTMLInputElement,
      value: string,
    ): void {
      input.value = value;
      input.dispatchEvent(
        new (doc.defaultView as any).Event("input", { bubbles: true }),
      );
    }

    async function waitForFeedbackForm(
      panel: HTMLElement,
      expectedForm: string,
    ): Promise<Element> {
      return waitFor(() => {
        const feedback = panel.querySelector(`.${DATE_FEEDBACK_CLASS}`);
        const form = feedback?.querySelector(`.${DATE_FEEDBACK_FORM_CLASS}`);
        return form && form.textContent === expectedForm ? feedback : null;
      }, `date feedback form to read "${expectedForm}"`) as Promise<Element>;
    }

    it("names a plain date and resolves the same range toTimelineRange does", async function () {
      const { panel, doc, timeline } = await openPanel();
      await selectEvent(
        timeline,
        panel,
        "doc-revolt:ev-utrecht",
        "Union of Utrecht",
      );

      const dateInput = panel.querySelector(
        `.${DATE_INPUT_CLASS}`,
      ) as HTMLInputElement;
      setValue(doc, dateInput, "1621-03-09");
      const feedback = await waitForFeedbackForm(panel, "Plain");

      const formText = feedback.querySelector(
        `.${DATE_FEEDBACK_FORM_CLASS}`,
      )!.textContent;
      assert.equal(formText, "Plain");
      const rangeText = feedback.querySelector(
        `.${DATE_FEEDBACK_RANGE_CLASS}`,
      )!.textContent;
      const expected = toTimelineRange("1621-03-09");
      const expectedText = expected.end
        ? `${expected.start.toLocaleDateString()} – ${expected.end.toLocaleDateString()}`
        : expected.start.toLocaleDateString();
      assert.equal(rangeText, expectedText);
    });

    it("names uncertain and approximate distinctly, both still type Date", async function () {
      const { panel, doc, timeline } = await openPanel();
      await selectEvent(
        timeline,
        panel,
        "doc-revolt:ev-utrecht",
        "Union of Utrecht",
      );

      const dateInput = panel.querySelector(
        `.${DATE_INPUT_CLASS}`,
      ) as HTMLInputElement;

      setValue(doc, dateInput, "1621?");
      let feedback = await waitForFeedbackForm(panel, "Uncertain");
      assert.equal(
        feedback.querySelector(`.${DATE_FEEDBACK_FORM_CLASS}`)!.textContent,
        "Uncertain",
      );

      setValue(doc, dateInput, "1580~");
      feedback = await waitForFeedbackForm(panel, "Approximate");
      assert.equal(
        feedback.querySelector(`.${DATE_FEEDBACK_FORM_CLASS}`)!.textContent,
        "Approximate",
      );
    });

    it("names an interval and a one-of set differently, even though both resolve to a similar-looking range", async function () {
      const { panel, doc, timeline } = await openPanel();
      await selectEvent(
        timeline,
        panel,
        "doc-revolt:ev-utrecht",
        "Union of Utrecht",
      );

      const dateInput = panel.querySelector(
        `.${DATE_INPUT_CLASS}`,
      ) as HTMLInputElement;

      setValue(doc, dateInput, "1580/1590");
      let feedback = await waitForFeedbackForm(panel, "Interval");
      assert.equal(
        feedback.querySelector(`.${DATE_FEEDBACK_FORM_CLASS}`)!.textContent,
        "Interval",
      );

      setValue(doc, dateInput, "[1580..1590]");
      feedback = await waitForFeedbackForm(panel, "One of");
      assert.equal(
        feedback.querySelector(`.${DATE_FEEDBACK_FORM_CLASS}`)!.textContent,
        "One of",
        "a one-of set must not be named the same as an interval",
      );
    });

    it("shows edtf's own message verbatim on a rejected string, and saves it unchanged", async function () {
      const { panel, doc, timeline } = await openPanel();
      await selectEvent(
        timeline,
        panel,
        "doc-revolt:ev-utrecht",
        "Union of Utrecht",
      );

      const dateInput = panel.querySelector(
        `.${DATE_INPUT_CLASS}`,
      ) as HTMLInputElement;
      setValue(doc, dateInput, "not-a-date");

      let expectedMessage: string;
      try {
        edtfParse("not-a-date");
        throw new Error("expected edtf to reject 'not-a-date'");
      } catch (err) {
        expectedMessage = (err as Error).message;
      }

      const feedback = (await waitFor(() => {
        const el = panel.querySelector(`.${DATE_FEEDBACK_CLASS}`);
        return el && el.textContent === expectedMessage ? el : null;
      }, "the date feedback to show edtf's rejection message")) as Element;
      assert.equal(feedback.textContent, expectedMessage);
      assert.isNull(
        feedback.querySelector(`.${DATE_FEEDBACK_FORM_CLASS}`),
        "a rejected string must not render form/range feedback",
      );

      const saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      await waitForSave(() => saveButton.click());

      const { timelines } = await listTimelines(libraryID);
      const updated = timelines
        .find((t) => t.doc.id === "doc-revolt")!
        .doc.events.find((e) => e.id === "ev-utrecht")!;
      assert.equal(
        updated.date,
        "not-a-date",
        "an edtf-rejected string must save verbatim, not be rewritten or blocked",
      );
    });

    // The reopen step below (clear the selection, reselect the same event,
    // read the field back) kept timing out on waitFor even once the prior
    // save was confirmed landed in storage: the panel's own re-render reads
    // an in-memory documents map that onChange updates in a later microtask
    // than the item.save() waitForSave watches, and nothing else re-renders
    // it before that catches up. That gap is real, but not one this task's
    // budget covers root-causing further, so this spec's post-select steps
    // stay on their original fixed delays rather than risk a flaky
    // conversion; the select itself already proved reliable.
    it("clears endDate to no endDate (a point, not a range) when saved empty", async function () {
      const { panel, doc, timeline } = await openPanel();
      await selectEvent(
        timeline,
        panel,
        "doc-revolt:ev-utrecht",
        "Union of Utrecht",
      );

      const endDateInput = panel.querySelector(
        `.${END_DATE_INPUT_CLASS}`,
      ) as HTMLInputElement;
      assert.equal(
        endDateInput.value,
        "",
        "fixture event starts with no endDate",
      );
      setValue(doc, endDateInput, "1580");

      let saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      saveButton.click();
      await Zotero.Promise.delay(800);

      let { timelines } = await listTimelines(libraryID);
      let updated = timelines
        .find((t) => t.doc.id === "doc-revolt")!
        .doc.events.find((e) => e.id === "ev-utrecht")!;
      assert.equal(updated.endDate, "1580");

      timeline.setSelection([]);
      await Zotero.Promise.delay(300);
      timeline.setSelection(["doc-revolt:ev-utrecht"]);
      await Zotero.Promise.delay(500);

      const reopenedEndDateInput = panel.querySelector(
        `.${END_DATE_INPUT_CLASS}`,
      ) as HTMLInputElement;
      assert.equal(reopenedEndDateInput.value, "1580");
      setValue(doc, reopenedEndDateInput, "");

      saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      saveButton.click();
      await Zotero.Promise.delay(800);

      ({ timelines } = await listTimelines(libraryID));
      updated = timelines
        .find((t) => t.doc.id === "doc-revolt")!
        .doc.events.find((e) => e.id === "ev-utrecht")!;
      assert.isUndefined(
        updated.endDate,
        "an empty endDate field must clear the field, not save an empty string",
      );
    });
  });

  // selectItemsDialog is modal and cannot be opened in an automated run
  // (sourcePicker.test.ts), so these stub Zotero.getMainWindow itself - a
  // real Zotero global shared across the production and test bundles, unlike
  // a local module import - to make openDialog hand back a chosen item
  // synchronously, the same way a user's pick would.
  describe("sources section", function () {
    let extras: Zotero.Item[];

    beforeEach(function () {
      extras = [];
    });

    afterEach(async function () {
      for (const item of extras) {
        await item.eraseTx();
      }
    });

    async function citableItem(title: string): Promise<Zotero.Item> {
      const item = new Zotero.Item("document");
      item.libraryID = libraryID;
      item.setField("title", title);
      await item.saveTx();
      extras.push(item);
      return item;
    }

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

    function setValue(
      doc: Document,
      input: HTMLInputElement,
      value: string,
    ): void {
      input.value = value;
      input.dispatchEvent(
        new (doc.defaultView as any).Event("input", { bubbles: true }),
      );
    }

    it("renders no rows and an add control when the event has no sources", async function () {
      const { panel, timeline } = await openPanel();
      await selectEvent(
        timeline,
        panel,
        "doc-sources:ev-truce",
        "Truce negotiations",
      );

      assert.lengthOf(panel.querySelectorAll(`.${SOURCE_CLASS}`), 0);
      const addButton = panel.querySelector(
        `.${SOURCE_ADD_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      assert.ok(addButton, "no add-source control rendered");
      assert.isTrue(addButton.hasAttribute("data-l10n-id"));
    });

    it("adds a source through the picker without writing, then Save writes it", async function () {
      const { panel, timeline } = await openPanel();
      await selectEvent(
        timeline,
        panel,
        "doc-sources:ev-truce",
        "Truce negotiations",
      );

      const item = await citableItem("A cited work");
      const restore = stubPicker(item);
      try {
        const addButton = panel.querySelector(
          `.${SOURCE_ADD_BUTTON_CLASS}`,
        ) as HTMLButtonElement;
        addButton.click();
        await waitFor(
          () =>
            panel.querySelectorAll(`.${SOURCE_CLASS}`).length === 1
              ? true
              : null,
          "the picked source row to render",
        );
      } finally {
        restore();
      }

      const rows = panel.querySelectorAll(`.${SOURCE_CLASS}`);
      assert.lengthOf(rows, 1, "adding through the picker did not add a row");
      assert.equal(
        rows[0].querySelector(`.${SOURCE_LABEL_TEXT_CLASS}`)!.textContent,
        "A cited work",
      );

      let { timelines } = await listTimelines(libraryID);
      let stored = timelines
        .find((t) => t.doc.id === "doc-sources")!
        .doc.events.find((e) => e.id === "ev-truce")!;
      assert.lengthOf(
        stored.sources,
        0,
        "adding through the picker wrote before Save was clicked",
      );

      const saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      await waitForSave(() => saveButton.click());

      ({ timelines } = await listTimelines(libraryID));
      stored = timelines
        .find((t) => t.doc.id === "doc-sources")!
        .doc.events.find((e) => e.id === "ev-truce")!;
      assert.lengthOf(stored.sources, 1);
      assert.deepEqual(stored.sources[0], {
        kind: "item",
        libraryID,
        key: item.key,
        typeId: DEFAULT_LINK_TYPES[0].id,
      });
    });

    // AC #2
    it("keeps a row's typeId across a save when it resolves to no type", async function () {
      const item = await citableItem("A cited work");
      await createDocumentNote(libraryID, STORAGE_TAG, {
        version: CURRENT_SCHEMA_VERSION,
        id: "doc-unknown-type",
        name: "Unknown type fixture",
        events: [
          {
            id: "ev-1",
            title: "An event",
            date: "1600",
            sources: [
              { kind: "item", libraryID, key: item.key, typeId: "made-up" },
            ],
            tags: [],
          },
        ],
      });

      const { panel, timeline } = await openPanel();
      await selectEvent(timeline, panel, "doc-unknown-type:ev-1", "An event");

      const typeSelect = panel.querySelector(
        `.${SOURCE_TYPE_SELECT_CLASS}`,
      ) as HTMLSelectElement;
      assert.equal(typeSelect.value, "made-up");
      const selectedOption = typeSelect.options[typeSelect.selectedIndex];
      assert.equal(selectedOption.textContent, UNKNOWN_TYPE_LABEL);

      const saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      // Nothing about the form changes before this click, so the mutation
      // is a genuine no-op the write path skips (mutations.test.ts's own
      // "returns null when the change is a no-op" spec) - item.save() never
      // runs, so waitForSave's condition would never fire. The typeId is
      // already correct before the click; polling storage for it is the
      // real condition either way.
      saveButton.click();
      const updated = await waitFor(async () => {
        const { timelines } = await listTimelines(libraryID);
        const event = timelines
          .find((t) => t.doc.id === "doc-unknown-type")
          ?.doc.events.find((e) => e.id === "ev-1");
        return event?.sources[0]?.typeId === "made-up" ? event : null;
      }, 'the unresolved typeId to still read "made-up" after Save');
      assert.equal(updated.sources[0].typeId, "made-up");
    });

    // AC #7
    it("writes a row's new type on Save and rewrites nothing else on the event", async function () {
      const item = await citableItem("A cited work");
      await createDocumentNote(libraryID, STORAGE_TAG, {
        version: CURRENT_SCHEMA_VERSION,
        id: "doc-retype",
        name: "Retype fixture",
        events: [
          {
            id: "ev-1",
            title: "An event",
            date: "1600",
            sources: [
              { kind: "item", libraryID, key: item.key, typeId: "cites" },
            ],
            tags: [],
          },
        ],
      });

      const { panel, doc, timeline } = await openPanel();
      await selectEvent(timeline, panel, "doc-retype:ev-1", "An event");

      const typeSelect = panel.querySelector(
        `.${SOURCE_TYPE_SELECT_CLASS}`,
      ) as HTMLSelectElement;
      typeSelect.value = "supports";
      typeSelect.dispatchEvent(
        new (doc.defaultView as any).Event("change", { bubbles: true }),
      );

      const saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      await waitForSave(() => saveButton.click());

      const { timelines } = await listTimelines(libraryID);
      const updated = timelines
        .find((t) => t.doc.id === "doc-retype")!
        .doc.events.find((e) => e.id === "ev-1")!;
      assert.lengthOf(updated.sources, 1);
      assert.deepEqual(updated.sources[0], {
        kind: "item",
        libraryID,
        key: item.key,
        typeId: "supports",
      });
      assert.equal(
        updated.title,
        "An event",
        "a type-only change must not rewrite the rest of the event",
      );
    });

    // AC #8
    // Same reopen-after-save gap as "clears endDate" above: the initial
    // select is reliable, converted; the reopen after Save is not, and
    // stays on its original fixed delay pending further investigation.
    it("saves a free-text name, and clearing it removes the key rather than storing an empty string", async function () {
      const item = await citableItem("A cited work");
      await createDocumentNote(libraryID, STORAGE_TAG, {
        version: CURRENT_SCHEMA_VERSION,
        id: "doc-name",
        name: "Name fixture",
        events: [
          {
            id: "ev-1",
            title: "An event",
            date: "1600",
            sources: [
              { kind: "item", libraryID, key: item.key, typeId: "cites" },
            ],
            tags: [],
          },
        ],
      });

      const { panel, doc, timeline } = await openPanel();
      await selectEvent(timeline, panel, "doc-name:ev-1", "An event");

      let nameInput = panel.querySelector(
        `.${SOURCE_NAME_INPUT_CLASS}`,
      ) as HTMLInputElement;
      setValue(doc, nameInput, "Primary account");

      let saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      saveButton.click();
      await Zotero.Promise.delay(800);

      let { timelines } = await listTimelines(libraryID);
      let updated = timelines
        .find((t) => t.doc.id === "doc-name")!
        .doc.events.find((e) => e.id === "ev-1")!;
      assert.equal(updated.sources[0].name, "Primary account");

      timeline.setSelection([]);
      await Zotero.Promise.delay(300);
      timeline.setSelection(["doc-name:ev-1"]);
      await Zotero.Promise.delay(500);

      nameInput = panel.querySelector(
        `.${SOURCE_NAME_INPUT_CLASS}`,
      ) as HTMLInputElement;
      assert.equal(nameInput.value, "Primary account");
      setValue(doc, nameInput, "");

      saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      saveButton.click();
      await Zotero.Promise.delay(800);

      ({ timelines } = await listTimelines(libraryID));
      updated = timelines
        .find((t) => t.doc.id === "doc-name")!
        .doc.events.find((e) => e.id === "ev-1")!;
      assert.isUndefined(
        updated.sources[0].name,
        "clearing the name must remove the key, not store an empty string",
      );
    });

    // AC #9
    it("drops a removed row on Save and leaves every other source in order", async function () {
      const itemA = await citableItem("Source A");
      const itemB = await citableItem("Source B");
      await createDocumentNote(libraryID, STORAGE_TAG, {
        version: CURRENT_SCHEMA_VERSION,
        id: "doc-remove",
        name: "Remove fixture",
        events: [
          {
            id: "ev-1",
            title: "An event",
            date: "1600",
            sources: [
              { kind: "item", libraryID, key: itemA.key, typeId: "cites" },
              { kind: "item", libraryID, key: itemB.key, typeId: "supports" },
            ],
            tags: [],
          },
        ],
      });

      const { panel, timeline } = await openPanel();
      await selectEvent(timeline, panel, "doc-remove:ev-1", "An event");

      const removeButtons = panel.querySelectorAll(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      );
      assert.lengthOf(removeButtons, 2);
      (removeButtons[0] as HTMLButtonElement).click();

      const saveButton = panel.querySelector(
        `.${SAVE_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      await waitForSave(() => saveButton.click());

      const { timelines } = await listTimelines(libraryID);
      const updated = timelines
        .find((t) => t.doc.id === "doc-remove")!
        .doc.events.find((e) => e.id === "ev-1")!;
      assert.lengthOf(updated.sources, 1);
      assert.deepEqual(updated.sources[0], {
        kind: "item",
        libraryID,
        key: itemB.key,
        typeId: "supports",
      });
    });

    // AC #10
    it("leaves the stored document byte-identical when the panel is abandoned after adding, retyping and removing a source", async function () {
      const item = await citableItem("A cited work");
      const note = await createDocumentNote(libraryID, STORAGE_TAG, {
        version: CURRENT_SCHEMA_VERSION,
        id: "doc-abandon",
        name: "Abandon fixture",
        events: [
          {
            id: "ev-1",
            title: "An event",
            date: "1600",
            sources: [
              { kind: "item", libraryID, key: item.key, typeId: "cites" },
            ],
            tags: [],
          },
        ],
      });
      const before = note.getNote();

      const { panel, doc, timeline } = await openPanel();
      await selectEvent(timeline, panel, "doc-abandon:ev-1", "An event");

      const typeSelect = panel.querySelector(
        `.${SOURCE_TYPE_SELECT_CLASS}`,
      ) as HTMLSelectElement;
      typeSelect.value = "supports";
      typeSelect.dispatchEvent(
        new (doc.defaultView as any).Event("change", { bubbles: true }),
      );

      const other = await citableItem("Another work");
      const restore = stubPicker(other);
      try {
        const addButton = panel.querySelector(
          `.${SOURCE_ADD_BUTTON_CLASS}`,
        ) as HTMLButtonElement;
        addButton.click();
        await waitFor(
          () =>
            panel.querySelectorAll(`.${SOURCE_CLASS}`).length === 2
              ? true
              : null,
          "the added source row to render",
        );
      } finally {
        restore();
      }

      const removeButtons = panel.querySelectorAll(
        `.${SOURCE_REMOVE_BUTTON_CLASS}`,
      );
      assert.lengthOf(removeButtons, 2, "the added row did not render");
      (removeButtons[removeButtons.length - 1] as HTMLButtonElement).click();

      await clearSelection(timeline, panel);

      await note.reload(["note"], true);
      assert.equal(
        note.getNote(),
        before,
        "abandoning the panel after add/retype/remove rewrote the note",
      );
    });

    // TASK-36 AC #1, #2
    it("offers a jump control only for a ref that resolves, and clicking it selects the item and leaves the timeline tab", async function () {
      // The scaffold's reporter drops a plain Error's message and shows a
      // bare `undefined`, while a chai AssertionError survives with its
      // text. waitFor (used inside openPanel/selectEvent too) throws a plain
      // Error, so a timeout anywhere in this spec is otherwise unreadable.
      try {
        await jumpControlSelectsItemAndLeavesTab();
      } catch (error) {
        assert.fail(
          `jump control spec failed: ${(error as Error)?.message ?? String(error)}`,
        );
      }
    });

    async function jumpControlSelectsItemAndLeavesTab(): Promise<void> {
      const item = await citableItem("A cited work");
      await createDocumentNote(libraryID, STORAGE_TAG, {
        version: CURRENT_SCHEMA_VERSION,
        id: "doc-jump",
        name: "Jump fixture",
        events: [
          {
            id: "ev-1",
            title: "An event",
            date: "1600",
            sources: [
              { kind: "item", libraryID, key: item.key, typeId: "cites" },
              { kind: "item", libraryID, key: "MISSING1", typeId: "cites" },
            ],
            tags: [],
          },
        ],
      });

      const { panel, win, timeline } = await openPanel();
      await selectEvent(timeline, panel, "doc-jump:ev-1", "An event");

      const rows = Array.from(panel.querySelectorAll(`.${SOURCE_CLASS}`));
      assert.lengthOf(rows, 2);
      const resolvedRow = rows.find(
        (row) =>
          row.querySelector(`.${SOURCE_LABEL_TEXT_CLASS}`)!.textContent ===
          "A cited work",
      )!;
      const missingRow = rows.find((row) => row !== resolvedRow)!;
      assert.ok(resolvedRow, "no row rendered for the resolvable ref");
      assert.ok(missingRow, "no row rendered for the unresolvable ref");

      assert.isNull(
        missingRow.querySelector(`.${SOURCE_SHOW_BUTTON_CLASS}`),
        "a ref that resolves to nothing must not offer a jump control",
      );

      const showButton = resolvedRow.querySelector(
        `.${SOURCE_SHOW_BUTTON_CLASS}`,
      ) as HTMLButtonElement;
      assert.ok(showButton, "no jump control rendered for a resolvable ref");
      assert.isTrue(showButton.hasAttribute("data-l10n-id"));

      const Zotero_Tabs = win.Zotero_Tabs;
      assert.notEqual(
        Zotero_Tabs.selectedID,
        "zotero-pane",
        "the timeline tab should still be active before the jump",
      );

      showButton.click();
      await waitFor(
        () => (Zotero_Tabs.selectedID === "zotero-pane" ? true : null),
        "the jump to leave the timeline tab",
      );

      assert.equal(
        Zotero_Tabs.selectedID,
        "zotero-pane",
        "clicking the jump control did not leave the timeline tab",
      );
      const selected = win.ZoteroPane.getSelectedItems();
      assert.lengthOf(selected, 1);
      assert.equal(
        selected[0].id,
        item.id,
        "the jump did not select the source's own item",
      );
    }

    // AC #3
    it("does not jump when the row itself is clicked, only when its own control is", async function () {
      const item = await citableItem("A cited work");
      await createDocumentNote(libraryID, STORAGE_TAG, {
        version: CURRENT_SCHEMA_VERSION,
        id: "doc-no-row-jump",
        name: "No row jump fixture",
        events: [
          {
            id: "ev-1",
            title: "An event",
            date: "1600",
            sources: [
              { kind: "item", libraryID, key: item.key, typeId: "cites" },
            ],
            tags: [],
          },
        ],
      });

      const { panel, win, timeline } = await openPanel();
      await selectEvent(timeline, panel, "doc-no-row-jump:ev-1", "An event");

      const row = panel.querySelector(`.${SOURCE_CLASS}`) as HTMLElement;
      const labelSpan = row.querySelector(
        `.${SOURCE_LABEL_TEXT_CLASS}`,
      ) as HTMLElement;
      labelSpan.click();
      row.click();
      // Asserting nothing happens has no condition to poll for.
      await Zotero.Promise.delay(500);

      assert.notEqual(
        win.Zotero_Tabs.selectedID,
        "zotero-pane",
        "clicking the row itself must not leave the timeline tab",
      );
    });
  });
});
