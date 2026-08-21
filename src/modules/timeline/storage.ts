/**
 * Everything the plugin stores lives in Zotero note items, and every one of
 * those notes hangs off a single container item per library. This module owns
 * the container and the write queue the rest of the storage layer is built on.
 *
 * Notes are found by tag rather than by content-sniffing, so a corrupted one
 * is still findable and still distinguishable from "no note yet".
 */

/**
 * Marks the one item per library that every plugin note hangs off. Zotero's
 * library and collection views add `noChildren` to the search behind their
 * rows, so a child note never renders as a top-level row - which is what
 * collapses any number of plugin notes into a single visible entry, using
 * Zotero's own view behaviour rather than a patched internal. It is also what
 * keeps those notes out of Zotero's native link picker.
 *
 * The container is found by this tag rather than recorded in a preference: a
 * pref is device-local, and every synced device has to arrive at the same
 * container from library data alone. The leading underscore hides the tag from
 * Zotero's tag selector.
 *
 * The leading underscore on all three tags hides them from Zotero's tag
 * selector.
 *
 * The `-v1` suffix on all three versions the CARRIER convention: which item
 * kind holds the JSON and how it is wrapped. It does not version the document
 * schema and does not move when CURRENT_SCHEMA_VERSION does. If it did, a v2
 * document would go invisible to a v1 reader instead of being listed and
 * refused, which is exactly the guarantee the version check exists to make.
 */
export const CONTAINER_TAG = "_zoterotimeline-container-v1";

/**
 * On every note holding one timeline document. Listing a library's timelines
 * filters on this tag, which is why the container carries a different one: a
 * container sharing it would list as a timeline.
 */
export const STORAGE_TAG = "_zoterotimeline-storage-v1";

/** On the one note holding a library's link-type vocabulary. */
export const VOCABULARY_TAG = "_zoterotimeline-vocabulary-v1";

// Stored, synced data rather than UI text, so it stays untranslated - two
// devices in different locales must still recognise the same item. Reading it
// from addon.data at module scope would throw at bundle evaluation and break
// startup with nothing but "Plugin awaiting timeout" to show for it.
const CONTAINER_TITLE = "Zotero Timeline (plugin data)";

/**
 * Every way the storage layer can refuse to hand back a document, named once
 * here so later readers do not each widen the set.
 *
 * `version-unsupported` and `wrong-kind` exist because "a document written by
 * a newer plugin" and "a vocabulary note handed to the timeline reader" both
 * have to be distinguishable from ordinary invalid JSON at the call site: the
 * first must never be repaired, and the second must never be overwritten.
 */
export type StorageErrorReason =
  | "block-missing"
  | "parse-failed"
  | "invalid-schema"
  | "version-unsupported"
  | "wrong-kind"
  | "not-found"
  | "container-trashed";

export class StorageError extends Error {
  reason: StorageErrorReason;

  constructor(reason: StorageErrorReason, message: string) {
    super(message);
    this.name = "StorageError";
    this.reason = reason;
  }
}

// Every storage write is serialised through one module-level queue. A notifier
// callback can start a write while a foreground operation is mid-cycle, so two
// read-modify-write cycles can overlap with no user race involved at all, and
// the later write would be built on a document read before the earlier one
// landed.
//
// The queue is not reentrant, and cannot be made so without the async context
// tracking Zotero's sandbox does not provide. A queued task ends in saveTx(),
// and Zotero awaits every notifier observer inside that transaction's commit,
// so an observer that awaits a queued write parks that write behind the task
// waiting on the observer: neither ever settles, and every later write in the
// session hangs silently. A notifier observer must therefore never await a
// queued write - it returns void and starts the work detached. Anything called
// from inside a queued task uses the plain search helpers, never another
// queued function.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  // Each task chains off the previous one's settlement, not its value, so one
  // failing task doesn't wedge the queue for everything behind it.
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Resolves once every queued storage operation has settled. Tests need this: a
 * write triggered by a Zotero notifier is not awaited by whatever caused the
 * notification, so without it that write lands in the middle of a later test.
 */
export async function whenStorageIdle(): Promise<void> {
  await queue;
}

/**
 * The plugin's container items in a library, lowest key first.
 *
 * Ordered by key rather than item id because ids are local to one device: when
 * two devices each created a container before syncing, only the key gives both
 * of them the same answer about which one wins.
 */
export async function findContainers(
  libraryID: number,
  { includeTrashed = false } = {},
): Promise<Zotero.Item[]> {
  const search = new Zotero.Search();
  search.addCondition("libraryID", "is", libraryID);
  search.addCondition("tag", "is", CONTAINER_TAG);
  if (includeTrashed) {
    search.addCondition("includeDeleted", "true");
  }
  const ids = await search.search();
  if (ids.length === 0) {
    return [];
  }
  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  return [...items].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}

