/**
 * Parsed timeline documents, keyed by note item id, invalidated by Zotero's
 * own modify notification.
 *
 * The cache holds parsed documents and nothing derived from them. Which events
 * cite a given Zotero item is computed by reading documents, every time. A
 * second copy of the truth is the thing this data model exists to avoid, and a
 * "just a cache" index of citations is how one gets built by accident.
 *
 * The parse is cached, not the search. The list path re-runs the tag search on
 * every call and consults this per note, which is what makes an erased note
 * disappear and an added note appear with no invalidation logic of their own: a
 * note that is gone is never asked for, and a new one is simply a miss.
 *
 * No rebuild scheduling lives here. A consumer that redraws on invalidation
 * needs single-flight plus a dirty bit, because notifications arriving
 * mid-rebuild would otherwise be dropped; that belongs with the consumer that
 * has one, which is the combined view, not here unused.
 */
import { serializeDocument, type TimelineDocument } from "./schema";
import { type DateIssue } from "./validate";
import { listTimelines, readDocumentFromNote, refreshNote } from "./storage";

type CacheEntry = {
  /** What the note held when it was parsed, for content-identity comparison. */
  serialized: string;
  doc: TimelineDocument;
  dateIssues: DateIssue[];
};

const cache = new Map<number, CacheEntry>();

let parseCount = 0;

/** How many times a note has actually been parsed. Exported for the tests. */
export function parsesSoFar(): number {
  return parseCount;
}

/**
 * The document a note holds, parsed at most once until the note changes.
 *
 * Refreshes the note from the database on a miss. Zotero reloads a saved
 * object asynchronously, so an item's cached note text can lag its own
 * committed write; invalidation alone is not enough, because a cache that
 * re-reads a stale getNote() on a miss is still wrong.
 */
export async function readCached(item: Zotero.Item): Promise<{
  doc: TimelineDocument;
  dateIssues: DateIssue[];
}> {
  const hit = cache.get(item.id);
  if (hit) {
    return { doc: hit.doc, dateIssues: hit.dateIssues };
  }
  await refreshNote(item);
  const { doc, dateIssues } = readDocumentFromNote(item);
  parseCount += 1;
  cache.set(item.id, { serialized: serializeDocument(doc), doc, dateIssues });
  return { doc, dateIssues };
}

/**
 * Whether a document is byte-identical to what this cache last saw for that
 * note.
 *
 * The way a consumer tells its own write's notification from someone else's
 * edit. A "currently writing" boolean does not work: Zotero fires modify twice
 * per save, once inside the transaction before the write promise resolves and
 * again a macrotask later after commit, so the second notification always
 * escapes the flag. Content identity has no such window, which is why the
 * parser is careful never to assign an explicitly-undefined optional key: a
 * document that does not round-trip byte-identically makes this always false.
 */
export function matchesCached(
  noteItemID: number,
  doc: TimelineDocument,
): boolean {
  return cache.get(noteItemID)?.serialized === serializeDocument(doc);
}

/**
 * The library's timelines, parsing only the notes whose cache entry is stale.
 *
 * The same listing as the uncached one, with the cache as its reader: the tag
 * search still runs every call, so an added or erased note needs no
 * invalidation of its own.
 */
export async function listTimelinesCached(libraryID: number) {
  return listTimelines(libraryID, readCached);
}

export function invalidate(noteItemID: number): void {
  cache.delete(noteItemID);
}

/** Session-scoped, so tests and a plugin unload both need a way to empty it. */
export function clearCache(): void {
  cache.clear();
}

/**
 * Drops only the notified ids.
 *
 * Returns void and awaits nothing, which satisfies two rules at once. Zotero
 * awaits every observer's return value inside the commit of the transaction
 * that fired it, and storage writes run on a serial queue, so awaiting a
 * queued write here would park that write behind the task waiting on this
 * observer: neither settles and every later write in the session hangs, with
 * no error thrown and nothing in the debug log. Invalidation is a synchronous
 * Map.delete and there is no reason for that to change; eager re-parsing, if
 * ever wanted, is a scheduled task rather than work done in here.
 *
 * Deletes the notified ids rather than clearing the map. Clearing would pass a
 * naive reading of "invalidates that document" and defeat the cache the moment
 * the user touched an unrelated item.
 */
function notify(
  event: _ZoteroTypes.Notifier.Event,
  type: _ZoteroTypes.Notifier.Type,
  ids: string[] | number[],
): void {
  if (event !== "modify" || type !== "item") {
    return;
  }
  for (const id of ids) {
    cache.delete(Number(id));
  }
}

const OBSERVER_ID = "zoterotimeline-document-cache";

export function registerCacheObserver(): string {
  return Zotero.Notifier.registerObserver({ notify }, ["item"], OBSERVER_ID);
}

export function unregisterCacheObserver(id: string): void {
  Zotero.Notifier.unregisterObserver(id);
  clearCache();
}

/** Exported so a spec can drive the same notify the observer registers. */
export const cacheObserverForTesting = { notify };
