/**
 * Fixture teardown shared by the storage specs. Not a spec itself: the
 * scaffold bundles every file under test/ as its own entry, so this one simply
 * contributes no tests.
 */
import {
  CURRENT_SCHEMA_VERSION,
  type TimelineDocument,
} from "../src/modules/timeline/schema";
import {
  buildNoteHtml,
  findContainers,
  findOrCreateContainer,
  whenStorageIdle,
} from "../src/modules/timeline/storage";

/**
 * Erases every plugin item in the library, container and notes alike, and
 * permanently.
 *
 * Erasing rather than trashing on purpose: a trashed container is exactly the
 * state findOrCreateContainer refuses to replace, so a suite that trashed its
 * fixtures would leave the next test failing on a container-trashed throw
 * rather than on what it meant to assert.
 */
export async function eraseAllPluginItems(libraryID: number): Promise<void> {
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

export function documentNamed(name: string, id = "tl-1"): TimelineDocument {
  return {
    version: CURRENT_SCHEMA_VERSION,
    id,
    name,
    events: [
      {
        id: "e-1",
        title: "Emancipation",
        date: "1863-07-01",
        sources: [],
        tags: [],
      },
    ],
  };
}

/**
 * The two documents the frozen rendering-spike fixture used to hardcode,
 * reproduced as real stored documents. Several live-Zotero specs assert exact
 * ids, titles and counts against these (four events, two documents), so the
 * ids and dates here must stay byte-identical to what they seed.
 */
export function canvasFixtureDocuments(): TimelineDocument[] {
  return [
    {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-revolt",
      name: "Dutch Revolt",
      events: [
        {
          id: "ev-fury",
          title: "Iconoclastic Fury",
          date: "1566",
          sources: [],
          tags: [],
        },
        {
          id: "ev-utrecht",
          title: "Union of Utrecht",
          date: "1579-01-23",
          sources: [],
          tags: [],
        },
      ],
    },
    {
      version: CURRENT_SCHEMA_VERSION,
      id: "doc-sources",
      name: "Source production",
      events: [
        {
          id: "ev-pamphlets",
          title: "Pamphlet campaign",
          date: "1580~",
          sources: [],
          tags: [],
        },
        {
          id: "ev-truce",
          title: "Truce negotiations",
          date: "1607-04/1609-04",
          sources: [],
          tags: [],
        },
      ],
    },
  ];
}

/**
 * Creates a note under the container whose FIRST EVER save carries `html`.
 *
 * This is the only safe way to build a malformed fixture. Re-saving an
 * existing note under new HTML silently discards the change: getNote() hands
 * back the old text and the save reports success.
 */
export async function createRawNote(
  libraryID: number,
  tag: string,
  html: string,
): Promise<Zotero.Item> {
  const container = await findOrCreateContainer(libraryID);
  const item = new Zotero.Item("note");
  item.libraryID = libraryID;
  item.parentItemID = container.id;
  item.setNote(html);
  item.addTag(tag);
  await item.saveTx();
  return item;
}

/** A storage note holding a document at an arbitrary version, valid or not. */
export async function createDocumentNote(
  libraryID: number,
  tag: string,
  doc: TimelineDocument | Record<string, unknown>,
): Promise<Zotero.Item> {
  return createRawNote(libraryID, tag, buildNoteHtml(doc as TimelineDocument));
}
