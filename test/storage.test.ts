import { assert } from "chai";
import {
  CONTAINER_TAG,
  StorageError,
  createTaggedNote,
  findContainers,
  findOrCreateContainer,
  whenStorageIdle,
} from "../src/modules/timeline/storage";

// A tag of this task's own, so the fixtures these tests create are told apart
// from the storage and vocabulary tags TASK-6 adds.
const TEST_TAG = "_zoterotimeline-test-note";

/**
 * Erases every plugin item this suite could have left behind, container and
 * notes alike, and permanently: trashing would leave the library in exactly
 * the state findOrCreateContainer refuses to create a replacement for, and the
 * next test would then fail on a container-trashed throw rather than on what
 * it was asserting.
 */
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

describe("storage: the per-library container", function () {
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
  it("creates no container until a write needs one", async function () {
    assert.lengthOf(
      await findContainers(libraryID),
      0,
      "the library started with a container before anything was written",
    );

    await createTaggedNote(libraryID, TEST_TAG, "<p>first write</p>");

    assert.lengthOf(await findContainers(libraryID), 1);
  });

  // AC #2
  it("tags the container and parents every plugin note to it", async function () {
    const note = await createTaggedNote(libraryID, TEST_TAG, "<p>note</p>");
    const [container] = await findContainers(libraryID);

    assert.ok(container, "no container was created");
    assert.include(
      container.getTags().map((t) => t.tag),
      CONTAINER_TAG,
      "the container does not carry the container tag",
    );
    assert.equal(note.parentItemID, container.id);
    assert.include(
      note.getTags().map((t) => t.tag),
      TEST_TAG,
      "the note was created without its tag",
    );
  });

  // AC #3. A child note is never offered in Zotero's native link picker, and
  // never renders as a top-level row, because the searches behind both add
  // noChildren. So this is the property the plugin relies on, asserted here
  // rather than anything patched.
  it("creates the note as a child item, never a top-level row", async function () {
    const note = await createTaggedNote(libraryID, TEST_TAG, "<p>note</p>");

    assert.isFalse(note.isTopLevelItem(), "the note is a top-level item");
    assert.isNumber(note.parentItemID);
  });

  // AC #4
  it("does not create a second container under concurrent first writes", async function () {
    const first = createTaggedNote(libraryID, TEST_TAG, "<p>one</p>");
    const second = createTaggedNote(libraryID, TEST_TAG, "<p>two</p>");
    await Promise.all([first, second]);

    assert.lengthOf(
      await findContainers(libraryID),
      1,
      "two concurrent first writes each created a container",
    );
  });

  // Step 7 of the plan, and the check that proves addCondition("includeDeleted")
  // behaves as zotero-types claims: a replacement container would take every
  // future write while the real timelines sat in the trash.
  it("refuses to replace a container that is only trashed", async function () {
    const note = await createTaggedNote(libraryID, TEST_TAG, "<p>note</p>");
    const [container] = await findContainers(libraryID);
    assert.ok(container);

    container.deleted = true;
    await container.saveTx();

    assert.lengthOf(
      await findContainers(libraryID),
      0,
      "a trashed container still came back from a live search",
    );
    assert.lengthOf(
      await findContainers(libraryID, { includeTrashed: true }),
      1,
      "includeDeleted did not return the trashed container",
    );

    let threw: unknown;
    try {
      await findOrCreateContainer(libraryID);
    } catch (err) {
      threw = err;
    }

    assert.instanceOf(threw, StorageError);
    assert.equal((threw as StorageError).reason, "container-trashed");

    // The note went down with its parent rather than being flagged itself,
    // which is why one trash action hides every document at once.
    assert.isFalse(note.deleted, "the child note was flagged deleted");
  });
});
