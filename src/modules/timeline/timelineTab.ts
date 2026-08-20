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
import { renderFixture } from "./fixture";

const TAB_TYPE = "zoterotimeline-timeline";
const MENU_ID = "zotero-timeline-menuitem-open-timeline";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let timelineTabID: string | undefined;
let teardownTimeline: (() => void) | undefined;
// Exposed for the live-Zotero suite, which needs to drive selection before it
// can drive a drag.
let currentTimeline: ReturnType<typeof renderFixture> | undefined;

export function getCurrentTimeline() {
  return currentTimeline;
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

export function openTimelineTab(): void {
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

  const canvas = el(doc, "div");
  canvas.id = "zoterotimeline-canvas";
  // position: relative is a hard requirement rather than styling. The library
  // absolutely positions its own layers inside this element; without a
  // positioning context they resolve against some ancestor further up the XUL
  // tree and the timeline draws somewhere other than where its container is,
  // or not visibly at all.
  //
  // min-height: 0 for the same reason a flex child needs min-width: 0: the
  // default content-based minimum stops the canvas shrinking, and the row then
  // overflows the tab.
  canvas.style.cssText =
    "flex: 1 1 0; min-height: 0; position: relative; overflow: hidden;";
  body.appendChild(canvas as unknown as Node);

  // After the container is in the document. vis-timeline measures its parent
  // immediately, and a detached element measures zero, which renders as a
  // blank tab rather than an error.
  const timeline = renderFixture(canvas as unknown as HTMLElement);
  currentTimeline = timeline;
  teardownTimeline = () => {
    try {
      timeline.destroy();
    } catch {
      // The window may already be gone; nothing to release in that case.
    }
  };

  Zotero.debug(
    `[ZoteroTimeline] fixture rendered into tab ${id} (${TAB_TYPE})`,
  );
}

export function registerTimelineMenu(): void {
  ztoolkit.Menu.register("menuFile", {
    tag: "menuitem",
    id: MENU_ID,
    label: getString("timeline-tab-label"),
    commandListener: () => {
      openTimelineTab();
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
