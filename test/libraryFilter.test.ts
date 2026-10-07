import { assert } from "chai";
import {
  CONTAINER_TAG,
  STORAGE_TAG,
  VOCABULARY_TAG,
  createTaggedNote,
  findOrCreateContainer,
  whenStorageIdle,
} from "../src/modules/timeline/storage";
import {
  registerLibraryFilter,
  unregisterLibraryFilter,
} from "../src/modules/timeline/libraryFilter";
import { eraseAllPluginItems } from "./support-pluginItems";
import { waitFor } from "./waitFor";

type Proto = { getSearchObject: unknown };

function collectionTreeRowPrototype(): Proto {
  return (Zotero as unknown as { CollectionTreeRow: { prototype: Proto } })
    .CollectionTreeRow.prototype;
}

/**
 * The ids a search scoped like a library row returns, with the plugin's tags
 * excluded exactly as the filter excludes them.
 */
async function idsExcluding(
  libraryID: number,
  tags: string[],
): Promise<number[]> {
  const base = new Zotero.Search();
  base.addCondition("libraryID", "is", libraryID);
  base.addCondition("noChildren", "false");
  const filtered = new Zotero.Search();
  filtered.addCondition("libraryID", "is", libraryID);
  for (const tag of tags) {
    filtered.addCondition("tag", "isNot", tag);
  }
  filtered.setScope(base, false);
  return filtered.search();
}

