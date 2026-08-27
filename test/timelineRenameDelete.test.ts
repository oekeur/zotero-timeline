import { assert } from "chai";
import {
  StorageError,
  STORAGE_TAG,
  deleteTimeline,
  readDocumentFromNote,
  refreshNote,
  renameTimeline,
  searchStorageNotes,
} from "../src/modules/timeline/storage";
import {
  canvasFixtureDocuments,
  createDocumentNote,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("storage: renaming and deleting a timeline", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    for (const document of canvasFixtureDocuments()) {
      await createDocumentNote(libraryID, STORAGE_TAG, document);
    }
  });

  afterEach(async function () {
    await eraseAllPluginItems(libraryID);
  });

  async function noteFor(documentId: string): Promise<Zotero.Item> {
    for (const note of await searchStorageNotes(libraryID)) {
      if (readDocumentFromNote(note).doc.id === documentId) {
        return note;
      }
    }
    throw new Error(`no storage note for ${documentId}`);
  }

  // AC #1
  it("writes name and leaves id, version and events untouched", async function () {
    const updated = await renameTimeline(
      "doc-revolt",
      libraryID,
      "The Eighty Years' War",
    );
    assert.equal(updated.name, "The Eighty Years' War");
    assert.equal(updated.id, "doc-revolt");

    const note = await noteFor("doc-revolt");
    await refreshNote(note);
    const { doc } = readDocumentFromNote(note);
    assert.equal(doc.name, "The Eighty Years' War");
    assert.equal(doc.id, "doc-revolt");
    assert.equal(doc.version, updated.version);
    assert.deepEqual(
      doc.events.map((e) => e.id),
      ["ev-fury", "ev-utrecht"],
    );
  });

  // AC #2
  it("refuses an empty or whitespace name before the write", async function () {
    let threw: unknown;
    try {
      await renameTimeline("doc-revolt", libraryID, "   ");
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "invalid-schema");

    const note = await noteFor("doc-revolt");
    const { doc } = readDocumentFromNote(note);
    assert.equal(doc.name, "Dutch Revolt", "the refused rename still wrote");
  });

  it("moves the storage note to the trash rather than erasing it", async function () {
    const noteID = (await noteFor("doc-revolt")).id;

    await deleteTimeline("doc-revolt", libraryID);

    assert.lengthOf(await searchStorageNotes(libraryID), 1);
    const stillThere = (
      await searchStorageNotes(libraryID, { includeTrashed: true })
    ).find((item) => item.id === noteID);
    assert.ok(stillThere, "the note was erased rather than trashed");
    assert.isTrue(stillThere!.deleted);
  });

  it("refuses a library the user cannot write", async function () {
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
      let renameThrew: unknown;
      try {
        await renameTimeline("doc-revolt", unwritableLibraryID, "New Name");
      } catch (err) {
        renameThrew = err;
      }
      assert.instanceOf(renameThrew, StorageError);
      assert.equal((renameThrew as StorageError).reason, "not-writable");

      let deleteThrew: unknown;
      try {
        await deleteTimeline("doc-revolt", unwritableLibraryID);
      } catch (err) {
        deleteThrew = err;
      }
      assert.instanceOf(deleteThrew, StorageError);
      assert.equal((deleteThrew as StorageError).reason, "not-writable");
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });

  it("throws not-found for a document id with no storage note", async function () {
    let threw: unknown;
    try {
      await deleteTimeline("no-such-document", libraryID);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "not-found");
  });
});
