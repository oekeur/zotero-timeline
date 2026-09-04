/**
 * Main-window "Timeline" tab shell.
 *
 * The tab body is built imperatively into the container `Zotero_Tabs.add()`
 * returns, which already lives in the main window's XUL document. It is
 * deliberately not a chrome document opened as a dialog: a `ztoolkit.Dialog`
 * opens about:blank, which carries no Fluent strings (every label renders
 * empty), sizes itself on a timer an async render outlasts, and will not open
 * an HTML select's dropdown at all. Rendering into the tab container sidesteps
 * all three, because it is the same document the item pane already uses.
 */
import { getLocaleID, getString } from "../../utils/locale";
import {
  ensureDocumentHead,
  ensureWindowGlobals,
} from "../../utils/windowGlobals";
import { ensureStylesheet } from "../../utils/stylesheet";
import { logFailure } from "../../utils/logging";
import { listTimelinesCached } from "./documentCache";
import {
  createTimeline,
  deleteTimeline,
  hasHiddenTimelineData,
  renameTimeline,
  searchStorageNotes,
  StorageError,
  type StoredTimeline,
  type UnreadableTimeline,
} from "./storage";
import { warn } from "./containerGuard";
import { renderEventEditor, type EventEditorChange } from "./eventEditor";
import { collectVisibleTags, renderTagFilter } from "./tagFilter";
import { serializeDocument, type TimelineDocument } from "./schema";
import { toTimelineRange } from "../../utils/edtfRange";

const TAB_TYPE = "zoterotimeline-timeline";
const MENU_ID = "zotero-timeline-menuitem-open-timeline";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const TIMELINE_SHORTCUT = "shift,t";

// The tab shell's classes, styled in addon/content/zoteroPane.css. Exported
// rather than written as literals at the point of use so a test or a later
// surface names the same string the sheet does.
export const TAB_BODY_CLASS = "zoterotimeline-tab-body";
export const TAB_HEADER_CLASS = "zoterotimeline-tab-header";
export const TAB_ROW_CLASS = "zoterotimeline-tab-row";
export const CANVAS_CLASS = "zoterotimeline-canvas";
export const EDITOR_CLASS = "zoterotimeline-editor";
export const SIDEBAR_CLASS = "zoterotimeline-sidebar";
export const SIDEBAR_HEADING_ROW_CLASS = "zoterotimeline-sidebar-heading-row";
export const SIDEBAR_HEADING_CLASS = "zoterotimeline-sidebar-heading";
export const SIDEBAR_CREATE_BUTTON_CLASS =
  "zoterotimeline-sidebar-create-button";
export const SIDEBAR_CREATE_FORM_CLASS = "zoterotimeline-sidebar-create-form";
export const SIDEBAR_CREATE_NAME_INPUT_CLASS =
  "zoterotimeline-sidebar-create-name";
export const SIDEBAR_CREATE_ACTIONS_CLASS =
  "zoterotimeline-sidebar-create-actions";
export const SIDEBAR_CREATE_CONFIRM_CLASS =
  "zoterotimeline-sidebar-create-confirm";
export const SIDEBAR_CREATE_CANCEL_CLASS =
  "zoterotimeline-sidebar-create-cancel";
export const SIDEBAR_ROW_CLASS = "zoterotimeline-sidebar-row";
export const SIDEBAR_ROW_UNREADABLE_CLASS =
  "zoterotimeline-sidebar-row-unreadable";
export const SIDEBAR_ROW_LABEL_CLASS = "zoterotimeline-sidebar-row-label";
export const SIDEBAR_ROW_VISIBLE_CLASS = "zoterotimeline-sidebar-row-visible";
export const SIDEBAR_ROW_NAME_CLASS = "zoterotimeline-sidebar-row-name";
export const SIDEBAR_ROW_MOVE_UP_CLASS = "zoterotimeline-sidebar-row-move-up";
export const SIDEBAR_ROW_MOVE_DOWN_CLASS =
  "zoterotimeline-sidebar-row-move-down";
export const SIDEBAR_ROW_RENAME_CLASS = "zoterotimeline-sidebar-row-rename";
export const SIDEBAR_ROW_DELETE_CLASS = "zoterotimeline-sidebar-row-delete";
export const SIDEBAR_ROW_RENAME_FORM_CLASS =
  "zoterotimeline-sidebar-row-rename-form";
export const SIDEBAR_ROW_RENAME_NAME_INPUT_CLASS =
  "zoterotimeline-sidebar-row-rename-name";
export const SIDEBAR_ROW_RENAME_CONFIRM_CLASS =
  "zoterotimeline-sidebar-row-rename-confirm";
export const SIDEBAR_ROW_RENAME_CANCEL_CLASS =
  "zoterotimeline-sidebar-row-rename-cancel";
export const CANVAS_EMPTY_PROMPT_CLASS = "zoterotimeline-canvas-empty-prompt";
export const READ_ONLY_BANNER_CLASS = "zoterotimeline-read-only-banner";
export const CANVAS_COLUMN_CLASS = "zoterotimeline-canvas-column";
export const CHROME_CLASS = "zoterotimeline-canvas-chrome";
export const ZOOM_IN_BUTTON_CLASS = "zoterotimeline-zoom-in";
export const ZOOM_OUT_BUTTON_CLASS = "zoterotimeline-zoom-out";
export const FIT_BUTTON_CLASS = "zoterotimeline-fit";
export const JUMP_INPUT_CLASS = "zoterotimeline-jump-date";
export const JUMP_BUTTON_CLASS = "zoterotimeline-jump-go";
export const JUMP_ERROR_CLASS = "zoterotimeline-jump-error";

let timelineTabID: string | undefined;
let teardownTimeline: (() => void) | undefined;
// The canvas-refresh observer's registration id. Module-level because the
// tab's onClose is defined before the observer is registered and has to be
// able to release it; a closure over a later const would sit in its temporal
// dead zone if the render threw before registration.
let refreshObserverID: string | undefined;
// How many rebuilds actually redrew, suppressed ones excluded. Exposed the
// same way documentCache's parsesSoFar is and for the same reason: the
// suppression and the single-flight coalescing are both defined by a count,
// and a spec cannot observe either from the rendered DOM alone.
let rebuildCount = 0;
// The open tab's own notify, exposed so a spec can drive the exact function
// the observer registers rather than reaching into Zotero.Notifier's
// internals. documentCache's cacheObserverForTesting is the same seam for
// the same reason. Undefined whenever no tab is open.
type RefreshNotify = (
  event: _ZoteroTypes.Notifier.Event,
  type: _ZoteroTypes.Notifier.Type,
  ids: string[] | number[],
) => void;
let refreshNotify: RefreshNotify | undefined;
// Exposed for the live-Zotero suite, which needs to drive selection before it
// can drive a drag.
let currentTimeline: unknown;
let moduleEvalEnv: unknown;
let canvasModule: unknown;
// The vis groups DataSet renderCanvas built, and the readable timelines it
// was built from. Both module-level for the same reason currentTimeline is:
// getVisibleTimelines() is called by the live-Zotero suite against the
// plugin's own running instance, not the test bundle's separate copy of this
// module.
let timelineGroups: unknown;
let readableTimelines: StoredTimeline[] = [];
// canvas.ts's own accessor for its active-document state (TASK-16) - kept as
// a function reference, the same reason timelineGroups is module-level,
// rather than a mirrored id here that could drift from the one canvas.ts
// actually acts on.
let getActiveDocumentId: (() => string | null) | undefined;
// The tags currently chosen to filter by. Module-level for the same reason
// as readableTimelines - getSelectedTagFilter() and getAvailableTags() are
// called by the live-Zotero suite and by the canvas tag filter against the plugin's own
// running instance - and reset to empty on tab close, never on anything else:
// this is view state, so it does not ride sync, does not survive a tab close,
// and is never written to a document.
let selectedTagFilter = new Set<string>();

