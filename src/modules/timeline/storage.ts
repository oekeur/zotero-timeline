/**
 * Everything the plugin stores lives in Zotero note items, and every one of
 * those notes hangs off a single container item per library. This module owns
 * the container and the write queue the rest of the storage layer is built on.
 *
 * Notes are found by tag rather than by content-sniffing, so a corrupted one
 * is still findable and still distinguishable from "no note yet".
 */
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_LINK_TYPES,
  serializeDocument,
  type TimelineDocument,
  type Vocabulary,
} from "./schema";
import {
  parseTimelineDocument,
  parseVocabulary,
  type DateIssue,
} from "./validate";
import { logFailure } from "../../utils/logging";

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
 * container from library data alone.
 *
 * The leading underscore on all three tags is a convention inherited from
 * mindmap on the belief that it hides them from Zotero's tag selector. It does
 * not: measured 2026-08-21 against Zotero 10.0-beta.25, both tags are type 0
 * and both are listed in the tag pane. The prefix is kept because the tags are
 * already the carrier convention and renaming them is a stored-data change,
 * but it buys nothing on its own and the clutter is real.
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
  | "container-trashed"
  | "empty-vocabulary"
  | "not-writable";

export class StorageError extends Error {
  reason: StorageErrorReason;
  /** Both set only for a version refusal, which is the case that has to name them. */
  documentVersion?: number;
  knownVersion?: number;

