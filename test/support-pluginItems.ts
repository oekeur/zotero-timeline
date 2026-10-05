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
  CONTAINER_TAG,
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
  if (containers.length === 0) {
    return;
  }
  // One transaction for every container. Erasing a regular item erases its
  // child notes inside the same transaction (Zotero.Item._eraseData selects
  // them by parentItemID in SQL, so it needs no loaded childItems), and the
  // notifier batches every id the transaction erased into one delete.
  await Zotero.Items.erase(containers.map((container) => container.id));
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

// The container each library's fixture notes last went under, by item id.
// findOrCreateContainer searches the library on every call, about 100 ms, and
// fixture notes are created hundreds of times a run.
const knownContainers = new Map<number, number>();

/**
 * The library's container, reusing the one found last time while it is still
 * a live container. Anything else (erased, trashed, retagged, moved) falls
 * back to findOrCreateContainer, so its refusal to create a replacement next
 * to a trashed container still holds.
 */
async function containerFor(libraryID: number): Promise<Zotero.Item> {
  const knownID = knownContainers.get(libraryID);
  const known =
    knownID === undefined
      ? undefined
      : (Zotero.Items.get(knownID) as Zotero.Item | false);
  if (
    known &&
    !known.deleted &&
    known.libraryID === libraryID &&
    known.hasTag(CONTAINER_TAG)
  ) {
    return known;
  }
  const container = await findOrCreateContainer(libraryID);
  knownContainers.set(libraryID, container.id);
  return container;
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
  const container = await containerFor(libraryID);
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
