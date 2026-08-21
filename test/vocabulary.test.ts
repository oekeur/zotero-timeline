import { assert } from "chai";
import { CURRENT_SCHEMA_VERSION } from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  VOCABULARY_TAG,
  buildVocabularyNoteHtml,
  createTaggedNote,
  findOrCreateContainer,
  listTimelines,
  searchVocabularyNotes,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  DEFAULT_LINK_TYPES,
  UNKNOWN_TYPE_LABEL,
  labelFor,
  readVocabulary,
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
});
