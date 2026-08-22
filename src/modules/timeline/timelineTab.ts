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
import { getString } from "../../utils/locale";
import {
  ensureDocumentHead,
  ensureWindowGlobals,
} from "../../utils/windowGlobals";
import { listTimelines } from "./storage";
import { renderEventEditor, type EventEditorChange } from "./eventEditor";
import type { TimelineDocument } from "./schema";

const TAB_TYPE = "zoterotimeline-timeline";
const MENU_ID = "zotero-timeline-menuitem-open-timeline";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let timelineTabID: string | undefined;
let teardownTimeline: (() => void) | undefined;
// Exposed for the live-Zotero suite, which needs to drive selection before it
// can drive a drag.
let currentTimeline: unknown;
let moduleEvalEnv: unknown;
let canvasModule: unknown;

export function getModuleEvalEnv(): any {
  return moduleEvalEnv;
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

const STYLESHEET_ID = "zoterotimeline-vis-stylesheet";
const STYLESHEET_URL = "chrome://zoterotimeline/content/vis-timeline.css";

/**
 * vis-timeline ships its stylesheet inside the bundle and injects it with a
 * `styleInject` helper. That helper is guarded by
 * `typeof document === "undefined"`, which is true in Zotero's bootstrap scope
 * where the bundle evaluates, so it returns early and the stylesheet is never
 * added. Nothing throws; the timeline simply renders unstyled, which looks
 * like a broken render rather than a missing file.
 *
 * So the CSS is vendored into addon/content/ and linked here instead.
 */
function ensureStylesheet(doc: Document): void {
  if (doc.getElementById(STYLESHEET_ID)) {
    return;
  }
  const link = doc.createElementNS(HTML_NS, "link") as HTMLLinkElement;
  link.id = STYLESHEET_ID;
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", STYLESHEET_URL);
  (doc.head ?? doc.documentElement)?.appendChild(link as unknown as Node);
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
  ensureStylesheet(doc);

  const body = el(doc, "div");
  body.style.cssText =
    "display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden;";
  container.appendChild(body as unknown as Node);

  const header = el(doc, "div");
  header.style.cssText =
    "flex: 0 0 auto; padding: 8px 12px; border-bottom: 1px solid;";
  const heading = el(doc, "div");
  heading.style.cssText = "font-weight: 600;";
  heading.textContent = getString("timeline-spike-heading");
  const note = el(doc, "div");
  note.style.cssText = "opacity: 0.75; font-size: 0.9em; margin-top: 2px;";
  note.textContent = getString("timeline-spike-note");
  header.appendChild(heading as unknown as Node);
  header.appendChild(note as unknown as Node);
  body.appendChild(header as unknown as Node);

  // Canvas and editor sit side by side, so selecting an event never reflows
  // the canvas out from under the pointer.
  const row = el(doc, "div");
  row.style.cssText =
    "display: flex; flex-direction: row; flex: 1 1 0; min-height: 0; overflow: hidden;";
  body.appendChild(row as unknown as Node);

  const canvas = el(doc, "div");
  canvas.id = "zoterotimeline-canvas";
  // position: relative is a hard requirement rather than styling. The library
  // absolutely positions its own layers inside this element; without a
  // positioning context they resolve against some ancestor further up the XUL
  // tree and the timeline draws somewhere other than where its container is,
  // or not visibly at all.
  //
  // min-height/min-width: 0 for the same reason any flex child needs them:
  // the default content-based minimum stops the canvas shrinking, and the row
  // then overflows the tab.
  canvas.style.cssText =
    "flex: 3 1 0; min-height: 0; min-width: 0; position: relative; overflow: hidden;";
  row.appendChild(canvas as unknown as Node);

  const panel = el(doc, "div");
  panel.id = "zoterotimeline-editor";
  panel.style.cssText =
    "flex: 1 1 0; min-height: 0; min-width: 220px; overflow: auto; padding: 8px 12px; border-left: 1px solid;";
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
  const { timelines } = await listTimelines(libraryID);
  // Keyed by document id, and kept up to date on every save/delete, so a
  // re-selection after an edit shows what was just written rather than what
  // was loaded when the tab opened.
  const documents = new Map<string, TimelineDocument>(
    timelines.map((t) => [t.doc.id, t.doc]),
  );

  function showEditorFor(itemId: string | null): void {
    if (!itemId) {
      renderEventEditor(panel as unknown as HTMLElement, null, onEditorChange);
      return;
    }
    const { documentId, eventId } = parseVisItemId(itemId);
    const targetDoc = documents.get(documentId);
    const event = targetDoc?.events.find((e) => e.id === eventId);
    if (!targetDoc || !event) {
      renderEventEditor(panel as unknown as HTMLElement, null, onEditorChange);
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
  const { timeline, items } = renderCanvas(
    canvas as unknown as HTMLElement,
    timelines,
    libraryID,
    showEditorFor,
  );
  currentTimeline = timeline;
  teardownTimeline = () => {
    try {
      timeline.destroy();
    } catch {
      // The window may already be gone; nothing to release in that case.
    }
  };

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
