/**
 * Hides the plugin's container item, and the notes under it, from the item
 * tree while the hideTimelineNotes preference is on.
 *
 * Zotero has no supported way to filter rows out of the item tree, so this
 * replaces Zotero.CollectionTreeRow.prototype.getSearchObject: it calls the
 * original, then wraps what came back in a fresh search scoped to it that
 * excludes the plugin's tags. Wrapping is safe because getSearchObject always
 * hands back a search it just built rather than a reference to a user's saved
 * search.
 *
 * Everything after the call-through sits inside a catch that returns the
 * original result. getSearchObject is undocumented internal API and the code
 * around it is moving: itemTree was refactored onto a row provider in
 * 10.0-beta.25, and CI runs four majors. Failing open means a Zotero update
 * costs one visible row rather than an item tree that renders nothing.
 */
import { getPref } from "../../utils/prefs";
import { logFailure } from "../../utils/logging";
import { config } from "../../../package.json";
import {
  registerNotifierObserver,
  unregisterNotifierObserver,
} from "./notifierRegistry";
import { CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG } from "./storage";

type SearchOptions = { unfiltered?: boolean };
type GetSearchObject = (
  this: Zotero.CollectionTreeRow,
  options?: SearchOptions,
) => Promise<Zotero.Search>;

const PREF_KEY = `${config.prefsPrefix}.hideTimelineNotes`;
const OBSERVER_ID = "zoterotimeline-library-filter";
const PLUGIN_TAGS = [CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG];

let original: GetSearchObject | undefined;
let prefObserver: symbol | undefined;
let restoreObserver: string | undefined;

/**
 * Rows whose results the wrap would change the meaning of rather than narrow.
 *
 * The trash view searches for deleted items and a plain search excludes those,
 * so scoping it would empty the trash of everything the user might be trying
 * to recover, including the plugin data the trash warning just told them was
 * restorable. The feeds pseudo-library has no libraryID to scope to.
 */
function isFilterable(row: Zotero.CollectionTreeRow): boolean {
  const anyRow = row as unknown as {
    isFeeds?: () => boolean;
    ref?: { libraryID?: unknown };
  };
  if (row.isTrash() || row.isFeed() || anyRow.isFeeds?.()) {
    return false;
  }
  return typeof anyRow.ref?.libraryID === "number";
}

/**
 * Excludes the container tag AND both note tags together.
 *
 * Excluding the container alone does not hide it. A library row's search
 * matches child items too, and the item tree answers a matching child whose
 * parent is missing by adding a row for that parent, so the container comes
 * straight back. All three conditions are load-bearing; a test pins that
 * rather than leaving it to this comment.
 */
function withoutPluginItems(
  row: Zotero.CollectionTreeRow,
  result: Zotero.Search,
): Zotero.Search {
  const filtered = new Zotero.Search();
  filtered.addCondition(
    "libraryID",
    "is",
    (row.ref as { libraryID: number }).libraryID,
  );
  filtered.addCondition("tag", "isNot", CONTAINER_TAG);
  filtered.addCondition("tag", "isNot", STORAGE_TAG);
  filtered.addCondition("tag", "isNot", VOCABULARY_TAG);
  filtered.setScope(result, false);
  return filtered;
}

/**
 * Redraws every open item tree. The row's own search is cached per row and the
 * refresh clears that cache before rebuilding, which is what makes a toggle
 * land without a restart.
 */
function refreshItemTrees(): void {
  for (const win of Zotero.getMainWindows()) {
    const view = (win as _ZoteroTypes.MainWindow).ZoteroPane?.itemsView as
      { refreshAndMaintainSelection?: () => Promise<void> } | undefined;
    void view?.refreshAndMaintainSelection?.();
  }
}

/**
 * Refreshes the item trees when one of the plugin's items comes back out of
 * the trash.
 *
 * Zotero's item tree answers that "modify" by adding the row itself, without
 * running the row's search again, so the patched search never gets a say:
 * restoring the container with My Library on screen showed it there with the
 * preference on until something else refreshed the view (3 of 3 on
 * 2026-10-07, 0 of 3 with this refresh). Trashing needs nothing; the row
 * leaves on its own.
 *
 * Returns nothing and defers a turn, for the reason sourcePrune.ts's notify
 * gives: Zotero awaits observers inside the commit that fired them.
 */
function notifyRestore(
  event: _ZoteroTypes.Notifier.Event,
  type: _ZoteroTypes.Notifier.Type,
  ids: string[] | number[],
  extraData: { [key: string]: any },
): void {
  if (event !== "modify" || type !== "item" || !getPref("hideTimelineNotes")) {
    return;
  }
  const restored = (ids as number[]).some((id) => {
    if (!extraData?.[id]?.changed || !("deleted" in extraData[id].changed)) {
      return false;
    }
    const item = Zotero.Items.get(id) as Zotero.Item | false;
    return (
      !!item && !item.deleted && PLUGIN_TAGS.some((tag) => item.hasTag(tag))
    );
  });
  if (restored) {
    void Zotero.Promise.delay(0).then(refreshItemTrees);
  }
}

export function registerLibraryFilter(): void {
  if (original) {
    return;
  }
  const proto = (
    Zotero as unknown as { CollectionTreeRow?: { prototype: any } }
  ).CollectionTreeRow?.prototype;
  if (typeof proto?.getSearchObject !== "function") {
    logFailure(
      "[zoteroTimeline] no CollectionTreeRow.getSearchObject to patch; the plugin container stays visible",
    );
    return;
  }

  original = proto.getSearchObject as GetSearchObject;
  const callThrough = original;
  proto.getSearchObject = async function (
    this: Zotero.CollectionTreeRow,
    options?: SearchOptions,
  ): Promise<Zotero.Search> {
    const result = await callThrough.call(this, options);
    try {
      // Zotero passes unfiltered when it wants the unnarrowed search.
      if (options?.unfiltered || !getPref("hideTimelineNotes")) {
        return result;
      }
      return isFilterable(this) ? withoutPluginItems(this, result) : result;
    } catch (err) {
      logFailure(
        `[zoteroTimeline] hiding the plugin's items failed, leaving them visible: ${(err as Error).message}`,
        err,
      );
      return result;
    }
  };

  prefObserver = Zotero.Prefs.registerObserver(
    PREF_KEY,
    refreshItemTrees,
    true,
  );
  restoreObserver = registerNotifierObserver(
    { notify: notifyRestore },
    ["item"],
    OBSERVER_ID,
  );
}

/**
 * Puts Zotero's own method back.
 *
 * Required rather than tidy: a patch that outlives an unload gets stacked on
 * by the next load, so npm start's hot reload would leave the previous closure
 * calling through to itself.
 */
export function unregisterLibraryFilter(): void {
  if (prefObserver) {
    Zotero.Prefs.unregisterObserver(prefObserver);
    prefObserver = undefined;
  }
  if (restoreObserver) {
    unregisterNotifierObserver(restoreObserver);
    restoreObserver = undefined;
  }
  if (!original) {
    return;
  }
  (
    Zotero as unknown as { CollectionTreeRow: { prototype: any } }
  ).CollectionTreeRow.prototype.getSearchObject = original;
  original = undefined;
  refreshItemTrees();
}