describe("storage: hiding the plugin's items from the item tree", function () {
  this.timeout(60000);

  let libraryID: number;
  let containerID: number;
  let noteID: number;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
  });

  beforeEach(async function () {
    await eraseAllPluginItems(libraryID);
    const note = await createTaggedNote(
      libraryID,
      STORAGE_TAG,
      "<p>a timeline</p>",
    );
    noteID = note.id;
    containerID = (await findOrCreateContainer(libraryID)).id;
  });

  afterEach(async function () {
    await whenStorageIdle();
    await eraseAllPluginItems(libraryID);
  });

  // AC #2. The reason all three conditions exist, pinned by a test rather than
  // left to a comment: excluding the container alone puts it straight back,
  // because a library row's search matches child items and the tree re-creates
  // a parent row for a matching child.
  it("needs the note tags excluded as well as the container tag", async function () {
    const containerOnly = await idsExcluding(libraryID, [CONTAINER_TAG]);
    assert.include(
      containerOnly,
      noteID,
      "excluding the container tag alone already dropped the note",
    );

    const allThree = await idsExcluding(libraryID, [
      CONTAINER_TAG,
      STORAGE_TAG,
      VOCABULARY_TAG,
    ]);
    assert.notInclude(allThree, noteID);
    assert.notInclude(allThree, containerID);
  });

  it("hides the vocabulary note too", async function () {
    const vocabulary = await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      "<p>vocabulary</p>",
    );

    const ids = await idsExcluding(libraryID, [
      CONTAINER_TAG,
      STORAGE_TAG,
      VOCABULARY_TAG,
    ]);

    assert.notInclude(ids, vocabulary.id);
  });

  // Zotero's item tree adds a restored item's row straight from the modify
  // notification, without running the patched search, so this drives the
  // live plugin's observer through the real tree rather than a search object.
  // The plain item is the positive control: it proves the tree in this window
  // does react to a restore, so the container's absence is not a dead view.
  it("keeps a container restored from the trash out of the item tree", async function () {
    const win = Zotero.getMainWindow() as any;
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.collectionsView.selectLibrary(libraryID);
    await win.ZoteroPane.itemsView.refreshAndMaintainSelection();

    const control = new Zotero.Item("document");
    control.libraryID = libraryID;
    control.setField("title", "library filter restore control");
    await control.saveTx();
    const container = (await Zotero.Items.getAsync(containerID)) as Zotero.Item;
    try {
      const inTree = (id: number) =>
        win.ZoteroPane.itemsView.getRowIndexByID(id) !== false;
      await waitFor(
        () => inTree(control.id) || undefined,
        "the control item to show in My Library",
      );

      for (const item of [control, container]) {
        item.deleted = true;
        await item.saveTx();
      }
      await waitFor(
        () => !inTree(control.id) || undefined,
        "the trashed control item to leave My Library",
      );
      for (const item of [control, container]) {
        item.deleted = false;
        await item.saveTx();
      }

      await waitFor(
        () => inTree(control.id) || undefined,
        "the restored control item to come back to My Library",
      );
      // An absence has no condition to poll; give the refresh the same
      // second the unfixed tree needed to show the container.
      await Zotero.Promise.delay(1000);
      assert.isFalse(
        inTree(containerID),
        "the restored container is in My Library with hideTimelineNotes on",
      );
    } finally {
      await control.eraseTx();
    }
  });

  // AC #5
  it("puts Zotero's own method back when it unregisters", function () {
    const proto = collectionTreeRowPrototype();
    const before = proto.getSearchObject;

    registerLibraryFilter();
    assert.notEqual(
      proto.getSearchObject,
      before,
      "registering did not patch anything",
    );

    unregisterLibraryFilter();
    assert.equal(
      proto.getSearchObject,
      before,
      "unregistering left the patch in place, so the next load would stack on it",
    );
  });

  it("does not stack a second patch on the first", function () {
    const proto = collectionTreeRowPrototype();
    const before = proto.getSearchObject;

    registerLibraryFilter();
    const firstPatch = proto.getSearchObject;
    registerLibraryFilter();
    assert.equal(
      proto.getSearchObject,
      firstPatch,
      "a second register replaced the patch instead of being a no-op",
    );

    unregisterLibraryFilter();
    assert.equal(proto.getSearchObject, before);
  });

  // AC #6
  it("fails open when the patched method throws", async function () {
    const proto = collectionTreeRowPrototype();
    const before = proto.getSearchObject;
    const sentinel = new Zotero.Search();

    // A getSearchObject that resolves, so the call-through succeeds and the
    // wrap is what breaks: a row with no usable ref.
    proto.getSearchObject = async function () {
      return sentinel;
    };
    registerLibraryFilter();

    const patched = proto.getSearchObject as (
      this: unknown,
      options?: { unfiltered?: boolean },
    ) => Promise<Zotero.Search>;
    const brokenRow = {
      isTrash: () => false,
      isFeed: () => false,
      ref: null,
    };

    const result = await patched.call(brokenRow);
    assert.equal(
      result,
      sentinel,
      "a row the wrap cannot handle should fall back to the original result",
    );

    unregisterLibraryFilter();
    proto.getSearchObject = before;
  });

  // AC #3
  it("leaves the trash view unfiltered, so trashed plugin data stays recoverable", async function () {
    const proto = collectionTreeRowPrototype();
    const before = proto.getSearchObject;
    const sentinel = new Zotero.Search();
    proto.getSearchObject = async function () {
      return sentinel;
    };
    registerLibraryFilter();

    const patched = proto.getSearchObject as (
      this: unknown,
      options?: { unfiltered?: boolean },
    ) => Promise<Zotero.Search>;
    const trashRow = {
      isTrash: () => true,
      isFeed: () => false,
      ref: { libraryID },
    };

    assert.equal(
      await patched.call(trashRow),
      sentinel,
      "the trash view was scoped, which would empty it of recoverable items",
    );

    unregisterLibraryFilter();
    proto.getSearchObject = before;
  });

  it("honours the unfiltered option Zotero passes", async function () {
    const proto = collectionTreeRowPrototype();
    const before = proto.getSearchObject;
    const sentinel = new Zotero.Search();
    proto.getSearchObject = async function () {
      return sentinel;
    };
    registerLibraryFilter();

    const patched = proto.getSearchObject as (
      this: unknown,
      options?: { unfiltered?: boolean },
    ) => Promise<Zotero.Search>;
    const row = {
      isTrash: () => false,
      isFeed: () => false,
      ref: { libraryID },
    };

    assert.equal(await patched.call(row, { unfiltered: true }), sentinel);

    unregisterLibraryFilter();
    proto.getSearchObject = before;
  });
});
