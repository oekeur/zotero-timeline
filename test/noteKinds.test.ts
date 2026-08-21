import { assert } from "chai";
import {
  STORAGE_TAG,
  StorageError,
  VOCABULARY_TAG,
  assertNoteKind,
  createTaggedNote,
  findContainers,
  findOrCreateContainer,
  searchStorageNotes,
  searchVocabularyNotes,
  whenStorageIdle,
} from "../src/modules/timeline/storage";

async function eraseAllPluginItems(libraryID: number): Promise<void> {
  await whenStorageIdle();
  const containers = await findContainers(libraryID, { includeTrashed: true });
  for (const container of containers) {
    await container.reload(["childItems"], true);
    for (const noteID of container.getNotes(true)) {
      const note = (await Zotero.Items.getAsync(noteID)) as Zotero.Item;
      await note.eraseTx();
    }
    await container.eraseTx();
  }
}

describe("storage: telling the two note kinds apart", function () {
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

  /**
   * One container holding all three things a library can put under it: a
   * timeline document, the vocabulary note, and a note the user filed there
   * themselves.
   */
  async function buildMixedContainer(): Promise<{
    storage: Zotero.Item;
    vocabulary: Zotero.Item;
    plain: Zotero.Item;
  }> {
    const storage = await createTaggedNote(
      libraryID,
      STORAGE_TAG,
      "<p>a timeline</p>",
    );
    const vocabulary = await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      "<p>the vocabulary</p>",
    );

    const container = await findOrCreateContainer(libraryID);
    const plain = new Zotero.Item("note");
    plain.libraryID = libraryID;
    plain.parentItemID = container.id;
    plain.setNote("<p>a note the user wrote</p>");
    await plain.saveTx();

    return { storage, vocabulary, plain };
  }

  // AC #2
  it("lists only storage-tagged notes, not the vocabulary note beside them", async function () {
    const { storage } = await buildMixedContainer();

    const found = await searchStorageNotes(libraryID);

    assert.lengthOf(found, 1, "the listing picked up more than the timeline");
    assert.equal(found[0].id, storage.id);
  });

  it("finds the vocabulary note without picking up a timeline", async function () {
    const { vocabulary } = await buildMixedContainer();

    const found = await searchVocabularyNotes(libraryID);

    assert.lengthOf(found, 1);
    assert.equal(found[0].id, vocabulary.id);
  });

  // AC #3, both directions
  it("refuses a vocabulary note handed to the timeline reader", async function () {
    const { vocabulary } = await buildMixedContainer();

    let threw: unknown;
    try {
      assertNoteKind(vocabulary, STORAGE_TAG);
    } catch (err) {
      threw = err;
    }

    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "wrong-kind");
    assert.include(
      (threw as StorageError).message,
      STORAGE_TAG,
      "the refusal does not name the tag it expected",
    );
    assert.include(
      (threw as StorageError).message,
      VOCABULARY_TAG,
      "the refusal does not name the tags the note actually carries",
    );
  });

  it("refuses a timeline note handed to the vocabulary reader", async function () {
    const { storage } = await buildMixedContainer();

    let threw: unknown;
    try {
      assertNoteKind(storage, VOCABULARY_TAG);
    } catch (err) {
      threw = err;
    }

    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "wrong-kind");
  });

  it("refuses an untagged note to either reader", async function () {
    const { plain } = await buildMixedContainer();

    assert.throws(() => assertNoteKind(plain, STORAGE_TAG), StorageError);
    assert.throws(() => assertNoteKind(plain, VOCABULARY_TAG), StorageError);
  });

  it("accepts a note carrying the tag it was asked for", async function () {
    const { storage, vocabulary } = await buildMixedContainer();

    assert.doesNotThrow(() => assertNoteKind(storage, STORAGE_TAG));
    assert.doesNotThrow(() => assertNoteKind(vocabulary, VOCABULARY_TAG));
  });

  // AC #4. Inherited container behaviour rather than anything this task
  // implements: a child note is never offered in the native link picker.
  it("keeps all three notes as child items", async function () {
    const { storage, vocabulary, plain } = await buildMixedContainer();

    for (const note of [storage, vocabulary, plain]) {
      assert.isFalse(note.isTopLevelItem(), `note ${note.id} is top-level`);
    }
  });
});
