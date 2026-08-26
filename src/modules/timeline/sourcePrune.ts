/**
 * Prunes a `SourceRef` whose item was erased from Zotero. Registered as a
 * Zotero.Notifier observer on type "item" (a note is an item with itemType
 * "note", so one registration covers both source kinds) and filters to event
 * "delete" itself, since registerObserver's `types` filters by Type only, not
 * Event. Runs on erase, never on trash: Zotero's trash is reversible, and a
 * trashed item's links keep resolving until the trash is emptied.
 *
 * extraData for a "delete"/"item" notification is keyed by the deleted item's
 * numeric id and carries { libraryID, key } for that item - measured directly
 * against this worktree's Zotero in test/pruneSourceRefs.test.ts's probe
 * test, confirming zoteroMindmap's deletionCleanup.ts over its own project
 * memory, which claims extraData carries numeric ids alone.
 *
 * Reconciles rather than tracks: a source is dropped when its (libraryID,
 * key) matches what this one notification says was just erased, and nothing
 * about that match is kept afterward. No reverse index, for the same reason
 * there is none anywhere else in this design.
 */
import { logFailure, logTrace } from "../../utils/logging";
import { StorageError, listTimelines, updateTimelineDocument } from "./storage";
import type { SourceRef } from "./schema";

const OBSERVER_ID = "zoterotimeline-source-prune";

function refKey(libraryID: number, key: string): string {
  return `${libraryID}:${key}`;
}

function isDangling(source: SourceRef, deletedRefs: Set<string>): boolean {
  return deletedRefs.has(refKey(source.libraryID, source.key));
}

async function pruneLibrary(
  libraryID: number,
  deletedRefs: Set<string>,
): Promise<void> {
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable) {
    logTrace(
      `[zoteroTimeline] source prune: skipping library ${libraryID}, not writable`,
    );
    return;
  }

  const { timelines } = await listTimelines(libraryID);
  const touched = timelines.filter(({ doc }) =>
    doc.events.some((event) =>
      event.sources.some((source) => isDangling(source, deletedRefs)),
    ),
  );

  for (const { doc } of touched) {
    try {
      await updateTimelineDocument(
        (current) => {
          let changed = false;
          const events = current.events.map((event) => {
            const sources = event.sources.filter(
              (source) => !isDangling(source, deletedRefs),
            );
            if (sources.length === event.sources.length) {
              return event;
            }
            changed = true;
            return { ...event, sources };
          });
          return changed ? { ...current, events } : null;
        },
        doc.id,
        libraryID,
      );
    } catch (err) {
      if (err instanceof StorageError) {
        // A timeline that vanished or stopped parsing between the listing
        // and the update is not a reason to skip the rest of them.
        logTrace(
          `[zoteroTimeline] source prune: could not update timeline ${doc.id} in library ${libraryID}: ${err.message}`,
        );
        continue;
      }
      throw err;
    }
  }
}

async function handleDelete(
  ids: string[] | number[],
  extraData: { [key: string]: any },
): Promise<void> {
  const deletedRefs = new Set<string>();
  const libraryIDs = new Set<number>();
  for (const id of ids) {
    const entry = extraData[id];
    if (
      entry &&
      typeof entry.libraryID === "number" &&
      typeof entry.key === "string"
    ) {
      deletedRefs.add(refKey(entry.libraryID, entry.key));
      libraryIDs.add(entry.libraryID);
    }
  }
  if (deletedRefs.size === 0) {
    return;
  }
  for (const libraryID of libraryIDs) {
    await pruneLibrary(libraryID, deletedRefs);
  }
}

/**
 * Returns nothing rather than a promise, and must keep doing so. Zotero
 * awaits each observer's return value inside the commit of the transaction
 * that fired the notification, and the pruning below ends in a storage-queue
 * write - so awaiting it here would park that write behind whichever queued
 * task is waiting on this notification to return. Neither would ever settle,
 * and every later write in the session would hang silently.
 *
 * The work is deferred a turn rather than started inline so the reads it
 * opens with see the state the transaction leaves behind, not the one it is
 * still committing.
 */
function notify(
  event: _ZoteroTypes.Notifier.Event,
  type: _ZoteroTypes.Notifier.Type,
  ids: string[] | number[],
  extraData: { [key: string]: any },
): void {
  if (event !== "delete" || type !== "item") {
    return;
  }
  void (async () => {
    try {
      await Zotero.Promise.delay(0);
      await handleDelete(ids, extraData);
    } catch (err) {
      logFailure(
        `[zoteroTimeline] source prune failed: ${(err as Error).message}`,
        err,
      );
    }
  })();
}

/** Exported so a spec can drive the same notify the observer registers. */
export const observerForTesting = { notify };

export function registerSourcePruneObserver(): string {
  return Zotero.Notifier.registerObserver({ notify }, ["item"], OBSERVER_ID);
}

export function unregisterSourcePruneObserver(id: string): void {
  Zotero.Notifier.unregisterObserver(id);
}