export function getModuleEvalEnv(): any {
  return moduleEvalEnv;
}

/**
 * The document id of the timeline every write gesture currently applies to,
 * or null when nothing is visible to be active. Exposed for the live-Zotero
 * suite; canvas.ts's own `getActiveDocument` is the actual source.
 */
export function getActiveTimeline(): string | null {
  return getActiveDocumentId?.() ?? null;
}

/**
 * How many times the canvas has actually been redrawn by a rebuild. Counts
 * only rebuilds that got past content-identity suppression, so a spec can tell
 * "no rebuild happened" from "a rebuild ran and changed nothing".
 */
export function rebuildsSoFar(): number {
  return rebuildCount;
}

/**
 * The open tab's canvas-refresh notify, or undefined when no tab is open.
 * Exported for the live suite, which needs to deliver the second of the two
 * notifications Zotero fires per save without waiting for a real one.
 */
export function refreshObserverForTesting(): RefreshNotify | undefined {
  return refreshNotify;
}

type ConfirmDeleteFn = (
  win: mozIDOMWindowProxy,
  title: string,
  message: string,
) => boolean;

const defaultConfirmTimelineDelete: ConfirmDeleteFn = (win, title, message) =>
  Services.prompt.confirm(win, title, message);

let confirmTimelineDelete: ConfirmDeleteFn = defaultConfirmTimelineDelete;

/**
 * Overrides the delete confirmation dialog, the same seam
 * vocabularySettings.ts's setConfirmDeleteForTests gives its own delete flow
 * and for the same reason: Services.prompt is native XPCOM, not a plugin-owned
 * object, so a live spec cannot safely monkey-patch it directly. Called with
 * no argument, this restores the real dialog.
 */
export function setTimelineDeleteConfirmForTests(fn?: ConfirmDeleteFn): void {
  confirmTimelineDelete = fn ?? defaultConfirmTimelineDelete;
}

// Re-exported through the lazily loaded module rather than imported at the top
// of this file. A single static import of ./canvas anywhere in the bundle
// makes esbuild evaluate it at load, which defeats the deferral below and
// leaves Hammer frozen with no window.
export function getLastMovePayload(): any {
  return (canvasModule as any)?.getLastMovePayload?.();
}

export function getCurrentTimeline(): any {
  return currentTimeline;
}

/**
 * Every visible timeline, topmost first - the one place this is computed, for
 * TASK-16 (picking the topmost still-visible timeline when the active one is
 * toggled off) and by the tag control (which tags to offer). Reads the vis groups
 * DataSet's own `order` and `visible` fields rather than a second copy of
 * either: the sidebar's toggle and reorder controls write those fields
 * directly, so this is always current with no merge step of its own.
 */
export function getVisibleTimelines(): StoredTimeline[] {
  if (!timelineGroups) {
    return [];
  }
  const rows = (
    timelineGroups as {
      get: (opts: { order: string }) => Array<{
        id: string;
        visible?: boolean;
      }>;
    }
  ).get({ order: "order" });
  return rows
    .filter((group) => group.visible !== false)
    .map((group) =>
      readableTimelines.find((t) => t.doc.id === String(group.id)),
    )
    .filter((t): t is StoredTimeline => t !== undefined);
}

/**
 * The tags offered by the tag filter right now: the union of tags on events
 * in `getVisibleTimelines()`, which is what makes the offered set shrink the
 * moment a timeline carrying a tag is toggled out of view. Exposed for the
 * live-Zotero suite and for the canvas tag filter, which reads the same set to know what a
 * chip's absence means.
 */
export function getAvailableTags(): string[] {
  return collectVisibleTags(getVisibleTimelines());
}

/**
 * The tags currently chosen to filter by, sorted. Empty means no filter is
 * active - the filter shows every event in that state, never zero of them: an
 * empty selection is "not filtering", not "select nothing".
 */
export function getSelectedTagFilter(): string[] {
  return Array.from(selectedTagFilter).sort();
}

/**
 * The pane's own selected library, the way ZoteroPane exposes it.
 * zotero-types still declares `getSelectedLibraryID()`, but current Zotero
 * removed it in favour of `getSelectedLibraryIDs()` (plural, multi-library
 * selection) and the singular now throws unconditionally - confirmed against
 * the running Zotero rather than the stale typings. Falls back to the user
 * library so a tab opened before the pane has a selection still has
 * somewhere to load timelines from.
 */
function resolveLibraryID(win: Window): number {
  const zoteroPane = (win as unknown as _ZoteroTypes.MainWindow).ZoteroPane as
    | { getSelectedLibraryIDs?: () => number[] }
    | undefined;
  return (
    zoteroPane?.getSelectedLibraryIDs?.()[0] ?? Zotero.Libraries.userLibraryID
  );
}

// Stored, synced data rather than UI text, so it stays untranslated - the same
// reason storage.ts's CONTAINER_TITLE does.
const DEFAULT_TIMELINE_NAME = "Timeline";

/**
 * Creates a timeline, or warns instead when the container turned out to be
 * trashed.
 *
 * The container can land in the trash between an earlier emptiness check and
 * this call - a real ordering, not a theoretical one - so the write path's
 * own container-trashed refusal is caught here rather than left to surface as
 * an unhandled rejection in the tab.
 */
async function createTimelineOrWarn(
  name: string,
  libraryID: number,
): Promise<{ item: Zotero.Item; doc: TimelineDocument } | null> {
  try {
    return await createTimeline(name, libraryID);
  } catch (err) {
    if (err instanceof StorageError && err.reason === "container-trashed") {
      warn(getString("timeline-data-trashed-open"));
      return null;
    }
    throw err;
  }
}

/**
 * Gives a library with no timeline yet its first one, so the tab lands on a
 * usable canvas rather than an empty state nobody asked for.
 *
 * An empty listing has two causes needing opposite answers. A library that
 * genuinely holds nothing wants a timeline. A library whose container or
 * notes are only in the trash looks identical from a listing's side, and
 * creating there would hand the user a blank timeline while the one they had
 * sat unreachable - which reads as the plugin having erased their work. So
 * that case is reported and left alone; restoring from the trash is the only
 * fix, and that is the user's to do.
 *
 * Creates nothing in a library the user cannot write, the same rule every
 * other control that writes a document follows: opening the tab is the
 * request, not a bypass of it.
 */
async function createDefaultTimelineIfNeeded(libraryID: number): Promise<void> {
  if ((await searchStorageNotes(libraryID)).length > 0) {
    return;
  }
  if (await hasHiddenTimelineData(libraryID)) {
    warn(getString("timeline-data-trashed-open"));
    return;
  }
  const library = Zotero.Libraries.get(libraryID);
  if (!library || !library.editable) {
    return;
  }
  await createTimelineOrWarn(DEFAULT_TIMELINE_NAME, libraryID);
}

const VIS_STYLESHEET_ID = "zoterotimeline-vis-stylesheet";
const VIS_STYLESHEET_URL = "chrome://zoterotimeline/content/vis-timeline.css";
const VIS_OVERRIDES_ID = "zoterotimeline-vis-overrides";
const VIS_OVERRIDES_URL =
  "chrome://zoterotimeline/content/vis-timeline-overrides.css";

/**
 * vis-timeline ships its stylesheet inside the bundle and injects it with a
 * `styleInject` helper guarded by `typeof document === "undefined"`. The CSS is
 * vendored into addon/content/ and linked here instead of relying on that.
 *
 * The link is kept deliberately, and the reason is no longer the one this
 * comment used to give. It claimed the guard holds because Zotero's bootstrap
 * scope has no `document`. That is not what happens on the current code path:
 * ./canvas is imported dynamically at tab open, after ensureWindowGlobals has
 * installed `document` on globalThis, so styleInject does run and does inject
 * its own <style> blocks. Measured on Zotero 10.0-beta.25: commenting the link
 * out changed the render on neither a hot reload nor a cold start.
 *
 * It stays anyway. Dropping it would make styling depend on an import-order
 * invariant nothing enforces, and the CI matrix still builds against Zotero 7,
 * 8 and 9, where the bundle may well evaluate somewhere `document` is absent
 * and the guard bites for real. One <link> is a cheap insurance premium
 * against a failure whose only symptom is an unstyled timeline.
 *
 * The overrides sheet is appended second and must stay second: it restates
 * vendored colours at equal specificity and wins only on document order.
 */
