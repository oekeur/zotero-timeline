/**
 * The shared half of the library right-click context menu: what counts as an
 * eligible selection, how the target library is decided, and the submenu of
 * timelines rebuilt on each popup. "Add to new event on ..." and "Add as
 * sources to ..." each call registerTimelineContextAction with their own
 * labels, icon and action; neither is registered here.
 *
 * The library a chosen entry acts on comes from the timeline itself
 * (TimelineMenuEntry.libraryID, read off its own storage note), never
 * recomputed from the selection. zoteroMindmap's libraryContextMenu.ts takes
 * eligible[0].libraryID instead, so a selection spanning two libraries is
 * silently treated as belonging to the first item's library - the write can
 * land in a library the user never selected from. Passing the timeline's own
 * library through TimelineMenuEntry closes that off structurally: there is no
 * "selection's library" left to reach for by the time an action runs.
 */
import { logFailure } from "../../utils/logging";
import { listTimelinesCached } from "./documentCache";
import { CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG } from "./storage";

const PLUGIN_TAGS = [CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG];

function isEligibleItem(item: Zotero.Item): boolean {
  return !item.isAttachment() && !PLUGIN_TAGS.some((tag) => item.hasTag(tag));
}

export type SelectionResolution =
  | { ok: true; libraryID: number; items: Zotero.Item[] }
  | { ok: false; reason: "empty" | "split"; message: string };

/**
 * Filters a raw selection down to the items that could ever be a source, then
 * decides whether they share one library. A selection spanning two libraries
 * has no single answer - splitting it across two documents or quietly picking
 * one both misrepresent what the user selected - so it is refused with a
 * message naming the problem rather than resolved either way.
 *
 * Ineligible items (the plugin's own container, storage and vocabulary notes,
 * and any attachment) are dropped before the library check, so a selection
 * that mixes an eligible item with an ineligible one from another library is
 * not refused for a split that was never actually offered as a source.
 */
export function resolveSelection(items: Zotero.Item[]): SelectionResolution {
  const eligible = items.filter(isEligibleItem);
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "Nothing eligible is selected.",
    };
  }
  const libraryIDs = new Set(eligible.map((item) => item.libraryID));
  if (libraryIDs.size > 1) {
    return {
      ok: false,
      reason: "split",
      message:
        "The selection spans more than one library; choose items from a single library.",
    };
  }
  return { ok: true, libraryID: eligible[0].libraryID, items: eligible };
}

export type TimelineMenuEntry = {
  noteItemID: number;
  libraryID: number;
  /** The stored document's own id, distinct from the note item's - what the
   * canvas's groups DataSet and vis item ids are keyed on. */
  documentId: string;
  name: string;
};

/**
 * The library's timelines, read once per opening of the item menu.
 *
 * Keyed on the popupshowing event, which the toolkit passes identically to
 * every isHidden/isDisabled/onShowing hook it fires for that one popup, so the
 * flat and submenu forms of both actions share this promise instead of each
 * re-running the tag search that listTimelinesCached still performs on every
 * call. Never populated outside a popup opening, so a timeline created or
 * renamed since the last popup is picked up the next time one opens.
 */
const listedPerPopup = new WeakMap<Event, Promise<TimelineMenuEntry[]>>();

function timelinesForPopup(
  event: Event,
  libraryID: number,
): Promise<TimelineMenuEntry[]> {
  const cached = listedPerPopup.get(event);
  if (cached) {
    return cached;
  }
  const listing = listTimelinesCached(libraryID)
    .then(({ timelines }) =>
      timelines.map((timeline) => ({
        noteItemID: timeline.noteItemID,
        libraryID,
        documentId: timeline.doc.id,
        name: timeline.doc.name,
      })),
    )
    .catch((err: Error) => {
      logFailure(
        `[zoteroTimeline] could not list timelines for the item menu: ${err.message}`,
        err,
      );
      return [] as TimelineMenuEntry[];
    });
  listedPerPopup.set(event, listing);
  return listing;
}

