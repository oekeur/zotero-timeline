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
import type { TimelineDocument } from "./schema";

const TAB_TYPE = "zoterotimeline-timeline";
const MENU_ID = "zotero-timeline-menuitem-open-timeline";
const HTML_NS = "http://www.w3.org/1999/xhtml";

// The tab shell's classes, styled in addon/content/zoteroPane.css. Exported
// rather than written as literals at the point of use so a test or a later
// surface names the same string the sheet does.
export const TAB_BODY_CLASS = "zoterotimeline-tab-body";
export const TAB_HEADER_CLASS = "zoterotimeline-tab-header";
export const TAB_HEADING_CLASS = "zoterotimeline-tab-heading";
export const TAB_NOTE_CLASS = "zoterotimeline-tab-note";
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

let timelineTabID: string | undefined;
let teardownTimeline: (() => void) | undefined;
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

export function getModuleEvalEnv(): any {
  return moduleEvalEnv;
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
 * toggled off) and m-7's TASK-50 (which tags to offer). Reads the vis groups
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
      teardownTimeline?.();
      teardownTimeline = undefined;
      currentTimeline = undefined;
      timelineGroups = undefined;
      readableTimelines = [];
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

  const header = el(doc, "div");
  header.classList.add(TAB_HEADER_CLASS);
  const heading = el(doc, "div");
  heading.classList.add(TAB_HEADING_CLASS);
  heading.textContent = getString("timeline-spike-heading");
  const note = el(doc, "div");
  note.classList.add(TAB_NOTE_CLASS);
  note.textContent = getString("timeline-spike-note");
  header.appendChild(heading as unknown as Node);
  header.appendChild(note as unknown as Node);
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

  const canvas = el(doc, "div");
  canvas.id = "zoterotimeline-canvas";
  // The rule behind CANVAS_CLASS carries two declarations that are behaviour
  // rather than appearance, and zoteroPane.css says why at length: position:
  // relative is what vis-timeline's absolutely positioned layers resolve
  // against, and min-height/min-width: 0 is what lets the canvas shrink
  // instead of overflowing the row. Neither is safe to drop as styling.
  canvas.classList.add(CANVAS_CLASS);
  row.appendChild(canvas as unknown as Node);

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
      );
      return;
    }
    renderEventEditor(
      panel as unknown as HTMLElement,
      { documentId, libraryID, event },
      onEditorChange,
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
      items.update(buildTimelineItem(change.documentId, change.event));
    } else if (change.kind === "created") {
      targetDoc.events = [...targetDoc.events, change.event];
      items.add(buildTimelineItem(change.documentId, change.event));
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
  }

  // After the container is in the document. vis-timeline measures its parent
  // immediately, and a detached element measures zero, which renders as a
  // blank tab rather than an error.
  const { timeline, items, groups } = renderCanvas(
    canvas as unknown as HTMLElement,
    timelines,
    libraryID,
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
  teardownTimeline = () => {
    try {
      timeline.destroy();
    } catch {
      // The window may already be gone; nothing to release in that case.
    }
  };

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
    const order = groupsDS().get({ order: "order" }).length;
    groupsDS().add({
      id: created.doc.id,
      content: created.doc.name,
      order,
      visible: true,
    });
  }

  const emptyPrompt = el(doc, "div");
  emptyPrompt.classList.add(CANVAS_EMPTY_PROMPT_CLASS);
  emptyPrompt.setAttribute(
    "data-l10n-id",
    getLocaleID("timeline-sidebar-none-visible"),
  );

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
      getLocaleID(
        libraryEditable
          ? "timeline-sidebar-create-button"
          : "timeline-sidebar-create-button-read-only",
      ),
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

    const rows = groupsDS().get({ order: "order" });
    rows.forEach((group, index) => {
      sidebar.appendChild(
        buildSidebarRow(group, index, rows.length) as unknown as Node,
      );
    });

    for (const entry of unreadable) {
      sidebar.appendChild(buildUnreadableRow(entry) as unknown as Node);
    }

    const anyVisible = rows.some((group) => group.visible !== false);
    if (rows.length > 0 && !anyVisible) {
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
    // nothing here traps or steals them. No keydown handler is attached: this
    // row is reachable by keyboard, not yet activatable by it.
    row.tabIndex = 0;

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
      getLocaleID(
        libraryEditable
          ? "timeline-sidebar-rename-button"
          : "timeline-sidebar-rename-button-read-only",
      ),
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
      getLocaleID(
        libraryEditable
          ? "timeline-sidebar-delete-button"
          : "timeline-sidebar-delete-button-read-only",
      ),
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
    const rows = groupsDS().get({ order: "order" });
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
  ztoolkit.Menu.register("menuFile", {
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

export function closeTimelineTab(): void {
  if (!timelineTabID) {
    return;
  }
  ztoolkit.getGlobal("Zotero_Tabs").close(timelineTabID);
  timelineTabID = undefined;
}
