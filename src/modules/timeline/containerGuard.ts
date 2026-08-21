/**
 * Tells the user when the plugin's container or one of its timeline notes
 * lands in the trash.
 *
 * Worth a warning of its own because nothing in Zotero's UI connects the two
 * ends of it: a trashed parent hides its child notes from Zotero.Search, so
 * one trash action makes every timeline in the library disappear from the
 * plugin at once. The warning is all this does. Un-trashing would reverse a
 * deliberate user action, and creating a replacement container would send the
 * next write somewhere the trashed timelines can never be recovered into.
 */
import { getString } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import { CONTAINER_TAG, STORAGE_TAG, readDocumentFromNote } from "./storage";

const OBSERVER_ID = "zoterotimeline-container-guard";

/**
 * A dismiss-on-click ProgressWindow with no close timer, so a warning about
 * data going out of reach cannot scroll past unread.
 *
 * Exported so tests can stub it: the alternative is asserting against a XUL
 * popup, and this is fire-and-forget UI.
 */
export function warn(text: string): void {
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({ text, type: "fail" })
    .show();
}

/**
 * The trashed timeline's own name, so the warning says which one went.
 *
 * The note still holds its content while it is in the trash, so this reads the
 * document off the item already in hand. Non-queued readers only: starting a
 * queued write from inside an observer is the hazard this whole module is
 * written around. A document that will not parse falls back to the generic
 * message rather than throwing inside the observer.
 */
function timelineName(item: Zotero.Item): string | null {
  try {
    return readDocumentFromNote(item).doc.name;
  } catch {
    return null;
  }
}

/**
 * Returns nothing rather than a promise.
 *
 * Zotero awaits every observer's return value inside the commit of the
 * transaction that fired the notification, and storage writes run on a serial
 * queue, so an observer that awaits a queued write parks that write behind the
 * task waiting on the observer. Neither settles and every later write in the
 * session hangs, with no error thrown and nothing in the debug log. Nothing
 * here touches the queue, and nothing here may start to.
 */
/**
 * Which warning a batch of trashed ids deserves, or null for nothing to say.
 *
 * A descriptor rather than finished text, for a reason the test bundle
 * enforces: the `addon` global exists only inside the plugin's own bundle, so
 * anything reached from a spec that calls getString throws "addon is not
 * defined". Deciding here and rendering in `notify` keeps the decision
 * assertable and leaves the wording where translations live.
 */
export type TrashWarning =
  | { key: "container-trashed-now" }
  | { key: "timeline-trashed-now"; name: string }
  | { key: "timeline-trashed-now-unnamed" };

export async function trashWarningFor(
  ids: string[] | number[],
): Promise<TrashWarning | null> {
  const trashedTimelines: string[] = [];
  for (const id of ids) {
    const item = (await Zotero.Items.getAsync(Number(id))) as
      | Zotero.Item
      | false;
    // The same event fires on restore, so the deleted flag is what separates
    // "moved to trash" from "taken back out of it".
    if (!item || !item.deleted) {
      continue;
    }
    // The container first: trashing it takes every timeline under it out of
    // reach, so the broader message is the accurate one even when the same
    // batch also names notes.
    if (item.hasTag(CONTAINER_TAG)) {
      return { key: "container-trashed-now" };
    }
    if (item.hasTag(STORAGE_TAG)) {
      trashedTimelines.push(timelineName(item) ?? "");
    }
  }
  if (trashedTimelines.length === 0) {
    return null;
  }
  const [name] = trashedTimelines;
  return trashedTimelines.length === 1 && name !== ""
    ? { key: "timeline-trashed-now", name }
    : { key: "timeline-trashed-now-unnamed" };
}

function renderWarning(warning: TrashWarning): string {
  return warning.key === "timeline-trashed-now"
    ? getString(warning.key, { args: { name: warning.name } })
    : getString(warning.key);
}

function notify(
  event: _ZoteroTypes.Notifier.Event,
  type: _ZoteroTypes.Notifier.Type,
  ids: string[] | number[],
): void {
  // registerObserver's types argument filters by type only, not by event.
  if (event !== "trash" || type !== "item") {
    return;
  }
  void (async () => {
    try {
      const warning = await trashWarningFor(ids);
      if (warning !== null) {
        warn(renderWarning(warning));
      }
    } catch (err) {
      logFailure(
        `[zoteroTimeline] trash check failed: ${(err as Error).message}`,
        err,
      );
    }
  })();
}

/** Exported for the test that proves the observer returns void rather than a promise. */
export const observerForTesting = { notify };

export function registerContainerObserver(): string {
  return Zotero.Notifier.registerObserver({ notify }, ["item"], OBSERVER_ID);
}

export function unregisterContainerObserver(id: string): void {
  Zotero.Notifier.unregisterObserver(id);
}
