/**
 * One of the few things a spec can assert about the RUNNING plugin rather than
 * about its own copy of a module: Zotero.PreferencePanes is Zotero's state, so
 * what the real plugin registered at startup is visible from here.
 *
 * Worth a test because the failure is silent and total. The pane is the only
 * way to reach the hide-plugin-items preference, that preference defaults to
 * on, and nothing else in Zotero reports that a plugin meant to have settings
 * and does not. It shipped unregistered once.
 */
import { assert } from "chai";
import { config } from "../package.json";
import { CURRENT_SCHEMA_VERSION } from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  VOCABULARY_TAG,
  buildVocabularyNoteHtml,
  createTaggedNote,
  findContainers,
  listTimelines,
  readVocabularyFromNote,
  searchVocabularyNotes,
} from "../src/modules/timeline/storage";
import {
  ADD_BUTTON_CLASS,
  CANCEL_BUTTON_CLASS,
  DELETE_BUTTON_CLASS,
  EDIT_BUTTON_CLASS,
  ERROR_CLASS,
  FIELD_INPUT_CLASS,
  NOTE_CLASS,
  ROW_CLASS,
  ROW_LABEL_CLASS,
  SAVE_BUTTON_CLASS,
} from "../src/modules/timeline/vocabularySettings";
import { DEFAULT_LINK_TYPES } from "../src/modules/timeline/vocabulary";
import {
  createDocumentNote,
  createRawNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("the preferences pane", function () {
  function pluginPanes() {
    return (
      Zotero.PreferencePanes as unknown as {
        // Zotero stores a plain-string label as rawLabel; `label` is the
        // data-l10n-id path and stays undefined for a pane registered with a
        // string, which is what this plugin does.
        pluginPanes: {
          id: string;
          pluginID: string;
          src: string;
          rawLabel: string;
        }[];
      }
    ).pluginPanes;
  }

  it("is registered by the plugin", function () {
    const ours = pluginPanes().filter(
      (pane) => pane.pluginID === config.addonID,
    );

    assert.lengthOf(
      ours,
      1,
      "the plugin registered no preferences pane, so its settings are unreachable",
    );
    assert.include(ours[0].src, "preferences.xhtml");
  });

  it("registers a resolved label rather than the raw Fluent key", function () {
    const ours = pluginPanes().filter(
      (pane) => pane.pluginID === config.addonID,
    );

    // getString returns the key itself when no loaded FTL defines it, and
    // Fluent reports that as success, so the raw id reaches the settings
    // sidebar with nothing logged anywhere. pref-title lives in
    // preferences.ftl, which the Localization instance has to load for this.
    assert.notInclude(
      ours[0].rawLabel,
      "pref-title",
      "the pane's label is an unresolved Fluent key",
    );
    assert.equal(ours[0].rawLabel, "Zotero Timeline");
  });

  it("does not register the same pane twice", function () {
    const ids = pluginPanes()
      .filter((pane) => pane.pluginID === config.addonID)
      .map((pane) => pane.id);

    assert.deepEqual([...new Set(ids)], ids);
  });

  // Driven through the real plugin instance rather than an imported render
  // function: getString reaches addon.data.locale, which only the plugin's
  // own bundle has wired up, so a spec's own copy of vocabularySettings.ts
  // would throw on every dynamic label. renderVocabularySettings is exposed
  // on addon.api for exactly this reason (see hooks.ts).
  describe("the vocabulary editor", function () {
    this.timeout(60000);

    let libraryID: number;

    before(function () {
      libraryID = Zotero.Libraries.userLibraryID;
    });

    beforeEach(async function () {
      await eraseAllPluginItems(libraryID);
    });

    afterEach(async function () {
      await eraseAllPluginItems(libraryID);
    });

    function mount(): HTMLElement {
      const win = Zotero.getMainWindows()[0] as any;
      return win.document.createElement("div");
    }

    async function render(container: HTMLElement): Promise<void> {
      await (Zotero as any).ZoteroTimeline.api.renderVocabularySettings(
        container,
      );
    }

    function rowLabels(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll(`.${ROW_LABEL_CLASS}`)).map(
        (el) => el.textContent ?? "",
      );
    }

    // AC #5
    it("shows the defaults marked as not yet stored, and creates neither the note nor a container", async function () {
      const container = mount();
      await render(container);

      assert.deepEqual(
        rowLabels(container),
        DEFAULT_LINK_TYPES.map((t) => t.label),
      );
      const note = container.querySelector(`.${NOTE_CLASS}`);
      assert.ok(note, "no not-yet-stored note rendered");
      assert.isNotEmpty(note!.textContent);

      assert.lengthOf(await searchVocabularyNotes(libraryID), 0);
      assert.lengthOf(await findContainers(libraryID), 0);
    });

    // AC #1, and AC #7's dynamic half: every getString-backed label renders
    // real text, never a raw Fluent message id.
    it("lists the selected library's types, with no empty or unresolved labels", async function () {
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [{ id: "cites", label: "cites, in the author's own words" }],
        }),
      );

      const container = mount();
      await render(container);

      assert.deepEqual(rowLabels(container), [
        "cites, in the author's own words",
      ]);

      const texts = [
        ...Array.from(container.querySelectorAll("button")).map(
          (el) => el.textContent,
        ),
        ...Array.from(container.querySelectorAll("label")).map(
          (el) => el.textContent,
        ),
      ];
      for (const text of texts) {
        assert.isNotEmpty(text, "a control rendered with no label");
        assert.notMatch(
          text ?? "",
          /^vocabulary-/,
          "a raw Fluent message id leaked into the pane",
        );
      }
    });

    // AC #2
    it("adding a type writes it to the library's note with a fresh, non-colliding id", async function () {
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: DEFAULT_LINK_TYPES,
        }),
      );

      const container = mount();
      await render(container);

      (
        container.querySelector(`.${ADD_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      const input = container.querySelector(
        `.${FIELD_INPUT_CLASS}`,
      ) as HTMLInputElement;
      assert.ok(input, "no label field rendered for the add form");
      input.value = "eyewitness account";
      (
        container.querySelector(`.${SAVE_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      // The write runs inside the real plugin's own bundle, not this spec's
      // copy of storage.ts, so whenStorageIdle here would watch the wrong
      // queue and resolve immediately - eventEditor.test.ts hits the same
      // constraint and settles it the same way.
      await Zotero.Promise.delay(800);

      assert.include(rowLabels(container), "eyewitness account");

      const notes = await searchVocabularyNotes(libraryID);
      assert.lengthOf(notes, 1);
      const stored = readVocabularyFromNote(notes[0]);
      const added = stored.types.find((t) => t.label === "eyewitness account");
      assert.ok(added, "the new type was not written to the note");
      assert.isFalse(
        DEFAULT_LINK_TYPES.some((t) => t.id === added!.id),
        "the new type's id collided with an existing one",
      );
      assert.equal(
        stored.types.length,
        DEFAULT_LINK_TYPES.length + 1,
        "an existing type was lost rather than one being added",
      );
    });

    // AC #3
    it("renaming changes the label in the note and leaves the id", async function () {
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [{ id: "cites", label: "cites" }],
        }),
      );

      const container = mount();
      await render(container);

      (container.querySelector(`.${ROW_CLASS}`) as HTMLElement).click();
      (
        container.querySelector(`.${EDIT_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      const input = container.querySelector(
        `.${FIELD_INPUT_CLASS}`,
      ) as HTMLInputElement;
      assert.equal(input.value, "cites");
      input.value = "cites, directly";
      (
        container.querySelector(`.${SAVE_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      await Zotero.Promise.delay(800);

      const notes = await searchVocabularyNotes(libraryID);
      const stored = readVocabularyFromNote(notes[0]);
      assert.lengthOf(stored.types, 1);
      assert.equal(
        stored.types[0].id,
        "cites",
        "the id did not survive the rename",
      );
      assert.equal(stored.types[0].label, "cites, directly");
    });

    // AC #4
    it("shows the count of source links using a type, and deleting anyway leaves those links holding the id", async function () {
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [
            { id: "cites", label: "cites" },
            { id: "supports", label: "supports" },
          ],
        }),
      );
      const doc = documentNamed("Abolition", "tl-vocab-delete");
      doc.events[0].sources = [
        { kind: "item", libraryID, key: "AAAA1111", typeId: "cites" },
        { kind: "item", libraryID, key: "BBBB2222", typeId: "cites" },
      ];
      await createDocumentNote(libraryID, STORAGE_TAG, doc);

      const container = mount();
      await render(container);

      const rows = Array.from(
        container.querySelectorAll(`.${ROW_CLASS}`),
      ) as HTMLElement[];
      const citesRow = rows.find((row) => row.textContent?.includes("cites"))!;
      citesRow.click();

      const api = (Zotero as any).ZoteroTimeline.api;
      let confirmMessage: string | undefined;
      api.setConfirmDeleteForTests(
        (_win: unknown, _title: string, message: string) => {
          confirmMessage = message;
          return true;
        },
      );

      try {
        (
          container.querySelector(
            `.${DELETE_BUTTON_CLASS}`,
          ) as HTMLButtonElement
        ).click();
        await Zotero.Promise.delay(1200);
      } finally {
        api.setConfirmDeleteForTests();
      }

      assert.include(
        confirmMessage,
        "2",
        "the confirmation did not name the count",
      );

      const notes = await searchVocabularyNotes(libraryID);
      const stored = readVocabularyFromNote(notes[0]);
      assert.isUndefined(
        stored.types.find((t) => t.id === "cites"),
        "the type was not removed",
      );
      assert.ok(stored.types.find((t) => t.id === "supports"));

      const { timelines } = await listTimelines(libraryID);
      const sources = timelines.find((t) => t.doc.id === "tl-vocab-delete")!.doc
        .events[0].sources;
      assert.isTrue(
        sources.every((source) => source.typeId === "cites"),
        "deleting the type touched the documents that referenced it",
      );
    });

    // A null count (the storage note that would answer it will not parse)
    // renders as "could not check" rather than as zero, which would let a
    // used type be deleted with no warning at all.
    it("renders a count that could not be checked distinctly from zero", async function () {
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [
            { id: "cites", label: "cites" },
            { id: "supports", label: "supports" },
          ],
        }),
      );
      await createRawNote(
        libraryID,
        STORAGE_TAG,
        "<p>note</p><pre>{not json</pre>",
      );

      const container = mount();
      await render(container);

      (container.querySelector(`.${ROW_CLASS}`) as HTMLElement).click();

      const api = (Zotero as any).ZoteroTimeline.api;
      let confirmMessage: string | undefined;
      api.setConfirmDeleteForTests(
        (_win: unknown, _title: string, message: string) => {
          confirmMessage = message;
          return false;
        },
      );

      try {
        (
          container.querySelector(
            `.${DELETE_BUTTON_CLASS}`,
          ) as HTMLButtonElement
        ).click();
        await Zotero.Promise.delay(500);
      } finally {
        api.setConfirmDeleteForTests();
      }

      assert.isDefined(confirmMessage);
      assert.notInclude(
        confirmMessage!,
        "0 ",
        "an unreadable count read as zero",
      );
    });

    // AC #6 - the open question TASK-34 had to settle. Zotero.Libraries.get is
    // stubbed rather than the library's own editable flag, which cannot be
    // flipped at runtime; the same technique vocabulary.test.ts uses for
    // storage.ts's own not-writable test.
    it("leaves the list showing what is actually stored, and reports a rejected write rather than reverting it silently", async function () {
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [{ id: "cites", label: "cites" }],
        }),
      );

      const container = mount();
      await render(container);

      const originalGet = Zotero.Libraries.get;
      Zotero.Libraries.get = ((id: number) =>
        id === libraryID
          ? ({ editable: false } as unknown as ReturnType<
              typeof Zotero.Libraries.get
            >)
          : originalGet.call(
              Zotero.Libraries,
              id,
            )) as typeof Zotero.Libraries.get;

      try {
        (
          container.querySelector(`.${ADD_BUTTON_CLASS}`) as HTMLButtonElement
        ).click();
        const input = container.querySelector(
          `.${FIELD_INPUT_CLASS}`,
        ) as HTMLInputElement;
        input.value = "a new type";
        (
          container.querySelector(`.${SAVE_BUTTON_CLASS}`) as HTMLButtonElement
        ).click();
        await Zotero.Promise.delay(800);
      } finally {
        Zotero.Libraries.get = originalGet;
      }

      const error = container.querySelector(`.${ERROR_CLASS}`);
      assert.ok(error, "a rejected write reported nothing to the user");
      assert.isNotEmpty(error!.textContent);

      // The list still shows exactly what is on disk: the rejected type was
      // never added, and the input the user typed is still there rather than
      // being discarded.
      assert.notInclude(rowLabels(container), "a new type");
      const notes = await searchVocabularyNotes(libraryID);
      const stored = readVocabularyFromNote(notes[0]);
      assert.deepEqual(stored.types, [{ id: "cites", label: "cites" }]);
      assert.equal(
        (container.querySelector(`.${FIELD_INPUT_CLASS}`) as HTMLInputElement)
          .value,
        "a new type",
        "a failed write discarded the form the user was still typing in",
      );
    });

    it("cancelling the add/edit form clears a previous error and returns to the list", async function () {
      await createTaggedNote(
        libraryID,
        VOCABULARY_TAG,
        buildVocabularyNoteHtml({
          version: CURRENT_SCHEMA_VERSION,
          types: [{ id: "cites", label: "cites" }],
        }),
      );

      const container = mount();
      await render(container);

      (
        container.querySelector(`.${ADD_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();
      (
        container.querySelector(`.${CANCEL_BUTTON_CLASS}`) as HTMLButtonElement
      ).click();

      assert.deepEqual(rowLabels(container), ["cites"]);
      assert.notOk(container.querySelector(`.${ERROR_CLASS}`));
    });
  });
});
