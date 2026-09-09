/**
 * The Timelines item-pane section: which events cite the selected item,
 * grouped by timeline. Never writes; creating or changing a citation is the
 * event editor's job, in the tab. Clicking a row jumps there and selects the
 * event, which is navigation rather than a write.
 *
 * Reads through documentCache's listTimelinesCached and never around it. An
 * event is the only place a citation is recorded and there is no reverse
 * index by design, so answering "which events cite this" means reading every
 * timeline document in the library; doing that on every selection change
 * would turn arrow-keying down a long item list into thousands of parses.
 * The cache makes a second selection in the same library cost nothing until a
 * document actually changes.
 *
 * "Cited by no event" and "something could not be read" are different
 * answers. A document that will not parse is skipped rather than failing the
 * whole read, but skipping it silently would make it indistinguishable from
 * an item genuinely absent from every timeline, a claim the plugin cannot
 * make. `unreadable` carries that distinction onto the surface.
 *
 * Eligibility mirrors the library context menu's and the source picker's:
 * this plugin's own container, storage and vocabulary notes are never
 * eligible, and neither is an attachment, which is cited through the item it
 * belongs to rather than itself.
 */
import { getLocaleID } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import type { FluentMessageId } from "../../../typings/i10n";
import { listTimelinesCached } from "./documentCache";
import { labelFor, peekVocabulary } from "./vocabulary";
import { labelForSource } from "./sourceLabels";
import {
  CONTAINER_TAG,
  onStorageWrite,
  STORAGE_TAG,
  VOCABULARY_TAG,
} from "./storage";
import { ensureDocumentShowing, getCurrentTimeline } from "./timelineTab";
import type { Event, SourceRef } from "./schema";

const PANE_ID = "zoterotimeline-citing-events";

const PLUGIN_TAGS = [CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG];

export const EMPTY_CLASS = "zoterotimeline-citing-empty";
export const GROUP_CLASS = "zoterotimeline-citing-group";
export const GROUP_HEADING_CLASS = "zoterotimeline-citing-group-heading";
export const LIST_CLASS = "zoterotimeline-citing-list";
export const ROW_CLASS = "zoterotimeline-citing-row";
export const ROW_TITLE_CLASS = "zoterotimeline-citing-row-title";
export const ROW_META_CLASS = "zoterotimeline-citing-row-meta";
export const UNREADABLE_NOTE_CLASS = "zoterotimeline-citing-unreadable-note";

/** Whether `item` could ever be cited: never the plugin's own notes, never an attachment. */
export function isEligibleItem(item: Zotero.Item): boolean {
  return !item.isAttachment() && !PLUGIN_TAGS.some((tag) => item.hasTag(tag));
}

/**
 * The item the pane is displaying right now, read from the pane's own
 * item-details element rather than ZoteroPane.getSelectedItems(): that
 * reports the items list's selection, which is a different thing from what
 * the pane actually shows and has been measured to disagree with it.
 * Undefined when `body` is no longer connected to a pane, which is a stale
 * reference kept past its own teardown rather than the pane's current item.
 */
export function paneItemFor(body: HTMLElement): Zotero.Item | undefined {
  if (!body.isConnected) {
    return undefined;
  }
  const details = body.closest("item-details") as
    | (Element & { item?: Zotero.Item })
    | null;
  return details?.item ?? undefined;
}

function citesItem(source: SourceRef, item: Zotero.Item): boolean {
  return source.libraryID === item.libraryID && source.key === item.key;
}

/** One event citing the selected item, and which of its sources match. */
export type CitingEventEntry = {
  event: Event;
  sources: SourceRef[];
};

/** Every matching event on one timeline. */
export type CitingEventGroup = {
  timelineId: string;
  timelineName: string;
  noteItemID: number;
  entries: CitingEventEntry[];
};

export type CitingEventsResult = {
  /** In listTimelinesCached's own order; empty when nothing cites the item. */
  groups: CitingEventGroup[];
  /** Whether at least one timeline in the library could not be read. */
  unreadable: boolean;
};

/**
 * Every event across the library's timelines that cites `item`, grouped by
 * timeline. Creates nothing: a library with no container yet reads as empty,
 * the same non-creating guarantee listTimelinesCached and peekVocabulary
 * already carry.
 */
export async function findCitingEvents(
  item: Zotero.Item,
): Promise<CitingEventsResult> {
  const { timelines, unreadable } = await listTimelinesCached(item.libraryID);
  const groups: CitingEventGroup[] = [];
  for (const { doc, noteItemID } of timelines) {
    const entries: CitingEventEntry[] = [];
    for (const event of doc.events) {
      const sources = event.sources.filter((source) => citesItem(source, item));
      if (sources.length > 0) {
        entries.push({ event, sources });
      }
    }
    if (entries.length > 0) {
      groups.push({
        timelineId: doc.id,
        timelineName: doc.name,
        noteItemID,
        entries,
      });
    }
  }
  return { groups, unreadable: unreadable.length > 0 };
}