/**
 * Every note in a library carrying the timeline-document tag, lowest item id
 * first.
 *
 * Searches the whole library by tag rather than walking the container's
 * children, which is what keeps a note under a duplicate container listable
 * and drops a note whose parent was trashed.
 */
export async function searchStorageNotes(
  libraryID: number,
  { includeTrashed = false } = {},
): Promise<Zotero.Item[]> {
  const search = new Zotero.Search();
  search.addCondition("libraryID", "is", libraryID);
  search.addCondition("itemType", "is", "note");
  search.addCondition("tag", "is", STORAGE_TAG);
  if (includeTrashed) {
    search.addCondition("includeDeleted", "true");
  }
  const ids = await search.search();
  if (ids.length === 0) {
    return [];
  }
  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  // Sorted here rather than relying on getAsync echoing the id order back.
  return [...items].sort((a, b) => a.id - b.id);
}

// Deliberately a second full function rather than one parameterised by tag.
// Two call sites is not the third occurrence the abstraction threshold asks
// for, and a shared helper here would be that abstraction wearing two names.
/** Every note in a library carrying the vocabulary tag, lowest item id first. */
export async function searchVocabularyNotes(
  libraryID: number,
  { includeTrashed = false } = {},
): Promise<Zotero.Item[]> {
  const search = new Zotero.Search();
  search.addCondition("libraryID", "is", libraryID);
  search.addCondition("itemType", "is", "note");
  search.addCondition("tag", "is", VOCABULARY_TAG);
  if (includeTrashed) {
    search.addCondition("includeDeleted", "true");
  }
  const ids = await search.search();
  if (ids.length === 0) {
    return [];
  }
  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  return [...items].sort((a, b) => a.id - b.id);
}

/**
 * Refuses a note of the wrong kind before anything tries to parse it.
 *
 * Kind comes from the tag, never from sniffing the content, so it is still
 * answerable when the JSON inside is unreadable. That is what keeps "a corrupt
 * vocabulary note" distinguishable from "no vocabulary note yet": if kind came
 * from parsing, both would collapse into "restore the defaults" and a list the
 * user edited would be replaced by silence.
 *
 * Reading is what makes this matter, because a write follows a read. A
 * vocabulary note handed to the timeline reader and parsed anyway gets
 * overwritten by a timeline document on the next save.
 */
export function assertNoteKind(item: Zotero.Item, expectedTag: string): void {
  if (item.hasTag(expectedTag)) {
    return;
  }
  const found = item.getTags().map((t) => t.tag);
  throw new StorageError(
    "wrong-kind",
    `note ${item.id} does not carry ${expectedTag}; it has [${found.join(", ")}]`,
  );
}

/**
 * The library's container, created if it has none.
 *
 * Throws rather than creating one when every container the library has is in
 * the trash. Zotero.Search skips trashed items and trashing a parent does not
 * flag its children, so one trash action makes every document in the library
 * vanish from the plugin at once. A replacement container would then take
 * every future write while the real timelines sat in the trash, and nothing in
 * Zotero's UI would say so. Reporting it is the caller's job.
 *
 * The trashed check is a plain search, deliberately: this runs inside queued
 * storage tasks, and the queue is not reentrant.
 */
export async function findOrCreateContainer(
  libraryID: number,
): Promise<Zotero.Item> {
  const existing = await findContainers(libraryID);
  if (existing.length > 0) {
    return existing[0];
  }
  // No live container, so anything this finds is trashed.
  if ((await findContainers(libraryID, { includeTrashed: true })).length > 0) {
    throw new StorageError(
      "container-trashed",
      `library ${libraryID} has only trashed containers; refusing to create a replacement`,
    );
  }
  const item = new Zotero.Item("document");
  item.libraryID = libraryID;
  item.setField("title", CONTAINER_TITLE);
  item.addTag(CONTAINER_TAG);
  await item.saveTx();
  return item;
}

/**
 * Creates one plugin-owned note under the library's container.
 *
 * The single place a plugin note is born, so every one of them carries a tag
 * and none of them is ever a top-level row. Runs through the write queue: two
 * concurrent first writes would otherwise each find no container and each
 * create one, and nothing local to findOrCreateContainer can prevent that.
 *
 * `libraryID` is required rather than defaulted on every path here. A fallback
 * that omits it can put a group-library note in the user library.
 */
export async function createTaggedNote(
  libraryID: number,
  tag: string,
  html: string,
): Promise<Zotero.Item> {
  return enqueue(async () => {
    const container = await findOrCreateContainer(libraryID);
    const item = new Zotero.Item("note");
    item.libraryID = libraryID;
    // Parented before the save, so the note never exists as a top-level row -
    // not even for the moment between creating it and moving it.
    item.parentItemID = container.id;
    item.setNote(html);
    item.addTag(tag);
    await item.saveTx();
    return item;
  });
}
