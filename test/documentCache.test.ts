/**
 * The test bundle holds its own copy of every src/ module, so these specs get
 * the test bundle's cache map and the running plugin's notifier never touches
 * it. A test written as "the plugin invalidated its cache" would assert
 * nothing and stay green through a real regression. Every test here therefore
 * drives the observer itself, from this bundle, and asserts against the map it
 * can see.
 */
import { assert } from "chai";
import {
  cacheObserverForTesting,
  clearCache,
  listTimelinesCached,
  matchesCached,
  parsesSoFar,
} from "../src/modules/timeline/documentCache";
import {
  STORAGE_TAG,
  updateTimelineDocument,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("storage: the parsed-document cache", function () {
  this.timeout(60000);

  let libraryID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    clearCache();
  });

  afterEach(async function () {
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
    clearCache();
  });

  // AC #1
  it("parses nothing on a second read of an unchanged library", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("B", "tl-b"),
    );

    const before = parsesSoFar();
    const first = await listTimelinesCached(libraryID);
    const afterFirst = parsesSoFar();
    const second = await listTimelinesCached(libraryID);
    const afterSecond = parsesSoFar();

    assert.lengthOf(first.timelines, 2);
    assert.lengthOf(second.timelines, 2);
    assert.equal(afterFirst - before, 2, "the first read did not parse both");
    assert.equal(afterSecond - afterFirst, 0, "the second read parsed again");
  });

  // AC #2
  it("invalidates only the notified note", async function () {
    const noteA = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    const noteB = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("B", "tl-b"),
    );
    await listTimelinesCached(libraryID);

    cacheObserverForTesting.notify("modify", "item", [noteA.id]);

    const before = parsesSoFar();
    await listTimelinesCached(libraryID);
    assert.equal(
      parsesSoFar() - before,
      1,
      "invalidating one note re-parsed a different number of them",
    );

    // B is still cached, so a second pass parses nothing at all.
    const beforeSecond = parsesSoFar();
    await listTimelinesCached(libraryID);
    assert.equal(parsesSoFar() - beforeSecond, 0);
    assert.isNumber(noteB.id);
  });

  it("does not clear the whole map when an unrelated item changes", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    await listTimelinesCached(libraryID);

    // An id that is not a plugin note at all.
    cacheObserverForTesting.notify("modify", "item", [999999]);

    const before = parsesSoFar();
    await listTimelinesCached(libraryID);
    assert.equal(
      parsesSoFar() - before,
      0,
      "an unrelated modify emptied the cache",
    );
  });

  it("ignores events that are not a modify of an item", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    const listed = await listTimelinesCached(libraryID);
    const noteID = listed.timelines[0].noteItemID;

    cacheObserverForTesting.notify("trash", "item", [noteID]);
    cacheObserverForTesting.notify("modify", "collection", [noteID]);

    const before = parsesSoFar();
    await listTimelinesCached(libraryID);
    assert.equal(parsesSoFar() - before, 0);
  });

  // AC #3
  it("reflects a note erased or added while the cache is warm", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    await listTimelinesCached(libraryID);

    await note.eraseTx();
    assert.isEmpty(
      (await listTimelinesCached(libraryID)).timelines,
      "an erased note was still listed from the cache",
    );

    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("C", "tl-c"),
    );
    const after = await listTimelinesCached(libraryID);
    assert.lengthOf(after.timelines, 1);
    assert.equal(after.timelines[0].doc.id, "tl-c");
  });

  // The cache must not hand back the pre-write document after its own write.
  it("returns the new document after a write, not the one it had cached", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    await listTimelinesCached(libraryID);

    await updateTimelineDocument(
      (doc) => ({ ...doc, name: "A, edited" }),
      "tl-a",
      libraryID,
    );
    cacheObserverForTesting.notify("modify", "item", [note.id]);

    const { timelines } = await listTimelinesCached(libraryID);
    assert.equal(timelines[0].doc.name, "A, edited");
  });

  // Content identity is what a consumer uses to tell its own write's echo from
  // someone else's edit, because modify fires twice per save and a boolean
  // guard cannot cover the second.
  it("recognises a document byte-identical to the cached one", async function () {
    await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("A", "tl-a"),
    );
    const { timelines } = await listTimelinesCached(libraryID);
    const { noteItemID, doc } = timelines[0];

    assert.isTrue(matchesCached(noteItemID, doc));
    assert.isFalse(matchesCached(noteItemID, { ...doc, name: "changed" }));
  });

  it("reports a miss for a note it has never seen", function () {
    assert.isFalse(matchesCached(123456, documentNamed("A", "tl-a")));
  });
});