export type MenuShape =
  | { kind: "hidden" }
  | { kind: "disabled"; message: string }
  | { kind: "flat"; entry: TimelineMenuEntry }
  | { kind: "submenu"; entries: TimelineMenuEntry[] };

/**
 * The single decision both forms of an action render from: hidden with
 * nothing eligible selected, disabled with a message naming the problem for a
 * selection spanning libraries, a plain entry acting directly on the one
 * timeline a library holds, or a submenu once there is something to choose
 * between.
 */
export async function computeMenuShape(
  event: Event,
  rawSelection: Zotero.Item[],
): Promise<MenuShape> {
  const selection = resolveSelection(rawSelection);
  if (!selection.ok) {
    return selection.reason === "split"
      ? { kind: "disabled", message: selection.message }
      : { kind: "hidden" };
  }
  const entries = await timelinesForPopup(event, selection.libraryID);
  if (entries.length === 0) {
    return { kind: "hidden" };
  }
  if (entries.length === 1) {
    return { kind: "flat", entry: entries[0] };
  }
  return { kind: "submenu", entries };
}

/**
 * Rebuilds a submenu from the library's timelines, one entry each.
 *
 * Rebuilt on every open rather than at registration, for the same reason
 * computeMenuShape re-reads the selection every time: a timeline created or
 * renamed while the menu sat registered would otherwise never appear.
 */
function rebuildTimelineSubmenu(
  menu: Element,
  entries: TimelineMenuEntry[],
  onPick: (entry: TimelineMenuEntry) => void,
  itemSuffix: string,
): void {
  const popup = menu.querySelector("menupopup");
  if (!popup) {
    return;
  }
  const doc = menu.ownerDocument as Document & {
    createXULElement: (tag: string) => Element;
  };
  popup.textContent = "";
  for (const entry of entries) {
    const menuitem = doc.createXULElement("menuitem");
    menuitem.setAttribute("label", `${entry.name}${itemSuffix}`);
    menuitem.addEventListener("command", () => onPick(entry));
    popup.appendChild(menuitem);
  }
}

export type TimelineContextLabels = {
  flat: string;
  submenu: string;
};

/**
 * Registers one action twice: a plain entry that acts on the library's one
 * timeline, and a submenu that lists several. Exactly one of the two ever
 * shows, decided fresh on each popup by computeMenuShape; a toolkit menu
 * cannot become a menuitem after registration, so both are registered up
 * front.
 *
 * A selection spanning libraries never reaches `act`: the flat entry stays
 * visible so the refusal is where the user was looking, but disabled, with
 * `computeMenuShape`'s message as its tooltip.
 */
export function registerTimelineContextAction(
  win: _ZoteroTypes.MainWindow,
  id: string,
  labels: TimelineContextLabels,
  icon: string,
  submenuItemSuffix: string,
  act: (timeline: TimelineMenuEntry) => void,
): void {
  function shape(event: Event): Promise<MenuShape> {
    return computeMenuShape(event, win.ZoteroPane.getSelectedItems());
  }

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id,
    label: labels.flat,
    icon,
    commandListener: (event) => {
      void shape(event).then((result) => {
        if (result.kind === "flat") {
          act(result.entry);
        }
      });
    },
    isHidden: async (_elem, event) => {
      const result = await shape(event);
      return result.kind !== "flat" && result.kind !== "disabled";
    },
    isDisabled: async (_elem, event) =>
      (await shape(event)).kind === "disabled",
    onShowing: async (elem, event) => {
      const result = await shape(event);
      if (result.kind === "disabled") {
        elem.setAttribute("tooltiptext", result.message);
      } else {
        elem.removeAttribute("tooltiptext");
      }
    },
  });

  ztoolkit.Menu.register("item", {
    tag: "menu",
    id: `${id}-submenu`,
    popupId: `${id}-popup`,
    label: labels.submenu,
    icon,
    isHidden: async (elem, event) => {
      const result = await shape(event);
      if (result.kind !== "submenu") {
        return true;
      }
      rebuildTimelineSubmenu(
        elem as unknown as Element,
        result.entries,
        act,
        submenuItemSuffix,
      );
      return false;
    },
  });
}
