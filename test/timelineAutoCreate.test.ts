import { assert } from "chai";
import {
  createTimeline,
  findOrCreateContainer,
  searchStorageNotes,
} from "../src/modules/timeline/storage";
import { eraseAllPluginItems } from "./support-pluginItems";

// Driven through Zotero.ZoteroTimeline.api, the same instance the plugin
// registered, rather than this test bundle's own copy of timelineTab.ts - see
// timelineSidebar.test.ts's top-of-file comment for why that distinction
// matters here.
describe("timeline tab: giving a library with none its first timeline", function () {
  this.timeout(60000);

  let libraryID: number;
  let api: any;

  before(function () {
    libraryID = Zotero.Libraries.userLibraryID;
    api = (Zotero as any).ZoteroTimeline.api;
  });

  beforeEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  afterEach(async function () {
    api.closeTimelineTab();
    await eraseAllPluginItems(libraryID);
  });

  // AC #2
  it("creates one when the library genuinely holds nothing", async function () {
    assert.lengthOf(await searchStorageNotes(libraryID), 0);

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    const notes = await searchStorageNotes(libraryID);
    assert.lengthOf(notes, 1, "no timeline was created for an empty library");
    assert.deepEqual(
      api.getVisibleTimelines().map((t: any) => t.doc.name),
      ["Timeline"],
    );
  });

  // AC #2: opening again must not create a second one.
  it("creates nothing more once the library already has a timeline", async function () {
    await createTimeline("Already here", libraryID);

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    assert.lengthOf(await searchStorageNotes(libraryID), 1);
  });

  // AC #3
  it("warns and creates nothing when the container is only in the trash", async function () {
    await createTimeline("Hidden", libraryID);
    const container = await findOrCreateContainer(libraryID);
    container.deleted = true;
    await container.saveTx();

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    assert.lengthOf(
      await searchStorageNotes(libraryID, { includeTrashed: true }),
      1,
      "a replacement timeline was created over trashed data",
    );
    assert.lengthOf(await searchStorageNotes(libraryID), 0);
  });

  // AC #3
  it("warns and creates nothing when a storage note is only in the trash", async function () {
    const { item } = await createTimeline("Hidden", libraryID);
    item.deleted = true;
    await item.saveTx();

    await api.openTimelineTab();
    await Zotero.Promise.delay(1500);

    assert.lengthOf(
      await searchStorageNotes(libraryID, { includeTrashed: true }),
      1,
      "a replacement timeline was created over trashed data",
    );
    assert.lengthOf(await searchStorageNotes(libraryID), 0);
  });
});