function ensureVisStylesheets(doc: Document): void {
  ensureStylesheet(doc, VIS_STYLESHEET_ID, VIS_STYLESHEET_URL);
  ensureStylesheet(doc, VIS_OVERRIDES_ID, VIS_OVERRIDES_URL);
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
): HTMLElementTagNameMap[K] {
  return doc.createElementNS(
    HTML_NS,
    tag,
  ) as unknown as HTMLElementTagNameMap[K];
}

export async function openTimelineTab(): Promise<void> {
  const Zotero_Tabs = ztoolkit.getGlobal("Zotero_Tabs");

  if (
    timelineTabID &&
    Zotero_Tabs._tabs.some((t: any) => t.id === timelineTabID)
  ) {
    Zotero_Tabs.select(timelineTabID);
    return;
  }

  const { id, container } = Zotero_Tabs.add({
    type: TAB_TYPE,
    title: getString("timeline-tab-label"),
    data: {},
    select: true,
    onClose: () => {
      timelineTabID = undefined;
      if (refreshObserverID) {
        Zotero.Notifier.unregisterObserver(refreshObserverID);
        refreshObserverID = undefined;
      }
      refreshNotify = undefined;
      teardownTimeline?.();
      teardownTimeline = undefined;
      currentTimeline = undefined;
      timelineGroups = undefined;
      readableTimelines = [];
      getActiveDocumentId = undefined;
      selectedTagFilter = new Set();
    },
  });
  timelineTabID = id;

  const doc = container.ownerDocument!;
  const win = doc.defaultView!;

  // Before anything from the bundle touches the DOM. ensureDocumentHead
  // matters because the XUL document has no <head> and stylesheet injection
  // assumes one.
  ensureDocumentHead(doc);
  ensureWindowGlobals(win);
  ensureVisStylesheets(doc);

  const body = el(doc, "div");
  body.classList.add(TAB_BODY_CLASS);
  container.appendChild(body as unknown as Node);

  // A slot for tab-level messages, empty unless something needs saying. It
  // carried a heading and a note describing TASK-4's rendering spike, which
  // stopped being true the moment the spike became the real tab: it promised
  // a hardcoded four-event fixture over a canvas built from stored documents,
  // and that mismatch cost one real misdiagnosis (TASK-56).
  //
  // Nothing replaced it. The tab bar already names the tab, the sidebar is
  // headed Timelines, each lane carries its own name, and TASK-41's controls
  // sit above the canvas; a heading over all of that is a fourth piece of
  // chrome saying nothing new, on the surface that is the product. The read-
  // only banner still needs somewhere to go, so the container stays and takes
  // no height while it is empty.
  const header = el(doc, "div");
  header.classList.add(TAB_HEADER_CLASS);
  body.appendChild(header as unknown as Node);

  // Sidebar, canvas and editor sit side by side, so selecting an event never
  // reflows the canvas out from under the pointer.
  const row = el(doc, "div");
  row.classList.add(TAB_ROW_CLASS);
  body.appendChild(row as unknown as Node);

  const sidebar = el(doc, "div");
  sidebar.id = "zoterotimeline-sidebar";
  sidebar.classList.add(SIDEBAR_CLASS);
  row.appendChild(sidebar as unknown as Node);

  // A column so the chrome strip spans the canvas and nothing else: putting
  // it in `row` would stretch it across the sidebar and the editor too, and
  // putting it in `header` would sit it above all three.
  const canvasColumn = el(doc, "div");
  canvasColumn.classList.add(CANVAS_COLUMN_CLASS);
  row.appendChild(canvasColumn as unknown as Node);

  const canvas = el(doc, "div");
  canvas.id = "zoterotimeline-canvas";
  // The rule behind CANVAS_CLASS carries two declarations that are behaviour
  // rather than appearance, and zoteroPane.css says why at length: position:
  // relative is what vis-timeline's absolutely positioned layers resolve
  // against, and min-height/min-width: 0 is what lets the canvas shrink
  // instead of overflowing the row. Neither is safe to drop as styling.
  canvas.classList.add(CANVAS_CLASS);
  canvasColumn.appendChild(canvas as unknown as Node);

  const panel = el(doc, "div");
  panel.id = "zoterotimeline-editor";
  panel.classList.add(EDITOR_CLASS);
  row.appendChild(panel as unknown as Node);

  // Imported HERE, not at the top of the file, and this is load-bearing.
  //
  // Hammer, which vis-timeline uses for every pointer gesture, resolves its
  // window once at module scope:
  //
  //   var win; if (typeof window === "undefined") { win = {} } else { win = window }
  //   var TEST_ELEMENT = typeof document === "undefined" ? {style:{}} : ...
  //
  // In Zotero's bootstrap scope neither global exists when the plugin bundle
  // loads, so a static import freezes win = {} and a fake TEST_ELEMENT. Its
  // feature detection is then permanently wrong and no gesture is ever
  // recognised: clicking does not select and dragging does nothing, with no
  // error anywhere. Shimming the globals at tab-open is too late, because the
  // module has already evaluated.
  //
  // A dynamic import defers evaluation until after ensureWindowGlobals above,
  // so Hammer sees the real window. esbuild keeps it lazy rather than hoisting
  // it back to load time.
  const mod = await import("./canvas");
  const { renderCanvas, buildTimelineItem, parseVisItemId, visItemId } = mod;
  canvasModule = mod;
  moduleEvalEnv = mod.MODULE_EVAL_ENV;
  Zotero.debug(
    `[ZoteroTimeline] vis module evaluated with ${JSON.stringify(moduleEvalEnv)}`,
  );

  const libraryID = resolveLibraryID(win);
  // Opening the tab is itself the request for a timeline in this library, the
  // one exception to every other surface's rule of creating nothing just by
  // being opened - see createDefaultTimelineIfNeeded.
  await createDefaultTimelineIfNeeded(libraryID);
  const openedLibrary = Zotero.Libraries.get(libraryID);
  const libraryEditable = openedLibrary ? openedLibrary.editable : false;

  // The read-only reason, in words, on the surface itself - not implied by
  // whichever controls end up disabled. Named by the library rather than a
  // generic message, and present only when the library actually refuses
  // writes, so the tab's ordinary shape is undisturbed for every other
  // library.
  if (!libraryEditable) {
    const banner = el(doc, "div");
    banner.classList.add(READ_ONLY_BANNER_CLASS);
    banner.textContent = getString("timeline-read-only-banner", {
      args: { library: openedLibrary ? openedLibrary.name : "" },
    });
    header.appendChild(banner as unknown as Node);
  }

  const { timelines, unreadable } = await listTimelinesCached(libraryID);
  readableTimelines = timelines;
  // Keyed by document id, and kept up to date on every save/delete, so a
  // re-selection after an edit shows what was just written rather than what
  // was loaded when the tab opened.
  const documents = new Map<string, TimelineDocument>(
    timelines.map((t) => [t.doc.id, t.doc]),
  );

  // The typed create form's target list - every document rendered as a
  // canvas row, the same set click-to-create can land in.
  function creatableDocuments() {
    return {
      libraryID,
      documents: Array.from(documents.values()).map((d) => ({
        id: d.id,
        name: d.name,
      })),
    };
  }

  function showEditorFor(itemId: string | null): void {
    if (!itemId) {
      renderEventEditor(
        panel as unknown as HTMLElement,
        null,
        onEditorChange,
        creatableDocuments(),
        libraryEditable,
      );
      return;
    }
    const { documentId, eventId } = parseVisItemId(itemId);
    const targetDoc = documents.get(documentId);
    const event = targetDoc?.events.find((e) => e.id === eventId);
    if (!targetDoc || !event) {
      renderEventEditor(
        panel as unknown as HTMLElement,
        null,
        onEditorChange,
        creatableDocuments(),
        libraryEditable,
      );
      return;
    }
    renderEventEditor(
      panel as unknown as HTMLElement,
      { documentId, libraryID, event },
      onEditorChange,
      undefined,
      libraryEditable,
    );
  }

  function onEditorChange(change: EventEditorChange): void {
    const targetDoc = documents.get(change.documentId);
    if (!targetDoc) {
      return;
    }
    if (change.kind === "saved") {
      const index = targetDoc.events.findIndex((e) => e.id === change.event.id);
      if (index !== -1) {
        targetDoc.events[index] = change.event;
      }
      items.update(
        buildTimelineItem(
          change.documentId,
          change.event,
          undefined,
          libraryEditable,
        ),
      );
    } else if (change.kind === "created") {
      targetDoc.events = [...targetDoc.events, change.event];
      items.add(
        buildTimelineItem(
          change.documentId,
          change.event,
          undefined,
          libraryEditable,
        ),
      );
      // Selecting the new event re-renders the panel into the normal edit
      // form, the same hand-off click-to-create's own setSelection makes.
      timeline.setSelection([visItemId(change.documentId, change.event.id)]);
    } else {
      targetDoc.events = targetDoc.events.filter(
        (e) => e.id !== change.eventId,
      );
      items.remove(visItemId(change.documentId, change.eventId));
      // The wrapped setSelection re-renders the panel as empty on its own.
      timeline.setSelection([]);
    }
    // An edit made HERE changes which tags exist, and nothing else was going
    // to notice. The chip bank is recomputed inside renderSidebar, which runs
    // after a toggle, a reorder, and after the refresh observer rebuilds -
    // but that observer compares the stored document against what is drawn
    // and returns early when they match, which is precisely the case one
    // moment after this tab wrote the change itself. So a tag added through
    // the editor persisted correctly and never appeared as a chip until the
    // tab was closed and reopened.
    //
    // All three kinds, not just "saved": a created event can carry tags, and
    // deleting the last event holding a tag has to retire its chip. Cheap
    // enough to run unconditionally - the alternative is diffing tag sets to
    // avoid a small DOM rebuild nobody has measured as a cost.
    renderSidebar();
  }

  // After the container is in the document. vis-timeline measures its parent
  // immediately, and a detached element measures zero, which renders as a
  // blank tab rather than an error.
  // `let`, not `const`: TASK-43's rebuild destroys the vis instance and calls
  // renderCanvas again, and every nested function below closes over these
  // bindings. Reassigning them is what lets a rebuild swap the instance
  // without rewriting the several dozen call sites that reference it.
  let {
    timeline,
    items,
    groups,
    activateDocument: activateTimeline,
    getActiveDocument,
    setTagFilter,
  } = renderCanvas(
    canvas as unknown as HTMLElement,
    timelines,
    libraryID,
    libraryEditable,
    showEditorFor,
    // canvas.ts keeps its own copy of every document for onMove's write-back;
    // a create there replaces that copy with a freshly written one rather
    // than mutating in place, so this map needs the same replacement, or
    // showEditorFor can't find the event a click-to-create just made before
    // it calls showEditorFor to open it.
    (doc) => documents.set(doc.id, doc),
  );
  currentTimeline = timeline;
  timelineGroups = groups;
  getActiveDocumentId = getActiveDocument;
  teardownTimeline = () => {
    try {
      timeline.destroy();
    } catch {
      // The window may already be gone; nothing to release in that case.
    }
  };

  /**
   * Everything that lives on the vis instance and would go with it.
   *
   * Enumerated rather than assumed. A rebuild destroys the instance, so any
   * state held there and nowhere else is lost: the selection and the active
   * lane are the two the acceptance criteria name, but the viewport and the
   * per-lane visible/order flags the sidebar writes are held there too. A user
   * zoomed into one decade who receives a sync from another machine would
   * otherwise be thrown back to fit-all, and a lane they had toggled off would
   * come back on.
   */
  function captureCanvasState() {
    return {
      active: getActiveDocument(),
      selection: (
        timeline as unknown as { getSelection: () => string[] }
      ).getSelection(),
      window: (
        timeline as unknown as {
          getWindow: () => { start: Date | number; end: Date | number };
        }
      ).getWindow(),
      lanes: documentGroupRows().map((g, index) => ({
        id: g.id,
        visible: g.visible,
        order: index,
      })),
    };
  }

  function restoreCanvasState(state: ReturnType<typeof captureCanvasState>) {
    // Lanes first: activating or selecting into a lane that is not drawn yet
    // lands nowhere.
    const present = new Set(documentGroupRows().map((g) => g.id));
    const known = state.lanes.filter((l) => present.has(l.id));
    if (known.length > 0) {
      groupsDS().update(known);
    }
    if (state.active && present.has(state.active)) {
      activateTimeline(state.active);
    }
    const live = state.selection.filter((id) =>
      present.has(parseVisItemId(id).documentId),
    );
    if (live.length > 0) {
      (
        timeline as unknown as { setSelection: (ids: string[]) => void }
      ).setSelection(live);
    }
    (
      timeline as unknown as {
        setWindow: (
          start: Date | number,
          end: Date | number,
          options?: { animation?: boolean },
        ) => void;
      }
    ).setWindow(state.window.start, state.window.end, { animation: false });
  }

  /**
   * The thin strip of controls above the canvas (TASK-41).
   *
   * Thin is the constraint: the canvas is the product, so this is a single
   * row of 16px controls, not a ribbon. Ctrl+scroll already zooms
   * (zoomKey: "ctrlKey"); these exist because a gesture nobody can see is a
   * gesture nobody finds.
   *
   * Icon-only buttons carry their label as a Fluent `.title` attribute rather
   * than as a value: a plain-value message on an element with children
   * replaces the <img> inside it.
   */
  function buildChrome(): HTMLElement {
    const chrome = el(doc, "div");
    chrome.classList.add(CHROME_CLASS);

    const iconButton = (
      cls: string,
      messageId: Parameters<typeof getLocaleID>[0],
      iconURL: string,
      onClick: () => void,
    ) => {
      const button = el(doc, "button");
      button.type = "button";
      button.classList.add(cls);
      button.setAttribute("data-l10n-id", getLocaleID(messageId));
      const icon = doc.createElementNS(HTML_NS, "img") as HTMLImageElement;
      icon.src = iconURL;
      button.appendChild(icon as unknown as Node);
      button.addEventListener("click", onClick);
      chrome.appendChild(button as unknown as Node);
      return button;
    };

    iconButton(
      ZOOM_OUT_BUTTON_CLASS,
      "timeline-chrome-zoom-out",
      "chrome://zotero/skin/16/universal/minus.svg",
      () => timeline.zoomOut(0.5, { animation: false }),
    );
    iconButton(
      ZOOM_IN_BUTTON_CLASS,
      "timeline-chrome-zoom-in",
      "chrome://zotero/skin/16/universal/plus.svg",
      () => timeline.zoomIn(0.5, { animation: false }),
    );
    // Zotero ships nothing that means "frame everything", so this one is the
    // plugin's own, drawn to Zotero's conventions (fill="none" root, shapes
    // fill="context-fill") so it tracks light and dark for free.
    iconButton(
      FIT_BUTTON_CLASS,
      "timeline-chrome-fit",
      "chrome://zoterotimeline/content/icons/fit-16.svg",
      () => timeline.fit({ animation: false }),
    );

    const jumpInput = el(doc, "input") as HTMLInputElement;
    jumpInput.type = "text";
    jumpInput.classList.add(JUMP_INPUT_CLASS);
    jumpInput.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-chrome-jump-input"),
    );
    chrome.appendChild(jumpInput as unknown as Node);

    const jumpError = el(doc, "span");
    jumpError.classList.add(JUMP_ERROR_CLASS);

    // Moves the window and touches nothing else. Not a search: it selects no
    // event, and an event sitting on the date is not privileged over one that
    // is not.
    function jump(): void {
      const raw = jumpInput.value.trim();
      // Clearing needs both: removing the id does not blank the text Fluent
      // already wrote into the node.
      jumpError.removeAttribute("data-l10n-id");
      jumpError.textContent = "";
      if (raw === "") {
        return;
      }
      let target: Date;
      try {
        target = toTimelineRange(raw).start;
      } catch {
        // Deliberately not edtf's own message. It is a full grammar dump,
        // dozens of lines of expected-token alternatives, which is diagnostic
        // output rather than something to put in a toolbar. The stored date
        // is never rewritten or refused elsewhere in this plugin and nothing
        // is written here either; this only declines to move the view.
        jumpError.setAttribute(
          "data-l10n-id",
          getLocaleID("timeline-chrome-jump-error"),
        );
        return;
      }
      // Keep the current span, so a jump changes where the view is and not
      // how far it reaches.
      const view = timeline.getWindow();
      const span = view.end.valueOf() - view.start.valueOf();
      const centre = target.valueOf();
      timeline.setWindow(centre - span / 2, centre + span / 2, {
        animation: false,
      });
    }

    const jumpButton = el(doc, "button");
    jumpButton.type = "button";
    jumpButton.classList.add(JUMP_BUTTON_CLASS);
    jumpButton.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-chrome-jump-button"),
    );
    jumpButton.addEventListener("click", jump);
    chrome.appendChild(jumpButton as unknown as Node);
    chrome.appendChild(jumpError as unknown as Node);

    jumpInput.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        jump();
      }
    });

    return chrome;
  }

  canvasColumn.insertBefore(
    buildChrome() as unknown as Node,
    canvas as unknown as Node,
  );

  /**
   * Whether the stored documents are byte-identical to what is drawn.
   *
   * The suppression AC #2 asks for, and the reason it compares content rather
   * than consulting a "currently writing" flag: Zotero fires modify twice per
   * save, once inside the transaction and once a macrotask after commit, so a
   * flag cleared when the write resolves never covers the second one.
   *
   * Compared here rather than through documentCache's matchesCached, which
   * looks the right tool and is not. That helper reads the cache entry, and
   * the cache's own observer deletes exactly those entries on the same
   * notification. Notifier observers have no defined order, so matchesCached
   * would return false whenever the cache ran first, which is to say
   * unpredictably, and the suppression would silently stop working. Comparing
   * the freshly read documents against the drawn ones needs no such ordering.
   */
  function drawnMatches(fresh: StoredTimeline[]): boolean {
    if (fresh.length !== documents.size) {
      return false;
    }
    return fresh.every((t) => {
      const drawn = documents.get(t.doc.id);
      return (
        drawn !== undefined &&
        serializeDocument(drawn) === serializeDocument(t.doc)
      );
    });
  }

  /**
   * Redraws the canvas from what the notes currently hold.
   *
   * A full teardown and re-render, the same shape mindmap's rebuild has. The
   * cheaper in-place update was not chosen here: the documents behind a
   * rebuild can differ from what is drawn by more than event positions (a
   * timeline can appear, vanish, or stop parsing), and reconciling that
   * against live DataSets is the kind of second implementation of the read
   * path this data model exists to avoid. Cost is measured rather than
   * assumed - see this task's notes.
   *
   * Throws nothing. A caller is an observer that must not fail, and a note
   * that stopped parsing between the notification and here leaves the previous
   * render standing rather than blanking the tab.
   */
  async function rebuildCanvas(): Promise<void> {
    let fresh;
    try {
      fresh = await listTimelinesCached(libraryID);
    } catch (err) {
      Zotero.debug(
        `[ZoteroTimeline] rebuild aborted, the library would not read: ${
          (err as Error)?.message ?? String(err)
        }`,
      );
      return;
    }

    // A note this tab drew that no longer parses leaves the previous render
    // standing rather than being quietly dropped from the canvas. Redrawing
    // without it would make a timeline vanish on a corrupt or half-synced
    // write, which looks like data loss and is not: the note is still there
    // and the next readable write brings it back.
    const drawnNotes = new Set(readableTimelines.map((t) => t.noteItemID));
    const stoppedParsing = fresh.unreadable.filter((u) =>
      drawnNotes.has(u.noteItemID),
    );
    if (stoppedParsing.length > 0) {
      Zotero.debug(
        `[ZoteroTimeline] rebuild skipped, ${stoppedParsing.length} drawn note(s) stopped parsing: ${stoppedParsing
          .map((u) => `${u.noteItemID} ${u.reason}: ${u.message}`)
          .join("; ")}`,
      );
      return;
    }

    if (drawnMatches(fresh.timelines)) {
      return;
    }

    rebuildCount += 1;
    const state = captureCanvasState();
    try {
      timeline.destroy();
    } catch {
      // Already gone; the re-render below is still the right thing to do.
    }

    readableTimelines = fresh.timelines;
    documents.clear();
    for (const t of fresh.timelines) {
      documents.set(t.doc.id, t.doc);
    }

    ({
      timeline,
      items,
      groups,
      activateDocument: activateTimeline,
      getActiveDocument,
      setTagFilter,
    } = renderCanvas(
      canvas as unknown as HTMLElement,
      fresh.timelines,
      libraryID,
      libraryEditable,
      showEditorFor,
      (d) => documents.set(d.id, d),
    ));
    currentTimeline = timeline;
    timelineGroups = groups;
    getActiveDocumentId = getActiveDocument;
    teardownTimeline = () => {
      try {
        timeline.destroy();
      } catch {
        // The window may already be gone; nothing to release in that case.
      }
    };

    // Restore the previous selection against the fresh, unfiltered instance
    // first; renderSidebar() below is what applies the persisted tag filter
    // (setTagFilter's own check - did the selection just restored survive the
    // filter? - is what clears it and blanks the editor when it did not, the
    // same as a live chip toggle).
    restoreCanvasState(state);
    renderSidebar();
  }

  // Single-flight with a dirty bit. Dropping notifications that arrive during
  // a rebuild loses them: a prune landing mid-rebuild would leave the canvas
  // showing a source that no longer exists until the tab was reopened. A queue
  // is the other extreme and rebuilds once per notification for a burst that
  // one redraw settles. So: at most one rebuild in flight, and exactly one
  // more if anything arrived while it ran, however many arrived.
  let rebuilding = false;
  let rebuildRequested = false;

  async function scheduleRebuild(): Promise<void> {
    if (rebuilding) {
      rebuildRequested = true;
      return;
    }
    rebuilding = true;
    try {
      do {
        rebuildRequested = false;
        await rebuildCanvas();
      } while (rebuildRequested);
    } catch (err) {
      logFailure("timeline rebuild", err);
    } finally {
      rebuilding = false;
    }
  }

  /**
   * Redraws when a note this tab drew changes underneath it.
   *
   * Returns void and awaits nothing, and that is load-bearing rather than
   * stylistic. Zotero awaits every observer's return value inside the commit
   * of the transaction that fired the notification, and every storage write
   * ends in saveTx() on a serial queue. Awaiting a rebuild here would park the
   * write that triggered it behind the task waiting on this observer: neither
   * settles, and every later write in the session hangs with nothing thrown
   * and nothing in the debug log.
   *
   * Filtering to notes this tab holds is what keeps an unrelated item edit
   * from redrawing the canvas. A note that is new to this library is not in
   * that set, which is correct for `modify`: a timeline created in another
   * window arrives as `add`, and picking that up is a separate concern from
   * this one.
   */
  function notifyTimelineChanged(
    event: _ZoteroTypes.Notifier.Event,
    type: _ZoteroTypes.Notifier.Type,
    ids: string[] | number[],
  ): void {
    if (event !== "modify" || type !== "item") {
      return;
    }
    const ours = new Set(readableTimelines.map((t) => t.noteItemID));
    if (!ids.some((id) => ours.has(Number(id)))) {
      return;
    }
    void scheduleRebuild();
  }

  refreshNotify = notifyTimelineChanged;
  refreshObserverID = Zotero.Notifier.registerObserver(
    { notify: notifyTimelineChanged },
    ["item"],
    `zoterotimeline-canvas-refresh-${id}`,
  );

  // Typed narrowly to what the sidebar actually reads and writes, rather than
  // pulling in vis-timeline's own types: this module never imports vis-timeline
  // statically (see the dynamic import above), and `groups` is already a live
  // instance by the time any of this runs.
  type GroupRow = { id: string; content: string; visible?: boolean };
  function groupsDS() {
    return groups as unknown as {
      get: (opts: { order: string }) => GroupRow[];
      add: (data: {
        id: string;
        content: string;
        order: number;
        visible?: boolean;
      }) => unknown;
      update: (
        data:
          | { id: string; visible?: boolean; order?: number; content?: string }
          | Array<{
              id: string;
              visible?: boolean;
              order?: number;
              content?: string;
            }>,
      ) => unknown;
      remove: (id: string) => unknown;
    };
  }

  /**
   * Every top-level document row, in order - never a sub-lane (TASK-15).
   * canvas.ts nests a document's tracks under its own group in the same
   * DataSet, and a sub-lane's `order` is scoped to its own siblings under one
   * parent, never comparable against another document's - reading it as if it
   * were a timeline row would corrupt both the sidebar listing and the
   * gapless renumbering reorderGroup below depends on. `documents` (this
   * function's own closure) is what tells the two apart: every sub-lane's id
   * is minted from a document id plus a track name and never collides with
   * one.
   */
  function documentGroupRows(): GroupRow[] {
    return groupsDS()
      .get({ order: "order" })
      .filter((row) => documents.has(row.id));
  }

  // Toggled by the sidebar's create button; not module-level, since it must
  // reset to closed every time the tab is opened fresh.
  let creatingTimeline = false;

  // The id of the row currently showing its inline rename form, or none. Not
  // module-level for the same reason creatingTimeline is not.
  let renamingDocumentId: string | null = null;

  /**
   * Adds a freshly created timeline to every place the sidebar and canvas
   * already read from, rather than reloading the library: a reload would
   * rebuild the canvas from scratch and lose the viewport and selection a
   * create action has no reason to disturb.
   */
  function addCreatedTimeline(created: {
    item: Zotero.Item;
    doc: TimelineDocument;
  }): void {
    documents.set(created.doc.id, created.doc);
    readableTimelines = [
      ...readableTimelines,
      { noteItemID: created.item.id, doc: created.doc, dateIssues: [] },
    ];
    const order = documentGroupRows().length;
    groupsDS().add({
      id: created.doc.id,
      content: created.doc.name,
      order,
      visible: true,
    });
  }

  const emptyPrompt = el(doc, "div");
  emptyPrompt.classList.add(CANVAS_EMPTY_PROMPT_CLASS);

  /**
   * The plus control in the section header (see project/ui-design.md's
   * pattern for creation controls). Disabled rather than hidden when the
   * library cannot be written, so the create action follows the same rule
   * as every other control that writes a document.
   */
  function buildCreateButton(): HTMLElement {
    const button = el(doc, "button");
    button.type = "button";
    button.classList.add(SIDEBAR_CREATE_BUTTON_CLASS);
    button.textContent = "+";
    button.disabled = !libraryEditable;
    button.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-create-button"),
    );
    button.addEventListener("click", () => {
      creatingTimeline = !creatingTimeline;
      renderSidebar();
    });
    return button;
  }

  /**
   * The inline name form the plus control reveals - an ellipsis would mean a
   * further window, and this is a control that acts in place instead.
   *
   * The confirm button starts disabled and stays that way until the name is
   * non-blank, which is what keeps validate.ts's own empty-name refusal from
   * ever being the error message a user sees.
   */
  function buildCreateForm(): HTMLElement {
    const form = el(doc, "div");
    form.classList.add(SIDEBAR_CREATE_FORM_CLASS);

    const nameInput = el(doc, "input");
    nameInput.type = "text";
    nameInput.classList.add(SIDEBAR_CREATE_NAME_INPUT_CLASS);
    nameInput.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-create-name-input"),
    );
    form.appendChild(nameInput as unknown as Node);

    const actions = el(doc, "div");
    actions.classList.add(SIDEBAR_CREATE_ACTIONS_CLASS);

    const confirmButton = el(doc, "button");
    confirmButton.type = "button";
    confirmButton.classList.add(SIDEBAR_CREATE_CONFIRM_CLASS);
    confirmButton.disabled = true;
    confirmButton.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-create-confirm-button"),
    );
    actions.appendChild(confirmButton as unknown as Node);

    const cancelButton = el(doc, "button");
    cancelButton.type = "button";
    cancelButton.classList.add(SIDEBAR_CREATE_CANCEL_CLASS);
    cancelButton.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-create-cancel-button"),
    );
    actions.appendChild(cancelButton as unknown as Node);

    form.appendChild(actions as unknown as Node);

    nameInput.addEventListener("input", () => {
      confirmButton.disabled = nameInput.value.trim() === "";
    });

    cancelButton.addEventListener("click", () => {
      creatingTimeline = false;
      renderSidebar();
    });

    confirmButton.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (name === "") {
        return;
      }
      confirmButton.disabled = true;
      void (async () => {
        try {
          const created = await createTimelineOrWarn(name, libraryID);
          if (created) {
            addCreatedTimeline(created);
          }
          creatingTimeline = false;
        } catch (err) {
          logFailure(
            `[zoteroTimeline] failed to create a timeline in library ${libraryID}: ${(err as Error).message}`,
            err,
          );
        } finally {
          renderSidebar();
        }
      })();
    });

    nameInput.focus();
    return form;
  }

  /**
   * Rebuilds the sidebar from the vis groups DataSet, which is the ordered,
   * visible/hidden truth the toggle and reorder controls write straight into.
   * Rows carry `data-timeline-id`, the attachment point a later activation
   * gesture (TASK-16) reads rather than a second lookup of its own.
   */
  function renderSidebar(): void {
    sidebar.textContent = "";

    const headingRow = el(doc, "div");
    headingRow.classList.add(SIDEBAR_HEADING_ROW_CLASS);

    const heading = el(doc, "div");
    heading.classList.add(SIDEBAR_HEADING_CLASS);
    heading.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-heading"),
    );
    headingRow.appendChild(heading as unknown as Node);
    headingRow.appendChild(buildCreateButton() as unknown as Node);
    sidebar.appendChild(headingRow as unknown as Node);

    if (creatingTimeline) {
      sidebar.appendChild(buildCreateForm() as unknown as Node);
    }

    const rows = documentGroupRows();
    rows.forEach((group, index) => {
      sidebar.appendChild(
        buildSidebarRow(group, index, rows.length) as unknown as Node,
      );
    });

    for (const entry of unreadable) {
      sidebar.appendChild(buildUnreadableRow(entry) as unknown as Node);
    }

    // The offered set is recomputed on every render, which is what makes it
    // track a toggle or a reorder with no wiring of its own: renderSidebar
    // already runs after every one of those, after a rebuild triggered by an
    // event's tags changing underneath this tab, and after an edit made in
    // this tab (onEditorChange calls it, and says there why that case is not
    // covered by the rebuild). A selection pointing
    // at a tag that just fell out of the offered set is dropped here rather
    // than kept invisibly - there is nowhere on this surface to explain why a
    // chip nobody can see is still narrowing the canvas.
    const availableTags = collectVisibleTags(getVisibleTimelines());
    for (const tag of Array.from(selectedTagFilter)) {
      if (!availableTags.includes(tag)) {
        selectedTagFilter.delete(tag);
      }
    }
    // Applied here, the one place selectedTagFilter is finalised for this
    // render, rather than at every call site that mutates it or rebuilds the
    // canvas: a toggle, a prune above, and a post-rebuild restore all funnel
    // through a renderSidebar() call already, so this is the single point
    // that keeps the canvas and the chip bank in agreement.
    setTagFilter(selectedTagFilter);
    const tagsSection = el(doc, "div");
    sidebar.appendChild(tagsSection as unknown as Node);
    renderTagFilter(
      doc,
      tagsSection as unknown as HTMLElement,
      availableTags,
      selectedTagFilter,
      (tag) => {
        if (selectedTagFilter.has(tag)) {
          selectedTagFilter.delete(tag);
        } else {
          selectedTagFilter.add(tag);
        }
        renderSidebar();
      },
    );

    // Two different empties, needing different sentences. Toggling every
    // timeline off is undone from the sidebar; a library holding none at all
    // cannot be. Saying "toggle one on" to someone with nothing to toggle is
    // the misreading this prompt exists to prevent, and an unexplained blank
    // canvas is the one that already cost a misdiagnosis (TASK-56).
    //
    // A writable library never rests here: opening the tab gives it its first
    // timeline (createDefaultTimelineIfNeeded, TASK-45's job, not repeated
    // here). What lands here is a library that cannot be written, or one
    // whose timelines are all in the trash.
    const anyVisible = rows.some((group) => group.visible !== false);
    const message =
      rows.length === 0
        ? libraryEditable
          ? "timeline-canvas-no-timelines"
          : "timeline-canvas-no-timelines-read-only"
        : !anyVisible
          ? "timeline-sidebar-none-visible"
          : null;
    if (message) {
      emptyPrompt.setAttribute("data-l10n-id", getLocaleID(message));
      if (!emptyPrompt.isConnected) {
        canvas.appendChild(emptyPrompt as unknown as Node);
      }
    } else if (emptyPrompt.isConnected) {
      emptyPrompt.remove();
    }
  }

  function buildSidebarRow(
    group: GroupRow,
    index: number,
    total: number,
  ): HTMLElement {
    if (group.id === renamingDocumentId) {
      return buildRenameForm(group);
    }

    const row = el(doc, "div");
    row.classList.add(SIDEBAR_ROW_CLASS);
    row.setAttribute("data-timeline-id", group.id);
    // tabindex="0" rather than an incrementing value: the rows are already in
    // the drawn order in the DOM, so tab order follows it for free, and a
    // hand-numbered sequence would only be a second order to keep in sync
    // with the first. This is the row itself as its own stop - the checkbox
    // and the move buttons inside it keep their own default tab stops, so
    // nothing here traps or steals them.
    row.tabIndex = 0;

    // Clicking the row activates its timeline (TASK-16) - but only when the
    // click landed on the row itself, not on one of its own controls. The
    // visibility checkbox is the one that matters: toggling a timeline on
    // must never also activate it (project/backlog/plans, 2026-08-22 m-4
    // decision), and the move/rename/delete buttons already have their own
    // dedicated actions.
    //
    // The name span sits inside the same <label> as the checkbox (below), so
    // a click there is, natively, ALSO a click on the checkbox: a <label>'s
    // own activation behaviour relays an uncancelled click to the control it
    // wraps. Left alone, clicking the row's name to activate it would silently
    // toggle that timeline's visibility off too. preventDefault() here is
    // what a label checks before relaying - it stops there being a second,
    // synthetic click on the checkbox at all, rather than something this
    // handler would otherwise have to detect and undo after the fact.
    row.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("input") || target.closest("button")) {
        return;
      }
      event.preventDefault();
      activateTimeline(group.id);
    });

    // The keyboard equivalent of clicking the row, and only the row: Enter or
    // Space while a descendant control (the checkbox, a move/rename/delete
    // button) has focus is that control's own native behaviour, not this
    // row's, so this only fires when the row itself is the event's target.
    row.addEventListener("keydown", (event) => {
      if (event.target !== row) {
        return;
      }
      // The sandbox's generated event map types every "keydown" listener's
      // event as the bare Event interface rather than KeyboardEvent, which is
      // an imprecision in that generated map rather than anything true at
      // runtime - a real keydown is always a KeyboardEvent.
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        activateTimeline(group.id);
      }
    });

    const label = el(doc, "label");
    label.classList.add(SIDEBAR_ROW_LABEL_CLASS);

    const checkbox = el(doc, "input");
    checkbox.type = "checkbox";
    checkbox.classList.add(SIDEBAR_ROW_VISIBLE_CLASS);
    checkbox.checked = group.visible !== false;
    checkbox.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-visible-checkbox"),
    );
    // Flips the group's own visible flag - the only thing a toggle changes.
    // vis-timeline's own DataView re-filters on this write and the canvas
    // redraws with no document re-read.
    checkbox.addEventListener("change", () => {
      groupsDS().update({ id: group.id, visible: checkbox.checked });
      renderSidebar();
    });
    label.appendChild(checkbox as unknown as Node);

    const name = el(doc, "span");
    name.classList.add(SIDEBAR_ROW_NAME_CLASS);
    name.textContent = group.content;
    label.appendChild(name as unknown as Node);

    row.appendChild(label as unknown as Node);

    const moveUp = el(doc, "button");
    moveUp.type = "button";
    moveUp.classList.add(SIDEBAR_ROW_MOVE_UP_CLASS);
    moveUp.disabled = index === 0;
    moveUp.textContent = "↑";
    moveUp.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-move-up-button"),
    );
    moveUp.addEventListener("click", () => reorderGroup(group.id, -1));
    row.appendChild(moveUp as unknown as Node);

    const moveDown = el(doc, "button");
    moveDown.type = "button";
    moveDown.classList.add(SIDEBAR_ROW_MOVE_DOWN_CLASS);
    moveDown.disabled = index === total - 1;
    moveDown.textContent = "↓";
    moveDown.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-move-down-button"),
    );
    moveDown.addEventListener("click", () => reorderGroup(group.id, 1));
    row.appendChild(moveDown as unknown as Node);

    const rename = el(doc, "button");
    rename.type = "button";
    rename.classList.add(SIDEBAR_ROW_RENAME_CLASS);
    rename.textContent = "✎";
    rename.disabled = !libraryEditable;
    rename.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-rename-button"),
    );
    rename.addEventListener("click", () => {
      renamingDocumentId = group.id;
      renderSidebar();
    });
    row.appendChild(rename as unknown as Node);

    const del = el(doc, "button");
    del.type = "button";
    del.classList.add(SIDEBAR_ROW_DELETE_CLASS);
    del.textContent = "×";
    del.disabled = !libraryEditable;
    del.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-delete-button"),
    );
    del.addEventListener("click", () => {
      void handleDeleteTimeline(group.id);
    });
    row.appendChild(del as unknown as Node);

    return row;
  }

  /**
   * The inline rename form a row's rename control reveals, in place of that
   * row's own label and actions - the same "acts in place" pattern as the
   * create form, so a mis-click can't land on a different row's control while
   * this one is mid-edit.
   *
   * The confirm button starts disabled only when the prefilled name is
   * already blank, which cannot happen for a timeline that made it into the
   * sidebar; the same live check as create's form keeps it that way for
   * anything typed afterwards.
   */
  function buildRenameForm(group: GroupRow): HTMLElement {
    const row = el(doc, "div");
    row.classList.add(SIDEBAR_ROW_CLASS, SIDEBAR_ROW_RENAME_FORM_CLASS);
    row.setAttribute("data-timeline-id", group.id);

    const nameInput = el(doc, "input");
    nameInput.type = "text";
    nameInput.classList.add(SIDEBAR_ROW_RENAME_NAME_INPUT_CLASS);
    nameInput.value = group.content;
    nameInput.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-rename-name-input"),
    );
    row.appendChild(nameInput as unknown as Node);

    const confirmButton = el(doc, "button");
    confirmButton.type = "button";
    confirmButton.classList.add(SIDEBAR_ROW_RENAME_CONFIRM_CLASS);
    confirmButton.disabled = nameInput.value.trim() === "";
    confirmButton.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-rename-confirm-button"),
    );
    row.appendChild(confirmButton as unknown as Node);

    const cancelButton = el(doc, "button");
    cancelButton.type = "button";
    cancelButton.classList.add(SIDEBAR_ROW_RENAME_CANCEL_CLASS);
    cancelButton.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-rename-cancel-button"),
    );
    row.appendChild(cancelButton as unknown as Node);

    nameInput.addEventListener("input", () => {
      confirmButton.disabled = nameInput.value.trim() === "";
    });

    cancelButton.addEventListener("click", () => {
      renamingDocumentId = null;
      renderSidebar();
    });

    confirmButton.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (name === "") {
        return;
      }
      confirmButton.disabled = true;
      void (async () => {
        try {
          await renameTimeline(group.id, libraryID, name);
          // Mutated in place, not replaced: documents and readableTimelines
          // share the same object for every timeline loaded at tab-open, and
          // an in-place write is what keeps both current with no separate
          // reconciliation step.
          const targetDoc = documents.get(group.id);
          if (targetDoc) {
            targetDoc.name = name;
          }
          const entry = readableTimelines.find((t) => t.doc.id === group.id);
          if (entry && entry.doc !== targetDoc) {
            entry.doc.name = name;
          }
          groupsDS().update({ id: group.id, content: name });
          renamingDocumentId = null;
        } catch (err) {
          logFailure(
            `[zoteroTimeline] failed to rename timeline ${group.id}: ${(err as Error).message}`,
            err,
          );
        } finally {
          renderSidebar();
        }
      })();
    });

    nameInput.focus();
    return row;
  }

  /**
   * Deletes the timeline the row's own control sits in, after confirming and
   * naming what is lost.
   *
   * Detaches this timeline's own rendering from the canvas FIRST, before the
   * note is erased: everything up to and including that detach runs
   * synchronously in this handler, ahead of the first await, so a live-refresh
   * observer watching the note has nothing left in the canvas to rebuild by
   * the time the erase actually lands.
   */
  async function handleDeleteTimeline(documentId: string): Promise<void> {
    const targetDoc = documents.get(documentId);
    const confirmed = confirmTimelineDelete(
      win as unknown as mozIDOMWindowProxy,
      getString("timeline-delete-confirm-title"),
      getString("timeline-delete-confirm-message", {
        args: {
          name: targetDoc?.name ?? "",
          count: targetDoc?.events.length ?? 0,
        },
      }),
    );
    if (!confirmed) {
      return;
    }

    // Read before either DataSet is touched: vis-timeline drops its own
    // selection as a side effect of removing the selected item, so asking
    // getSelection() after items.remove() below would always see it already
    // empty and never know there was anything to clear.
    const selection = (timeline as any).getSelection() as string[];
    const editorShowsThisTimeline =
      selection.length === 1 &&
      parseVisItemId(selection[0]).documentId === documentId;

    if (targetDoc) {
      (items as unknown as { remove: (ids: string[]) => void }).remove(
        targetDoc.events.map((e) => visItemId(documentId, e.id)),
      );
    }
    groupsDS().remove(documentId);

    // Clears the editor panel's selection when it was showing an event from
    // this timeline - otherwise it keeps offering Save on an event in a
    // document that is about to stop existing.
    if (editorShowsThisTimeline) {
      (timeline as any).setSelection([]);
    }

    try {
      await deleteTimeline(documentId, libraryID);
      documents.delete(documentId);
      readableTimelines = readableTimelines.filter(
        (t) => t.doc.id !== documentId,
      );
    } catch (err) {
      logFailure(
        `[zoteroTimeline] failed to delete timeline ${documentId}: ${(err as Error).message}`,
        err,
      );
    } finally {
      renderSidebar();
    }
  }

  function buildUnreadableRow(entry: UnreadableTimeline): HTMLElement {
    const row = el(doc, "div");
    row.classList.add(SIDEBAR_ROW_CLASS, SIDEBAR_ROW_UNREADABLE_CLASS);
    const name = el(doc, "span");
    name.classList.add(SIDEBAR_ROW_NAME_CLASS);
    name.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-unreadable-label"),
    );
    (name as unknown as HTMLElement).title = entry.message;
    row.appendChild(name as unknown as Node);
    return row;
  }

  /**
   * Rewrites every group's `order` field from a swap of two adjacent rows,
   * rather than trying to slot one group between two others: groupOrder sorts
   * on this field, so a full, gapless renumbering is what keeps it unambiguous
   * after repeated reorders.
   */
  function reorderGroup(documentId: string, delta: number): void {
    const rows = documentGroupRows();
    const index = rows.findIndex((group) => group.id === documentId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= rows.length) {
      return;
    }
    [rows[index], rows[target]] = [rows[target], rows[index]];
    groupsDS().update(rows.map((group, i) => ({ id: group.id, order: i })));
    renderSidebar();
  }

  renderSidebar();
  showEditorFor(null);

  Zotero.debug(`[ZoteroTimeline] canvas rendered into tab ${id} (${TAB_TYPE})`);
}

