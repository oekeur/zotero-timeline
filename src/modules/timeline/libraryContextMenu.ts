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
 * Keyed on the popupshowing event, which Zotero.MenuManager passes
 * identically to every entry's onShowing for that one popup, so the flat and
 * submenu forms of both actions share this promise instead of each
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
 * renamed while the menu sat registered would otherwise never appear. The
 * rows carry no zotero-custom-menu-item class, so Zotero.MenuManager, which
 * clears only its own elements from the child popup, leaves them in place.
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

export type TimelineContextAction = {
  /** Unprefixed Fluent ids of the two forms' `.label` messages in
   * mainWindow.ftl. */
  l10n: { flat: string; submenu: string };
  icon: string;
  submenuItemSuffix: string;
  act: (
    timeline: TimelineMenuEntry,
    selection: Zotero.Item[],
    win: _ZoteroTypes.MainWindow,
  ) => void;
};

type ItemMenuEntry =
  _ZoteroTypes.MenuManager.MenuOptions<"main/library/item">["menus"][number];

function windowOf(element: Element): _ZoteroTypes.MainWindow {
  return element.ownerDocument!
    .defaultView as unknown as _ZoteroTypes.MainWindow;
}

/**
 * The popupshowing event of the opening each entry element currently belongs
 * to, cleared when the popup hides. A reveal acts only while its own opening
 * is still current: computeMenuShape can settle after the popup has closed,
 * and showing the entry then would leave it visible for the next opening.
 */
const openingOf = new WeakMap<Element, Event>();

/** Each entry's pending hide-on-close listener, so a reopening replaces it. */
const hideOnClose = new WeakMap<Element, (ev: Event) => void>();

type MenuContext = _ZoteroTypes.MenuManager.BaseMenuContext;

/**
 * Starts an opening: the entry is hidden until its reveal, and hidden again
 * once its popup closes. buildItemContextMenu returns before
 * Zotero.MenuManager runs any hook when an annotation is selected, so an
 * entry left visible by the previous opening would show again, with the
 * command listener Zotero removed on that popup's close: a dead entry.
 *
 * The close is this plugin's own listener rather than MenuManager's onHidden.
 * Zotero adds onHidden as a `once` listener on the item menu that ignores
 * events targeting anything else, so a submenu's own popuphidden, which
 * bubbles up first, uses it up and the item menu's close never reaches it
 * (measured on Zotero 10.0-beta.25: both submenus stayed visible).
 */
function opened(event: Event, context: MenuContext): void {
  const menu = context.menuElem;
  openingOf.set(menu, event);
  context.setVisible(false);
  const popup = menu.parentElement;
  if (!popup) {
    return;
  }
  const previous = hideOnClose.get(menu);
  if (previous) {
    popup.removeEventListener("popuphidden", previous);
  }
  const onClose = (ev: Event) => {
    if (ev.target !== popup) {
      return;
    }
    popup.removeEventListener("popuphidden", onClose);
    hideOnClose.delete(menu);
    openingOf.delete(menu);
    context.setVisible(false);
  };
  hideOnClose.set(menu, onClose);
  popup.addEventListener("popuphidden", onClose);
}

function stillOpen(menu: Element | undefined, event: Event): menu is Element {
  return !!menu && openingOf.get(menu) === event;
}

/**
 * One action's two entries: a plain entry that acts on the library's one
 * timeline, and a submenu that lists several. Exactly one of the two ever
 * shows, decided fresh on each popup by computeMenuShape; a registered entry
 * cannot change its menuType, so both exist up front.
 *
 * A selection spanning libraries never reaches `act`: the flat entry stays
 * visible so the refusal is where the user was looking, but disabled, with
 * `computeMenuShape`'s message as its tooltip.
 *
 * Both entries start hidden and are revealed once computeMenuShape settles.
 * Zotero calls onShowing synchronously and does not await it, so the popup is
 * already open by the time the timelines have been listed.
 */
function entriesFor(action: TimelineContextAction): ItemMenuEntry[] {
  const { l10n, icon, submenuItemSuffix, act } = action;
  const prefix = addon.data.config.addonRef;
  return [
    {
      menuType: "menuitem",
      l10nID: `${prefix}-${l10n.flat}`,
      icon,
      onShowing: (event, context) => {
        opened(event, context);
        void computeMenuShape(event, context.items ?? []).then((result) => {
          const menu = context.menuElem;
          if (!stillOpen(menu, event)) {
            return;
          }
          context.setVisible(
            result.kind === "flat" || result.kind === "disabled",
          );
          context.setEnabled(result.kind !== "disabled");
          if (result.kind === "disabled") {
            menu.setAttribute("tooltiptext", result.message);
          } else {
            menu.removeAttribute("tooltiptext");
          }
        });
      },
      onCommand: (event, context) => {
        const selection = context.items ?? [];
        const win = windowOf(context.menuElem);
        void computeMenuShape(event, selection).then((result) => {
          if (result.kind === "flat") {
            act(result.entry, selection, win);
          }
        });
      },
    },
    {
      menuType: "submenu",
      l10nID: `${prefix}-${l10n.submenu}`,
      icon,
      // Required for a submenu, and left empty: the rows are this plugin's
      // own, rebuilt by onShowing from the library's timelines.
      menus: [],
      onShowing: (event, context) => {
        opened(event, context);
        const selection = context.items ?? [];
        void computeMenuShape(event, selection).then((result) => {
          const menu = context.menuElem;
          if (result.kind !== "submenu" || !stillOpen(menu, event)) {
            return;
          }
          const win = windowOf(menu);
          rebuildTimelineSubmenu(
            menu,
            result.entries,
            (entry) => act(entry, selection, win),
            submenuItemSuffix,
          );
          context.setVisible(true);
        });
      },
    },
  ];
}

/**
 * Registers the item context menu's actions, each as a plain entry and a
 * submenu (see entriesFor), in the order given.
 *
 * One registration rather than one per action: Zotero orders registrations by
 * menuID and keeps array order only within one, so this is what fixes the
 * order the user sees.
 *
 * Once, from onStartup: Zotero.MenuManager builds the entries into every main
 * window's item menu itself, each time that menu is built, and drops the
 * registration when the plugin shuts down, keyed on pluginID.
 */
export function registerTimelineContextActions(
  actions: TimelineContextAction[],
): string | false {
  return Zotero.MenuManager.registerMenu({
    menuID: "library-item-actions",
    pluginID: addon.data.config.addonID,
    target: "main/library/item",
    menus: actions.flatMap(entriesFor),
  });
}