  constructor(
    reason: StorageErrorReason,
    message: string,
    versions?: { documentVersion?: number; knownVersion?: number },
  ) {
    super(message);
    this.name = "StorageError";
    this.reason = reason;
    if (versions?.documentVersion !== undefined) {
      this.documentVersion = versions.documentVersion;
    }
    if (versions?.knownVersion !== undefined) {
      this.knownVersion = versions.knownVersion;
    }
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
 * Whether the library holds plugin data a listing cannot reach. Trashing
 * hides data rather than removing it: a trashed storage note drops out of a
 * search, and a trashed container takes its child notes with it. Either way
 * the library looks empty while its timelines still exist, and answering
 * "empty" by creating a replacement writes a second copy nobody can reconcile
 * with the first.
 *
 * The two cases are tested separately rather than through one search.
 * Trashing a parent does not flag its children, so a count of trashed notes
 * alone would miss the timelines that went down with a trashed container.
 */
export async function hasHiddenTimelineData(
  libraryID: number,
): Promise<boolean> {
  const [visibleNotes, allNotes] = await Promise.all([
    searchStorageNotes(libraryID),
    searchStorageNotes(libraryID, { includeTrashed: true }),
  ]);
  if (allNotes.length > visibleNotes.length) {
    return true;
  }
  const [liveContainers, allContainers] = await Promise.all([
    findContainers(libraryID),
    findContainers(libraryID, { includeTrashed: true }),
  ]);
  return allContainers.length > liveContainers.length;
}

// Zotero re-serialises a note's HTML through its own ProseMirror schema after
// save, wrapping the body in a data-schema-version div and dropping attributes
// the schema does not know, including an id on our <pre>. That happens without
// the user ever opening the note, so match the TAG only. Anchoring the parse on
// an id broke silently in mindmap; do not add one back for clarity.
const DATA_BLOCK_PATTERN = /<pre\b[^>]*>([\s\S]*?)<\/pre>/;
const NOTE_WARNING =
  "<p>This note stores structured data for the Zotero Timeline plugin. Editing it manually will corrupt your timeline.</p>";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The note body a document is stored in: a human-readable warning, then the JSON. */
export function buildNoteHtml(doc: TimelineDocument): string {
  return `${NOTE_WARNING}<pre>${escapeHtml(serializeDocument(doc))}</pre>`;
}

/**
 * Zotero's sync server refuses a note above this many UTF-16 code units with
 * HTTP 413, and nothing enforces it client-side. Measured 2026-08-20; earlier
 * quoted figures of 200,000 and 250,000 are stale and the limit has been
 * raised more than once, so treat this as a measurement with a date rather
 * than a fact. An oversized document writes locally and fails only at sync, on
 * whichever machine syncs first.
 */
export const NOTE_SIZE_CEILING = 500_000;

/**
 * Where the warning fires, at 90% of the ceiling. The margin covers two
 * things, and the second is easy to miss:
 *
 * The user needs room to finish a thought and split a timeline deliberately,
 * rather than being caught mid-edit by a limit.
 *
 * And what the server measures is not exactly the string we set. Zotero
 * re-serialises the note through its own schema on save, wrapping the body in
 * a data-schema-version div, so our measurement is a lower bound on what the
 * server sees. That overhead is not measured; if a 413 ever arrives under this
 * budget, the gap is the first place to look.
 */
export const NOTE_SIZE_BUDGET = 450_000;

// One warning per document per session. Every drag is a write, and a warning
// on every write trains the user to dismiss warnings, which is worse than no
// warning at all.
const warnedAboutSize = new Set<string>();

export function clearSizeWarnings(): void {
  warnedAboutSize.clear();
}

/**
 * Whether this write should warn the user that the document is approaching the
 * note size ceiling.
 *
 * Measures the FINAL note content, wrapper included, because the wrapper is
 * exactly what the budget's second reason is about. String.length is UTF-16
 * code units, so an astral character counts as two with no extra work; the
 * test is what proves nobody replaced it with a code-point count.
 *
 * Returns the decision rather than warning, for the same reason the trash
 * guard does: reaching getString from a spec throws.
 */
export function shouldWarnAboutSize(
  doc: TimelineDocument,
  html: string,
): boolean {
  if (html.length < NOTE_SIZE_BUDGET || warnedAboutSize.has(doc.id)) {
    return false;
  }
  warnedAboutSize.add(doc.id);
  return true;
}

function extractDataBlock(html: string): string | null {
  return DATA_BLOCK_PATTERN.exec(html)?.[1] ?? null;
}

/**
 * Reloads a note's text from the database.
 *
 * Zotero reloads a saved object asynchronously, so an item's cached note text
 * can lag its own committed write and hand back the document as it was before.
 * Only paths that may be reading their own recent write pay for this;
 * enumerating a library does not.
 */
export async function refreshNote(item: Zotero.Item): Promise<Zotero.Item> {
  await item.reload(["note"], true);
  return item;
}

/**
 * Reads and validates the document a storage note holds.
 *
 * Throws StorageError rather than returning null, so a corrupt note stays
 * distinguishable from an empty one at every call site. Parses the note as it
 * currently stands; see refreshNote for when that has to be reconciled with
 * the database first.
 */
export function readDocumentFromNote(item: Zotero.Item): {
  doc: TimelineDocument;
  dateIssues: DateIssue[];
} {
  assertNoteKind(item, STORAGE_TAG);
  const block = extractDataBlock(item.getNote());
  if (block === null) {
    throw new StorageError(
      "block-missing",
      `note ${item.id} is missing its data block`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(unescapeHtml(block));
  } catch (err) {
    throw new StorageError(
      "parse-failed",
      `note ${item.id} contains invalid JSON: ${(err as Error).message}`,
    );
  }
  const result = parseTimelineDocument(data);
  if (!result.ok) {
    throw new StorageError(result.reason, `note ${item.id}: ${result.error}`, {
      documentVersion: result.documentVersion,
      knownVersion: result.knownVersion,
    });
  }
  return { doc: result.doc, dateIssues: result.dateIssues };
}

/** The note body the vocabulary is stored in, wrapped exactly like a document. */
export function buildVocabularyNoteHtml(vocabulary: Vocabulary): string {
  return `${NOTE_WARNING}<pre>${escapeHtml(JSON.stringify(vocabulary))}</pre>`;
}

/**
 * Reads and validates the vocabulary a note holds.
 *
 * Guarded on the vocabulary tag for the same reason the document reader is
 * guarded on the storage tag: a write follows a read, so a note read as the
 * wrong kind gets overwritten by the wrong kind on the next save.
 */
export function readVocabularyFromNote(item: Zotero.Item): Vocabulary {
  assertNoteKind(item, VOCABULARY_TAG);
  const block = extractDataBlock(item.getNote());
  if (block === null) {
    throw new StorageError(
      "block-missing",
      `vocabulary note ${item.id} is missing its data block`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(unescapeHtml(block));
  } catch (err) {
    throw new StorageError(
      "parse-failed",
      `vocabulary note ${item.id} contains invalid JSON: ${(err as Error).message}`,
    );
  }
  const result = parseVocabulary(data);
  if (!result.ok) {
    throw new StorageError(
      result.reason,
      `vocabulary note ${item.id}: ${result.error}`,
      {
        documentVersion: result.documentVersion,
        knownVersion: result.knownVersion,
      },
    );
  }
  return result.doc;
}

export type StoredTimeline = {
  noteItemID: number;
  doc: TimelineDocument;
  dateIssues: DateIssue[];
};

export type UnreadableTimeline = {
  noteItemID: number;
  reason: StorageErrorReason;
  message: string;
  /** Both present only for a version refusal, which is the case that needs them. */
  documentVersion?: number;
  knownVersion?: number;
};

/**
 * Every readable timeline in a library, plus an account of what could not be
 * read.
 *
 * Returns both halves rather than a bare array on purpose. One corrupt
 * document must not make the others unlistable, and skipping silently is the
 * wrong half of that: "nothing found after skipping one" has to show as an
 * error state rather than as an empty library.
 *
 * Creates nothing. A library with no container lists as empty rather than
 * acquiring one, which is why this does not route through
 * findOrCreateContainer for symmetry with the write path.
 *
 * Searches the library by tag rather than walking the container, so a note
 * under a duplicate container still lists and a note whose parent was trashed
 * does not.
 */
export async function listTimelines(
  libraryID: number,
  // Injected rather than imported so the cache can supply a caching reader
  // without storage.ts having to know the cache exists.
  read: (item: Zotero.Item) =>
    | { doc: TimelineDocument; dateIssues: DateIssue[] }
    | Promise<{
        doc: TimelineDocument;
        dateIssues: DateIssue[];
      }> = readDocumentFromNote,
): Promise<{
  timelines: StoredTimeline[];
  unreadable: UnreadableTimeline[];
}> {
  const notes = await searchStorageNotes(libraryID);
  const timelines: StoredTimeline[] = [];
  const unreadable: UnreadableTimeline[] = [];

  for (const note of notes) {
    try {
      const { doc, dateIssues } = await read(note);
      timelines.push({ noteItemID: note.id, doc, dateIssues });
    } catch (err) {
      const error =
        err instanceof StorageError
          ? err
          : new StorageError("parse-failed", String(err));
      // Returned for the UI and logged as well, because the log is what a bug
      // report has when nobody looked at the UI.
      logFailure(
        `[zoteroTimeline] skipping unreadable timeline note ${note.id} in library ${libraryID}: ${error.message}`,
        error,
      );
      unreadable.push({
        noteItemID: note.id,
        reason: error.reason,
        message: error.message,
        ...(error.documentVersion !== undefined
          ? { documentVersion: error.documentVersion }
          : {}),
        ...(error.knownVersion !== undefined
          ? { knownVersion: error.knownVersion }
          : {}),
      });
    }
  }

  return { timelines, unreadable };
}

/**
 * Writes a document into a note that already exists.
 *
 * setNote runs INSIDE the transaction, not before it. saveTx() calls
 * _initSave, which reads the item's change flags, before Zotero opens the
 * transaction, so a save queued behind another transaction on the same item
 * can have its pending note change wiped in between by the earlier save's
 * _finalizeSave (reload() plus _clearChanged()). The save then reports
 * success, writes nothing, and the in-memory note silently reverts. Opening
 * the transaction first closes that window.
 *
 * Creating a note and erasing one still use saveTx/eraseTx; this wrapper is
 * specifically for re-saving an existing body.
 */
async function saveDocumentToNote(
  item: Zotero.Item,
  doc: TimelineDocument,
  onOversize: (doc: TimelineDocument) => void = () => {},
): Promise<void> {
  const html = buildNoteHtml(doc);
  // Measured before the write and never blocking it. Refusing would lose
  // authored work, and whether to split a timeline is the user's call.
  if (shouldWarnAboutSize(doc, html)) {
    onOversize(doc);
  }
  await Zotero.DB.executeTransaction(async () => {
    item.setNote(html);
    await item.save();
  });
}

/** The storage note holding the document with this id, or null. */
async function findNoteForDocument(
  documentId: string,
  libraryID: number,
): Promise<Zotero.Item | null> {
  for (const note of await searchStorageNotes(libraryID)) {
    try {
      if (readDocumentFromNote(note).doc.id === documentId) {
        return note;
      }
    } catch {
      // An unreadable note is not the note we are looking for. listTimelines
      // is what reports it; failing the write here would make one corrupt
      // document block edits to every other timeline.
      continue;
    }
  }
  return null;
}

/**
 * Reads one document, applies `mutate`, and writes exactly that note back with
 * no other storage operation interleaving.
 *
 * The note is resolved ONCE, inside the queued task, which is what makes this
 * a read-modify-write against the document as it stands at write time rather
 * than against a copy some caller read earlier. Return null from `mutate` to
 * mean "no change": a no-op edit should not dirty a note, because every dirty
 * note is a sync round trip and a modify notification something has to
 * suppress.
 *
 * One edit writes one note. That granularity is the deliberate divergence
 * from mindmap, which rewrites its whole document per edit, and it is what
 * bounds last-write-wins to a single timeline.
 *
 * A document the code cannot fully read is never mutated: a version refusal
 * aborts before `mutate` is called, because last-write-wins means a partial
 * parse followed by a save erases whatever the newer version added, silently.
 */
export async function updateTimelineDocument(
  mutate: (doc: TimelineDocument) => TimelineDocument | null,
  documentId: string,
  libraryID: number,
  onOversize?: (doc: TimelineDocument) => void,
): Promise<TimelineDocument | null> {
  return enqueue(async () => {
    // Plain searches only in here. The queue is not reentrant.
    const note = await findNoteForDocument(documentId, libraryID);
    if (note === null) {
      throw new StorageError(
        "not-found",
        `no timeline with id ${documentId} in library ${libraryID}`,
      );
    }
    await refreshNote(note);
    // Throws on a version refusal, which is the abort this needs.
    const { doc } = readDocumentFromNote(note);

    const next = mutate(doc);
    if (next === null) {
      return null;
    }
    const result = parseTimelineDocument(next);
    if (!result.ok) {
      throw new StorageError(
        result.reason,
        `refusing to write an invalid document to note ${note.id}: ${result.error}`,
      );
    }
    await saveDocumentToNote(note, result.doc, onOversize);
    return result.doc;
  });
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
 * Not queued itself: `createTaggedNote` wraps this for every caller outside
 * storage.ts, and `updateVocabulary` calls it directly from inside its own
 * queued task, where enqueueing again would park it behind itself - the
 * queue is not reentrant.
 *
 * `libraryID` is required rather than defaulted on every path here. A fallback
 * that omits it can put a group-library note in the user library.
 */
async function createNoteUnqueued(
  libraryID: number,
  tag: string,
  html: string,
): Promise<Zotero.Item> {
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
}

/**
 * Creates one plugin-owned note under the library's container.
 *
 * The single place a plugin note is born, so every one of them carries a tag
 * and none of them is ever a top-level row. Runs through the write queue: two
 * concurrent first writes would otherwise each find no container and each
 * create one, and nothing local to findOrCreateContainer can prevent that.
 */
export async function createTaggedNote(
  libraryID: number,
  tag: string,
  html: string,
): Promise<Zotero.Item> {
  return enqueue(() => createNoteUnqueued(libraryID, tag, html));
}

function emptyTimelineDocument(name: string): TimelineDocument {
  return {
    version: CURRENT_SCHEMA_VERSION,
    id: Zotero.Utilities.generateObjectKey(),
    name,
    events: [],
  };
}

/**
 * Creates a timeline: a fresh id, the given name, no events yet. Touches
 * nothing but the note it creates, so an existing timeline cannot be
 * disturbed by it.
 *
 * Refuses before the write reaches the queue when the library is not
 * writable or the name is empty or whitespace, the same two refusals
 * updateVocabulary makes for the vocabulary note - a doomed write should
 * never reach saveTx.
 *
 * The container can still land in the trash between this call and the write
 * createTaggedNote makes: findOrCreateContainer's own check runs right at
 * write time and throws `container-trashed` rather than creating a
 * replacement. That is for the caller to catch, not this function - a
 * warning is UI, and this module only writes.
 */
export async function createTimeline(
  name: string,
  libraryID: number,
): Promise<{ item: Zotero.Item; doc: TimelineDocument }> {
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable) {
    throw new StorageError(
      "not-writable",
      `library ${libraryID} is not writable`,
    );
  }
  if (name.trim() === "") {
    throw new StorageError("invalid-schema", "a timeline needs a name");
  }
  const doc = emptyTimelineDocument(name);
  const item = await createTaggedNote(
    libraryID,
    STORAGE_TAG,
    buildNoteHtml(doc),
  );
  return { item, doc };
}

/**
 * Renames a timeline: writes `name` and nothing else, through the same
 * read-modify-write updateTimelineDocument gives every other edit, so id,
 * version and events come back untouched.
 *
 * Refuses before the write reaches the queue when the library is not
 * writable or the name is empty or whitespace, the same two refusals
 * createTimeline makes and in the same order: checked here rather than left
 * to updateTimelineDocument's note search, which would report a document it
 * cannot find as `not-found` even when the true reason is that the library
 * refused the write.
 */
export async function renameTimeline(
  documentId: string,
  libraryID: number,
  name: string,
): Promise<TimelineDocument> {
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable) {
    throw new StorageError(
      "not-writable",
      `library ${libraryID} is not writable`,
    );
  }
  if (name.trim() === "") {
    throw new StorageError("invalid-schema", "a timeline needs a name");
  }
  const updated = await updateTimelineDocument(
    (doc) => ({ ...doc, name }),
    documentId,
    libraryID,
  );
  // mutate always returns a document above, so updateTimelineDocument never
  // reports "no change" here.
  return updated as TimelineDocument;
}

/**
 * Moves a timeline's storage note to Zotero's trash. Trashes rather than
 * erases, unlike mindmap's deleteMindmap: the confirmation the caller shows
 * promises the trash rather than a permanent erase, and this is what keeps
 * that promise true.
 *
 * Refuses a library the user cannot write before the note is even searched
 * for, the same refusal createTimeline and updateVocabulary make.
 */
export async function deleteTimeline(
  documentId: string,
  libraryID: number,
): Promise<void> {
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable) {
    throw new StorageError(
      "not-writable",
      `library ${libraryID} is not writable`,
    );
  }
  await enqueue(async () => {
    // A plain search only. The queue is not reentrant.
    const note = await findNoteForDocument(documentId, libraryID);
    if (note === null) {
      throw new StorageError(
        "not-found",
        `no timeline with id ${documentId} in library ${libraryID}`,
      );
    }
    note.deleted = true;
    await note.saveTx();
  });
}

/**
 * Reads the library's one vocabulary note (lowest key, matching the tie-break
 * readVocabulary uses), applies `mutate`, and writes the result back through
 * the same queue as updateTimelineDocument. A library with no vocabulary note
 * yet is read as the defaults, the same base readVocabulary would recover -
 * so an edit made against what a caller displayed as "the defaults, not yet
 * stored" lands on top of exactly that, rather than starting from nothing.
 *
 * Refuses two things a mutate function must not be trusted to check itself,
 * because every caller inherits the refusal from here:
 *
 * - Writing when the library is not editable. Checked before the queue is
 *   touched at all, so a doomed write never reaches saveTx.
 * - Writing an empty types list. A vocabulary with nothing in it breaks
 *   "default to the vocabulary's first type", which every link-authoring
 *   surface relies on being satisfiable. Reading an already-empty list off
 *   disk is still allowed; only writing one is refused.
 *
 * Return null from `mutate` to mean "no change": a no-op edit should not
 * dirty the note, same rule as updateTimelineDocument.
 */
export async function updateVocabulary(
  libraryID: number,
  mutate: (vocabulary: Vocabulary) => Vocabulary | null,
): Promise<Vocabulary | null> {
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable) {
    throw new StorageError(
      "not-writable",
      `library ${libraryID} is not writable`,
    );
  }
  return enqueue(async () => {
    // Plain searches and the unqueued note creator only. The queue is not
    // reentrant.
    const notes = await searchVocabularyNotes(libraryID);
    const sorted = [...notes].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    const existing = sorted[0] ?? null;
    const current: Vocabulary = existing
      ? readVocabularyFromNote(existing)
      : { version: CURRENT_SCHEMA_VERSION, types: DEFAULT_LINK_TYPES };

    const next = mutate(current);
    if (next === null) {
      return null;
    }
    if (next.types.length === 0) {
      throw new StorageError(
        "empty-vocabulary",
        `refusing to write an empty vocabulary to library ${libraryID}`,
      );
    }
    const result = parseVocabulary(next);
    if (!result.ok) {
      throw new StorageError(
        result.reason,
        `refusing to write an invalid vocabulary to library ${libraryID}: ${result.error}`,
      );
    }
    const html = buildVocabularyNoteHtml(result.doc);
    if (existing) {
      await Zotero.DB.executeTransaction(async () => {
        existing.setNote(html);
        await existing.save();
      });
    } else {
      await createNoteUnqueued(libraryID, VOCABULARY_TAG, html);
    }
    return result.doc;
  });
}