function appendL10nText(
  container: HTMLElement,
  doc: Document,
  id: FluentMessageId,
) {
  const el = doc.createElement("div");
  el.classList.add(EMPTY_CLASS);
  el.setAttribute("data-l10n-id", getLocaleID(id));
  container.appendChild(el);
}

/**
 * How one matching source reads: the reference it names (through
 * sourceLabels.ts, the same resolution the editor's own source list uses,
 * so a note's preview or a missing item reads the same in both places) and
 * its type (through labelFor, so a typeId naming a deleted type reads as the
 * unknown-type label here exactly as it does there).
 */
function sourceLine(
  types: { id: string; label: string }[],
  source: SourceRef,
): string {
  const reference = labelForSource(source);
  const type = labelFor(types, source.typeId);
  const typeText = source.name ? `${type}: ${source.name}` : type;
  return `${reference} — ${typeText}`;
}

/** The slice of a vis Timeline instance a jump needs: the same groupsData
 * DataSet renderCanvas built and the sidebar's own controls write into (not a
 * second copy), and the wrapped setSelection that makes a scripted selection
 * reach the editor panel the way a click does. */
type JumpableTimeline = {
  groupsData: {
    get(id: string): { id: string; visible?: boolean } | null;
    update(data: { id: string; visible: boolean }): unknown;
  };
  setSelection(ids: string[]): void;
};

/**
 * Opens (or reuses) the timeline tab, through timelineTab.ts's
 * ensureDocumentShowing (the same cross-library switch the library context
 * menu's "add to new event" uses - see that module for why the two settle it
 * the same way), then selects the named event on its canvas.
 *
 * Once the tab shows the target, a timeline toggled out of view is toggled
 * back on (a selection on an undrawn item lands nowhere) and nothing else is
 * touched: no other timeline is hidden. Selecting the event through the
 * wrapped setSelection also makes its document the active one (canvas.ts's
 * own handleSelectionChange), so the jump needs no separate activation call.
 */
export async function jumpToEvent(
  win: Window,
  documentId: string,
  eventId: string,
  noteItemID: number,
): Promise<void> {
  try {
    const targetItem = Zotero.Items.get(noteItemID) as Zotero.Item | false;
    if (!targetItem) {
      return;
    }
    const shown = await ensureDocumentShowing(
      win,
      documentId,
      targetItem.libraryID,
    );
    if (!shown) {
      return;
    }
    const timeline = getCurrentTimeline() as JumpableTimeline | undefined;
    if (!timeline) {
      return;
    }
    const group = timeline.groupsData.get(documentId);
    if (group && group.visible === false) {
      timeline.groupsData.update({ id: documentId, visible: true });
    }
    timeline.setSelection([`${documentId}:${eventId}`]);
  } catch (err) {
    logFailure(
      `[zoteroTimeline] failed to jump to event ${eventId} in document ${documentId}: ${(err as Error).message}`,
      err,
    );
  }
}

/**
 * Which call is still owed the right to write into a given container. Keyed
 * by container rather than by item: the item pane reuses the same body
 * element across selections, and arrow-keying fires one call per selection
 * that does not resolve in call order. Set synchronously at the top of every
 * call, so dispatch order (not resolution order) decides which call's answer
 * survives; a call whose generation no longer matches by the time it would
 * write is a superseded selection and writes nothing.
 */
const renderGeneration = new WeakMap<HTMLElement, symbol>();

/**
 * Draws the section body for `item`: nothing found, nothing readable, or the
 * matching events grouped by timeline. `unreadable` is reported alongside a
 * populated list too, not only when it explains an empty one, because a
 * document that failed to parse is true regardless of what the others found.
 */
