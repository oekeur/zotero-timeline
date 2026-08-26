import { assert } from "chai";
import { CURRENT_SCHEMA_VERSION } from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  VOCABULARY_TAG,
  buildVocabularyNoteHtml,
  createTaggedNote,
  findContainers,
  findOrCreateContainer,
  listTimelines,
  searchVocabularyNotes,
  updateVocabulary,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  DEFAULT_LINK_TYPES,
  UNKNOWN_TYPE_LABEL,
  addLinkType,
  countLinksUsingType,
  labelFor,
  peekVocabulary,
  readVocabulary,
  removeLinkType,
  renameLinkType,
} from "../src/modules/timeline/vocabulary";
import {
  createDocumentNote,
  createRawNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("storage: the link-type vocabulary", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  // The recovery warning is injected: calling the real one from a spec reaches
  // getString, and the addon global does not exist in the test bundle.
  let warnings = 0;
  const countWarning = () => {
    warnings += 1;
  };

  beforeEach(async function () {
    warnings = 0;
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
  });

  // AC #1
  it("recreates a missing vocabulary from the defaults", async function () {
    await findOrCreateContainer(libraryID);

    const result = await readVocabulary(libraryID, countWarning);

    assert.equal(result.state, "recovered");
    assert.deepEqual(result.types, DEFAULT_LINK_TYPES);
    assert.lengthOf(
      await searchVocabularyNotes(libraryID),
      1,
      "recovery did not leave a note behind",
    );
    // AC #2
    assert.equal(warnings, 1, "recovery happened without warning the user");
  });

  it("reads an existing vocabulary rather than recovering over it", async function () {
    await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      buildVocabularyNoteHtml({
        version: CURRENT_SCHEMA_VERSION,
        types: [{ id: "cites", label: "cites, in the author's own words" }],
      }),
    );

    const result = await readVocabulary(libraryID, countWarning);

    assert.equal(result.state, "ok");
    assert.equal(warnings, 0, "a normal read warned the user for no reason");
    assert.lengthOf(result.types, 1);
    assert.equal(result.types[0].label, "cites, in the author's own words");
  });

  // AC #3
  it("leaves the trashed note untouched when it recovers", async function () {
    const original = await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      buildVocabularyNoteHtml({
        version: CURRENT_SCHEMA_VERSION,
        types: [{ id: "cites", label: "my own label" }],
      }),
    );
    const contentBefore = original.getNote();
    original.deleted = true;
    await original.saveTx();

    const result = await readVocabulary(libraryID, countWarning);
    assert.equal(result.state, "recovered");

    const stillThere = (await Zotero.Items.getAsync(
      original.id,
    )) as Zotero.Item;
    assert.isTrue(
      stillThere.deleted,
      "recovery took the note out of the trash",
    );
    await stillThere.reload(["note"], true);
    assert.equal(
      stillThere.getNote(),
      contentBefore,
      "recovery rewrote the trashed note",
    );
  });

  // AC #4, and AC #5 is what decides which note answers the final read.
  it("leaves type ids alone, so restoring the old note brings the labels back", async function () {
    const original = await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      buildVocabularyNoteHtml({
        version: CURRENT_SCHEMA_VERSION,
        types: [{ id: "eyewitness", label: "eyewitness account" }],
      }),
    );
    const doc = documentNamed("Abolition", "tl-a");
    doc.events[0].sources = [
      {
        kind: "item",
        libraryID,
        key: "ABCD2345",
        typeId: "eyewitness",
      },
    ];
    await createDocumentNote(libraryID, STORAGE_TAG, doc);

    original.deleted = true;
    await original.saveTx();
    const recovered = await readVocabulary(libraryID, countWarning);
    assert.equal(recovered.state, "recovered");

    // The custom id is still on the document, untouched, and simply resolves
    // to nothing while the list that names it is in the trash.
    const { timelines } = await listTimelines(libraryID);
    assert.equal(timelines[0].doc.events[0].sources[0].typeId, "eyewitness");
    assert.equal(
      labelFor(recovered.types, "eyewitness"),
      UNKNOWN_TYPE_LABEL,
      "an unresolvable type id should render as unknown, not as a raw id",
    );

    // Restoring brings the label back, and now two live notes exist.
    original.deleted = false;
    await original.saveTx();
    const restored = await readVocabulary(libraryID, countWarning);

    assert.isTrue(
      restored.duplicated,
      "two live vocabulary notes went unreported",
    );
    const winner = [original, ...(await searchVocabularyNotes(libraryID))].sort(
      (a, b) => (a.key < b.key ? -1 : 1),
    )[0];
    assert.equal(
      labelFor(restored.types, "eyewitness"),
      winner.id === original.id ? "eyewitness account" : UNKNOWN_TYPE_LABEL,
    );
  });

  // AC #5
  it("resolves two live notes by lowest key, not by whichever was found first", async function () {
    const first = await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      buildVocabularyNoteHtml({
        version: CURRENT_SCHEMA_VERSION,
        types: [{ id: "a", label: "from the first note" }],
      }),
    );
    const second = await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      buildVocabularyNoteHtml({
        version: CURRENT_SCHEMA_VERSION,
        types: [{ id: "a", label: "from the second note" }],
      }),
    );

    const result = await readVocabulary(libraryID, countWarning);

    assert.isTrue(result.duplicated);
    const lowest = first.key < second.key ? first : second;
    assert.equal(
      result.types[0].label,
      lowest.id === first.id ? "from the first note" : "from the second note",
    );
  });

  // The fourth state: unreadable is not the same as absent.
  it("does not recover over a vocabulary note that will not parse", async function () {
    const broken = await createRawNote(
      libraryID,
      VOCABULARY_TAG,
      "<p>note</p><pre>{not json</pre>",
    );

    const result = await readVocabulary(libraryID, countWarning);

    assert.equal(result.state, "unreadable");
    assert.isString(result.message);
    assert.lengthOf(
      await searchVocabularyNotes(libraryID),
      1,
      "an unreadable vocabulary was replaced by the defaults",
    );
    await broken.reload(["note"], true);
    assert.include(broken.getNote(), "{not json");
  });

  it("does not recover over a vocabulary from a newer plugin", async function () {
    await createRawNote(
      libraryID,
      VOCABULARY_TAG,
      buildVocabularyNoteHtml({
        version: CURRENT_SCHEMA_VERSION + 1,
        types: [],
      }),
    );

    const result = await readVocabulary(libraryID, countWarning);

    assert.equal(result.state, "version-unsupported");
    assert.lengthOf(await searchVocabularyNotes(libraryID), 1);
  });

  it("falls back to the defaults for display without writing them", async function () {
    await createRawNote(
      libraryID,
      VOCABULARY_TAG,
      "<p>note</p><pre>{not json</pre>",
    );

    const result = await readVocabulary(libraryID, countWarning);

    assert.deepEqual(result.types, DEFAULT_LINK_TYPES);
  });

  describe("the write path", function () {
    // AC #1
    it("reads, mutates and writes the one vocabulary note through the same queue as updateTimelineDocument", async function () {
      const written = await updateVocabulary(libraryID, (vocabulary) =>
        addLinkType(vocabulary, "eyewitness account"),
      );

      assert.isNotNull(written);
      assert.isTrue(
        written!.types.some((t) => t.label === "eyewitness account"),
      );

      const result = await readVocabulary(libraryID);
      assert.equal(
        result.state,
        "ok",
        "updateVocabulary should already have written the note",
      );
      assert.deepEqual(result.types, written!.types);
    });

    // AC #2
    it("lands both writes when two updateVocabulary calls start without awaiting the first", async function () {
      const first = updateVocabulary(libraryID, (vocabulary) =>
        addLinkType(vocabulary, "first"),
      );
      const second = updateVocabulary(libraryID, (vocabulary) =>
        addLinkType(vocabulary, "second"),
      );
      await Promise.all([first, second]);
      await whenStorageIdle();

      const result = await readVocabulary(libraryID);
      const labels = result.types.map((t) => t.label);
      assert.include(labels, "first");
      assert.include(labels, "second");
    });

    // AC #3
    it("a rename changes label and leaves id untouched, on the stored note", async function () {
      await updateVocabulary(libraryID, (vocabulary) =>
        addLinkType(vocabulary, "eyewitness"),
      );
      const before = await readVocabulary(libraryID);
      const target = before.types.find((t) => t.label === "eyewitness")!;

      await updateVocabulary(libraryID, (vocabulary) =>
        renameLinkType(vocabulary, target.id, "eyewitness account"),
      );

      const after = await readVocabulary(libraryID);
      const renamed = after.types.find((t) => t.id === target.id);
      assert.isDefined(renamed, "the id did not survive the rename");
      assert.equal(renamed!.label, "eyewitness account");
    });

    // AC #4
    it("a source whose type was deleted still reads back with that typeId, rendered as unknown", async function () {
      await updateVocabulary(libraryID, (vocabulary) =>
        addLinkType(vocabulary, "eyewitness"),
      );
      const before = await readVocabulary(libraryID);
      const target = before.types.find((t) => t.label === "eyewitness")!;

      const doc = documentNamed("Abolition", "tl-deleted-type");
      doc.events[0].sources = [
        { kind: "item", libraryID, key: "ABCD2345", typeId: target.id },
      ];
      await createDocumentNote(libraryID, STORAGE_TAG, doc);

      await updateVocabulary(libraryID, (vocabulary) =>
        removeLinkType(vocabulary, target.id),
      );

      const { timelines } = await listTimelines(libraryID);
      assert.equal(timelines[0].doc.events[0].sources[0].typeId, target.id);

      const after = await readVocabulary(libraryID);
      assert.equal(labelFor(after.types, target.id), UNKNOWN_TYPE_LABEL);
    });

    // AC #5
    it("the non-creating read reports absence and leaves no note and no container behind", async function () {
      const result = await peekVocabulary(libraryID);

      assert.equal(result.state, "absent");
      assert.deepEqual(result.types, DEFAULT_LINK_TYPES);
      assert.lengthOf(await searchVocabularyNotes(libraryID), 0);
      assert.lengthOf(await findContainers(libraryID), 0);
    });

    // AC #6
    it("counts links using a type across every timeline in the library", async function () {
      const docA = documentNamed("Abolition", "tl-count-a");
      docA.events[0].sources = [
        { kind: "item", libraryID, key: "AAAA1111", typeId: "cites" },
        { kind: "item", libraryID, key: "BBBB2222", typeId: "cites" },
      ];
      const docB = documentNamed("Revolt", "tl-count-b");
      docB.events[0].sources = [
        { kind: "item", libraryID, key: "CCCC3333", typeId: "cites" },
      ];
      await createDocumentNote(libraryID, STORAGE_TAG, docA);
      await createDocumentNote(libraryID, STORAGE_TAG, docB);

      assert.equal(await countLinksUsingType(libraryID, "cites"), 3);
      assert.equal(await countLinksUsingType(libraryID, "supports"), 0);
    });

    it("returns null rather than 0 when a document in the library will not parse", async function () {
      await createRawNote(
        libraryID,
        STORAGE_TAG,
        "<p>note</p><pre>{not json</pre>",
      );

      assert.isNull(await countLinksUsingType(libraryID, "cites"));
    });

    // AC #7
    it("refuses a write to a library the user cannot write to, before it ever reaches saveTx", async function () {
      const unwritableLibraryID = -999;
      const originalGet = Zotero.Libraries.get;
      Zotero.Libraries.get = ((id: number) =>
        id === unwritableLibraryID
          ? ({ editable: false } as unknown as ReturnType<
              typeof Zotero.Libraries.get
            >)
          : originalGet.call(
              Zotero.Libraries,
              id,
            )) as typeof Zotero.Libraries.get;

      try {
        let caught: unknown;
        try {
          await updateVocabulary(unwritableLibraryID, (vocabulary) =>
            addLinkType(vocabulary, "x"),
          );
        } catch (err) {
          caught = err;
        }
        assert.instanceOf(caught, Error);
        assert.match((caught as Error).message, /not writable/);
        assert.lengthOf(await searchVocabularyNotes(unwritableLibraryID), 0);
      } finally {
        Zotero.Libraries.get = originalGet;
      }
    });

    // Refused per project/data-model.md: a stored Vocabulary always holds at
    // least one LinkType, and it is the write that refuses, not the mutate
    // function's caller.
    it("refuses to write an empty vocabulary", async function () {
      let caught: unknown;
      try {
        await updateVocabulary(libraryID, () => ({
          version: CURRENT_SCHEMA_VERSION,
          types: [],
        }));
      } catch (err) {
        caught = err;
      }
      assert.instanceOf(caught, Error);
      assert.lengthOf(await searchVocabularyNotes(libraryID), 0);
    });
  });
});
