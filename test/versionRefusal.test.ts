import { assert } from "chai";
import { CURRENT_SCHEMA_VERSION } from "../src/modules/timeline/schema";
import {
  STORAGE_TAG,
  StorageError,
  listTimelines,
  readDocumentFromNote,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

function documentAtVersion(version: number, name: string, id: string) {
  return { ...documentNamed(name, id), version };
}

describe("storage: refusing a document from a newer plugin", function () {
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

  // AC #1 and AC #3 together, which is the pairing that matters: a refusal
  // implemented as a throw from the list path would pass the first and fail
  // the second.
  it("refuses the newer document and lists every other timeline in the library", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentAtVersion(CURRENT_SCHEMA_VERSION, "Readable", "tl-1"),
    );
    const future = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentAtVersion(CURRENT_SCHEMA_VERSION + 1, "From the future", "tl-2"),
    );

    const { timelines, unreadable } = await listTimelines(libraryID);

    assert.lengthOf(timelines, 1, "the refusal took the readable one with it");
    assert.equal(timelines[0].doc.name, "Readable");
    assert.lengthOf(unreadable, 1);
    assert.equal(unreadable[0].noteItemID, future.id);
    assert.equal(unreadable[0].reason, "version-unsupported");
  });

  // AC #2
  it("names both versions on the unreadable entry", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentAtVersion(CURRENT_SCHEMA_VERSION + 1, "From the future", "tl-2"),
    );

    const { unreadable } = await listTimelines(libraryID);

    assert.lengthOf(unreadable, 1);
    assert.equal(unreadable[0].documentVersion, CURRENT_SCHEMA_VERSION + 1);
    assert.equal(unreadable[0].knownVersion, CURRENT_SCHEMA_VERSION);
  });

  it("refuses before checking the shape, so the report names the real problem", async function () {
    await createDocumentNote(libraryID, STORAGE_TAG, {
      version: CURRENT_SCHEMA_VERSION + 1,
      events: "not an array at all",
    });

    const { unreadable } = await listTimelines(libraryID);

    assert.equal(unreadable[0].reason, "version-unsupported");
    assert.notInclude(unreadable[0].message, "events");
  });

  // AC #5
  it("reads a document at the known version normally", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentAtVersion(CURRENT_SCHEMA_VERSION, "Current", "tl-1"),
    );

    await note.reload(["note"], true);

    assert.equal(readDocumentFromNote(note).doc.name, "Current");
  });

  it("throws a typed refusal when the note is read directly", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentAtVersion(CURRENT_SCHEMA_VERSION + 1, "From the future", "tl-2"),
    );
    await note.reload(["note"], true);

    let threw: unknown;
    try {
      readDocumentFromNote(note);
    } catch (err) {
      threw = err;
    }

    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "version-unsupported");
    assert.equal(
      (threw as StorageError).documentVersion,
      CURRENT_SCHEMA_VERSION + 1,
    );
    assert.equal((threw as StorageError).knownVersion, CURRENT_SCHEMA_VERSION);
  });
});