export function registerTimelineMenu(): void {
  ztoolkit.Menu.register("menuTools", {
    tag: "menuitem",
    id: MENU_ID,
    label: getString("timeline-tab-label"),
    commandListener: () => {
      // Nothing catches for us here, and the tab is added before the body is
      // built, so an unhandled rejection would leave an empty tab and no clue.
      void openTimelineTab().catch((err) => {
        Zotero.debug(
          `[ZoteroTimeline] openTimelineTab failed: ${err?.stack ?? String(err)}`,
        );
      });
    },
  });
}

/**
 * The element the keystroke actually landed in.
 *
 * `ev.target` is not it. Zotero's text fields are XUL custom elements holding
 * a real `<input>` in an open shadow root, and an event crossing that boundary
 * is retargeted to the host: typing in the quick-search box reports a target
 * whose tagName is `search-textbox`. `composedPath()[0]` is the inner element
 * that was actually focused, so the guard below sees an `input` where reading
 * `ev.target` sees a custom element it has no opinion about.
 */
function textEntryTarget(ev: Event): HTMLElement | null {
  const path = ev.composedPath?.();
  return ((path && path.length > 0 ? path[0] : ev.target) ??
    null) as HTMLElement | null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName?.toLowerCase();
  return element.isContentEditable || tag === "input" || tag === "textarea";
}

export function registerTimelineShortcut(): void {
  ztoolkit.Keyboard.register((ev, keyOptions) => {
    if (!keyOptions.keyboard?.equals(TIMELINE_SHORTCUT)) {
      return;
    }
    if (isTextEntryTarget(textEntryTarget(ev))) {
      return;
    }
    void openTimelineTab().catch((err) => {
      Zotero.debug(
        `[ZoteroTimeline] openTimelineTab failed: ${err?.stack ?? String(err)}`,
      );
    });
  });
}

export function closeTimelineTab(): void {
  if (!timelineTabID) {
    return;
  }
  ztoolkit.getGlobal("Zotero_Tabs").close(timelineTabID);
  timelineTabID = undefined;
}
