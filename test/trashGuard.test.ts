import { assert } from "chai";
import {
  observerForTesting,
  trashWarningFor,
} from "../src/modules/timeline/containerGuard";
import {
  STORAGE_TAG,
  createTaggedNote,
  findOrCreateContainer,
  listTimelines,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  createDocumentNote,
  documentNamed,
  eraseAllPluginItems,
} from "./support-pluginItems";

describe("storage: warning when plugin data is trashed", function () {
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

  // AC #2 and AC #3: name the timeline, and say how to undo it.
  it("names the trashed timeline and says how to get it back", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Abolition"),
    );
    note.deleted = true;
    await note.saveTx();

    const warning = await trashWarningFor([note.id]);

    assert.isNotNull(warning);
    assert.equal(warning?.key, "timeline-trashed-now");
    assert.equal(
      warning?.key === "timeline-trashed-now" ? warning.name : null,
      "Abolition",
    );
  });

  // AC #1
  it("warns about the container rather than the notes when the container goes", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Abolition"),
    );
    const container = await findOrCreateContainer(libraryID);
    container.deleted = true;
    await container.saveTx();
    note.deleted = true;
    await note.saveTx();

    // Both in one batch, note first, to prove the ordering rule holds rather
    // than depending on which id the notifier happens to hand over first.
    const warning = await trashWarningFor([note.id, container.id]);

    assert.equal(warning?.key, "container-trashed-now");
  });

  it("falls back to a generic message when the trashed note will not parse", async function () {
    const note = await createTaggedNote(
      libraryID,
      STORAGE_TAG,
      "<p>note</p><pre>{not json</pre>",
    );
    note.deleted = true;
    await note.saveTx();

    const warning = await trashWarningFor([note.id]);

    assert.equal(
      warning?.key,
      "timeline-trashed-now-unnamed",
      "an unparseable document should not block the warning",
    );
  });

  // The same trash event fires on restore; the deleted flag separates them.
  it("says nothing when an item is taken back out of the trash", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Abolition"),
    );
    note.deleted = true;
    await note.saveTx();
    note.deleted = false;
    await note.saveTx();

    assert.isNull(await trashWarningFor([note.id]));
  });

  it("says nothing about an item that is not the plugin's", async function () {
    const container = await findOrCreateContainer(libraryID);
    const plain = new Zotero.Item("note");
    plain.libraryID = libraryID;
    plain.parentItemID = container.id;
    plain.setNote("<p>the user's own note</p>");
    await plain.saveTx();
    plain.deleted = true;
    await plain.saveTx();

    assert.isNull(await trashWarningFor([plain.id]));
  });

  // AC #4: nothing to implement, so it is asserted rather than built for.
  it("lists the timeline again once it is restored", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Abolition"),
    );

    note.deleted = true;
    await note.saveTx();
    assert.isEmpty((await listTimelines(libraryID)).timelines);

    note.deleted = false;
    await note.saveTx();
    assert.lengthOf((await listTimelines(libraryID)).timelines, 1);
  });

  // AC #5, and the most expensive mistake available in m-1: an observer that
  // awaits a queued write wedges every write for the session, with no error
  // and nothing in the log. Written the wrong way, this test hangs, which is
  // exactly the production symptom.
  it("returns void from notify and leaves the write queue draining", async function () {
    const note = await createDocumentNote(
      libraryID,
      STORAGE_TAG,
      documentNamed("Abolition"),
    );
    note.deleted = true;
    await note.saveTx();

    const returned = observerForTesting.notify("trash", "item", [note.id]);
    assert.isUndefined(returned, "the observer returned a promise");

    await createTaggedNote(libraryID, STORAGE_TAG, "<p>a later write</p>");
    await whenStorageIdle();

    assert.isAbove((await listTimelines(libraryID)).unreadable.length, 0);
  });

  it("ignores every event that is not a trash of an item", function () {
    assert.isUndefined(
      observerForTesting.notify("modify", "item", [1]),
      "a modify event was not filtered out",
    );
    assert.isUndefined(observerForTesting.notify("trash", "collection", [1]));
  });
});