export async function renderCitingEventsContent(
  container: HTMLElement,
  item: Zotero.Item,
): Promise<void> {
  const generation = Symbol();
  renderGeneration.set(container, generation);
  const doc = container.ownerDocument!;
  container.textContent = "";

  const [{ groups, unreadable }, vocabulary] = await Promise.all([
    findCitingEvents(item),
    peekVocabulary(item.libraryID),
  ]);

  if (renderGeneration.get(container) !== generation) {
    return;
  }

  if (groups.length === 0) {
    appendL10nText(
      container,
      doc,
      unreadable
        ? "item-citing-events-unreadable-state"
        : "item-citing-events-empty-state",
    );
    return;
  }

  for (const group of groups) {
    const section = doc.createElement("div");
    section.classList.add(GROUP_CLASS);

    const heading = doc.createElement("div");
    heading.classList.add(GROUP_HEADING_CLASS);
    heading.textContent = group.timelineName;
    section.appendChild(heading);

    const list = doc.createElement("ul");
    list.classList.add(LIST_CLASS);
    for (const entry of group.entries) {
      const li = doc.createElement("li");
      li.classList.add(ROW_CLASS);
      li.dataset.timelineId = group.timelineId;
      li.dataset.eventId = entry.event.id;
      li.dataset.noteItemId = String(group.noteItemID);
      li.tabIndex = 0;
      const jump = () => {
        void jumpToEvent(
          doc.defaultView as unknown as Window,
          group.timelineId,
          entry.event.id,
          group.noteItemID,
        );
      };
      li.addEventListener("click", jump);
      li.addEventListener("keydown", (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          jump();
        }
      });

      const title = doc.createElement("div");
      title.classList.add(ROW_TITLE_CLASS);
      title.textContent = entry.event.title;
      li.appendChild(title);

      const meta = doc.createElement("div");
      meta.classList.add(ROW_META_CLASS);
      const dateText = entry.event.endDate
        ? `${entry.event.date} – ${entry.event.endDate}`
        : entry.event.date;
      const sourcesText = entry.sources
        .map((source) => sourceLine(vocabulary.types, source))
        .join("; ");
      meta.textContent = `${dateText} · ${sourcesText}`;
      li.appendChild(meta);

      list.appendChild(li);
    }
    section.appendChild(list);
    container.appendChild(section);
  }

  if (unreadable) {
    const note = doc.createElement("div");
    note.classList.add(UNREADABLE_NOTE_CLASS);
    note.setAttribute(
      "data-l10n-id",
      getLocaleID("item-citing-events-unreadable-note"),
    );
    container.appendChild(note);
  }
}

let registeredPaneID: string | false = false;

/**
 * One entry per this section's own DOM element, not per window. Zotero's
 * item pane creates a fresh item-details (and therefore a fresh instance of
 * this section, each with its own body and its own bound `refresh`) not just
 * for the library pane but for every reader or note tab's context pane too
 * (contextPane.js's `_addItemContext`, gated on `Zotero_Tabs.hasContextPane`
 * for both tab types) - all in the same window. Keying on the window instead
 * of the element meant the last one to call `onInit` in a window won last:
 * opening any reader or note tab pointed a storage write's refresh at that
 * tab's copy instead of the library pane's, leaving the library pane stuck
 * showing its answer from before the write.
 */
type PaneInstance = {
  body?: HTMLElement;
  refresh?: () => Promise<void>;
};
const paneInstances = new Map<HTMLElement, PaneInstance>();

let unsubscribeStorageWrite: (() => void) | null = null;

