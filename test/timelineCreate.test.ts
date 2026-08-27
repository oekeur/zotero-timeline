import { assert } from "chai";
import {
  StorageError,
  STORAGE_TAG,
  createTimeline,
  findContainers,
  findOrCreateContainer,
  hasHiddenTimelineData,
  readDocumentFromNote,
  refreshNote,
  searchStorageNotes,
} from "../src/modules/timeline/storage";
import { eraseAllPluginItems } from "./support-pluginItems";

describe("storage: creating a timeline", function () {
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

  // AC #1
  it("writes a note under the container with a fresh id and the given name", async function () {
    const { item, doc } = await createTimeline("Test Timeline", libraryID);

    assert.equal(doc.name, "Test Timeline");
    assert.isNotEmpty(doc.id);
    assert.deepEqual(doc.events, []);
    assert.isTrue(item.hasTag(STORAGE_TAG));

    const [container] = await findContainers(libraryID);
    assert.equal(item.parentItemID, container.id);

    await refreshNote(item);
    const read = readDocumentFromNote(item);
    assert.equal(read.doc.id, doc.id);
    assert.equal(read.doc.name, "Test Timeline");
  });

  it("mints a different id on every call", async function () {
    const first = await createTimeline("One", libraryID);
    const second = await createTimeline("Two", libraryID);
    assert.notEqual(first.doc.id, second.doc.id);
  });

  // AC #5
  it("refuses an empty or whitespace name before writing", async function () {
    let threw: unknown;
    try {
      await createTimeline("   ", libraryID);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "invalid-schema");
    assert.lengthOf(await searchStorageNotes(libraryID), 0);
  });

  // AC #7
  it("refuses a library the user cannot write, before it ever reaches saveTx", async function () {
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
      let threw: unknown;
      try {
        await createTimeline("Name", unwritableLibraryID);
      } catch (err) {
        threw = err;
      }
      assert.instanceOf(threw, StorageError);
      assert.match((threw as StorageError).message, /not writable/);
      assert.lengthOf(await searchStorageNotes(unwritableLibraryID), 0);
    } finally {
      Zotero.Libraries.get = originalGet;
    }
  });

  // AC #4: the container can land in the trash between an earlier check and
  // this write; this is the refusal timelineTab.ts's createTimelineOrWarn
  // catches rather than letting escape.
  it("throws container-trashed rather than creating a replacement container", async function () {
    await createTimeline("Existing", libraryID);
    const container = await findOrCreateContainer(libraryID);
    container.deleted = true;
    await container.saveTx();

    let threw: unknown;
    try {
      await createTimeline("New", libraryID);
    } catch (err) {
      threw = err;
    }
    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "container-trashed");
  });

  it("is false for a library that genuinely holds nothing", async function () {
    assert.isFalse(await hasHiddenTimelineData(libraryID));
  });

  it("is false when every timeline is live and readable", async function () {
    await createTimeline("Visible", libraryID);
    assert.isFalse(await hasHiddenTimelineData(libraryID));
  });

  it("hasHiddenTimelineData is true when a storage note is trashed but its container is not", async function () {
    const { item } = await createTimeline("Trashed", libraryID);
    item.deleted = true;
    await item.saveTx();

    assert.isTrue(await hasHiddenTimelineData(libraryID));
  });

  it("hasHiddenTimelineData is true when the container itself is trashed, taking its notes with it", async function () {
    await createTimeline("Down with its container", libraryID);
    const container = await findOrCreateContainer(libraryID);
    container.deleted = true;
    await container.saveTx();

    assert.isTrue(await hasHiddenTimelineData(libraryID));
  });
});