export function registerItemPaneSection(): void {
  registeredPaneID = Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("item-citing-events-section-head-text"),
      icon: "chrome://zotero/skin/16/universal/link.svg",
    },
    sidenav: {
      l10nID: getLocaleID("item-citing-events-section-sidenav-tooltip"),
      icon: "chrome://zoterotimeline/content/icons/timelines-20.svg",
    },
    onItemChange: ({ item, setEnabled }) => {
      setEnabled(isEligibleItem(item));
      return true;
    },
    // Captures the `refresh` Zotero hands this specific section instance, so
    // a storage write can re-render through Zotero's own path (see the
    // onStorageWrite subscriber below) instead of writing into the body
    // itself. Keyed on `body`, which Zotero sets once per element and hands
    // back unchanged to onDestroy, so init and destroy agree on which entry
    // is theirs.
    onInit: ({ body, refresh }) => {
      const instance = paneInstances.get(body) ?? {};
      instance.refresh = refresh;
      paneInstances.set(body, instance);
    },
    // The element this section instance is torn down for - its tab closed,
    // or the section unregistered - stops being a target for a write's
    // refresh. Without this, a closed reader or note tab's entry outlives
    // its element: its `refresh` calls into a disconnected section, which
    // `_handleRefresh`'s `initialized` guard silently no-ops on forever, and
    // its `body` (no longer connected) makes every later write's
    // `paneItemFor` check fail too - neither is a crash, so a leaked entry
    // is invisible until the write it should have routed elsewhere is lost.
    onDestroy: ({ body }) => {
      paneInstances.delete(body);
    },
    // Dispatched from onRender rather than onAsyncRender. Zotero's item pane
    // only calls onAsyncRender for a pane currently scrolled into the
    // container's visible viewport (chrome/content/zotero/elements/
    // itemDetails.js's own isPaneVisible gate); a freshly registered section
    // is appended after every one of Zotero's own, so on any item pane with
    // more than a handful of fields it sits below the fold and never
    // receives a call at all, leaving it permanently empty. onRender carries
    // no such gate: it fires for every selection of an enabled section
    // regardless of scroll position. It cannot itself be async, so it starts
    // the read and lets it finish in the background.
    onRender: ({ body, item }) => {
      const instance = paneInstances.get(body) ?? {};
      instance.body = body;
      paneInstances.set(body, instance);
      void renderCitingEventsContent(body, item);
    },
  });

  // Zotero moves the pane onto a newly written note's parent without
  // reselecting it, so onRender never fires again to pick up a citation just
  // written. Re-reading on every storage write, not just on a selection
  // change, is what keeps the section from reading stale after a write like
  // that.
  //
  // Goes through the section's own `refresh` rather than writing into the
  // body directly. Zotero's own render loop sets `box.item` and disables the
  // section (`box.hidden = true`) BEFORE testing whether to call render, so
  // for an item this section is disabled for - an attachment, or the
  // plugin's own container auto-selected right after this write creates it -
  // the box is hidden, render() is never called, and its cached
  // render-dependency key is therefore never updated to the new item.
  // Writing into the body directly for that item, as an earlier version of
  // this listener did, left the wrong answer sitting in the body: reselecting
  // the original item found its cached dependency key unchanged, skipped
  // rendering entirely, and kept showing the ineligible item's content.
  // `refresh()` runs through the same path a toggled-open section uses: it
  // resets that cached key unconditionally and, while the section is hidden,
  // only marks a render pending rather than touching the body, so the next
  // selection that makes the section visible again is guaranteed to render
  // fresh instead of finding a stale, unchanged key.
  //
  // paneItemFor() is still read fresh at call time to decide whether to
  // refresh at all - `refresh()` itself has no way to say which item or
  // library it would render for, so the library match has to be checked
  // first, against whatever item each live instance's own body currently
  // shows. Every instance is checked, not just one: the library pane and
  // every open reader or note tab's context pane each have their own
  // instance in the same window, and any of them can be showing an item in
  // the write's library.
  // emitStorageWrite runs a snapshot of listeners, so a write inside the same
  // emit that unregisters this section (clearing paneInstances below) can
  // still reach this callback once more; iterating an emptied map is a no-op.
  //
  // A write landing while the instance's own item-details is not the
  // selected Zotero_Tabs tab needs a second lever besides `refresh()`.
  // `refresh()` reaches only this section's own suppressed-render flag: the
  // item-details element sets `skipRender` on every pane it owns (including
  // this one) whenever its tab is not selected, and `_forceRenderAll` takes
  // the `hidden || skipRender` branch, which marks a render pending on the
  // *section* but never touches the item-details element itself. Reselecting
  // the tab later does nothing on its own: item-details' own `_handleTabSelect`
  // clears `skipRender` but calls `render()` again only when item-details'
  // own `_pendingRender` is already true, and nothing sets that flag except
  // item-details' own `render()` running while `skipRender` is set - which
  // this write never triggers. Arming `_pendingRender` directly here is what
  // makes tab reselection pick the write back up.
  unsubscribeStorageWrite = onStorageWrite((libraryID) => {
    for (const instance of paneInstances.values()) {
      const { body, refresh } = instance;
      if (!body || !refresh) {
        continue;
      }
      const item = paneItemFor(body);
      if (!item || item.libraryID !== libraryID) {
        continue;
      }
      void refresh();
      armPendingRenderIfSuppressed(body);
    }
  });
}

/**
 * `_pendingRender` is private state of Zotero's `item-details` element
 * (chrome/content/zotero/elements/itemDetails.js). There is no public API for
 * forcing a suppressed pane to resume rendering; that behaviour lives
 * entirely inside that element's own `notify()`, which this mirrors.
 * Verified against Zotero 10.0-beta.25 (`/opt/zotero-beta/app/application.ini`);
 * re-check this reach against `itemDetails.js` on any Zotero upgrade. Scroll
 * position is deliberately not preserved across a render this triggers: an
 * earlier version tried, and each of three attempts introduced its own
 * cosmetic defect in Zotero's render gating, so this trades a wrong scroll
 * offset for a predictable one.
 */
type ItemDetailsElement = Element & {
  skipRender?: boolean;
  _pendingRender?: boolean;
};

/**
 * See the write subscriber above for why `refresh()` alone leaves a
 * background tab's pane stuck: this arms the containing item-details
 * element's own resume path so reselecting its tab renders the write instead
 * of finding nothing pending.
 */
function armPendingRenderIfSuppressed(body: HTMLElement): void {
  const details = body.closest("item-details") as ItemDetailsElement | null;
  if (details?.skipRender) {
    details._pendingRender = true;
  }
}

export function unregisterItemPaneSection(): void {
  if (unsubscribeStorageWrite) {
    unsubscribeStorageWrite();
    unsubscribeStorageWrite = null;
  }
  paneInstances.clear();
  if (!registeredPaneID) {
    return;
  }
  Zotero.ItemPaneManager.unregisterSection(registeredPaneID);
  registeredPaneID = false;
}
