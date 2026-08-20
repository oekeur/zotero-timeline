// Bundled UI libraries reference browser globals as bare identifiers
// (`document`, `ResizeObserver`, `MutationObserver`, `Image`) rather than
// going through the container's own window. Those identifiers do not exist in
// every scope this plugin runs in, even though the real objects exist on
// Zotero's actual window.
//
// Call this with the window that will host the widget, before constructing it.
// Safe to call on every render.

// The window that rendered most recently. What each installed global resolves
// to is read through this rather than captured when the global is installed:
// Zotero can have several main windows, and a timeline opened in a second one
// would otherwise still operate on the first window's document, which by then
// may belong to a window the user has closed.
let hostWindow: Window | undefined;

// A global already present belongs to whatever put it there, Zotero's own
// scope or the toolkit, and is often a getter-only property that throws on
// assignment. Only the ones genuinely missing get filled in.
function defineFromHost(name: string, read: (win: Window) => unknown): void {
  const g = globalThis as any;
  if (typeof g[name] !== "undefined") {
    return;
  }
  Object.defineProperty(g, name, {
    configurable: true,
    get: () => (hostWindow ? read(hostWindow) : undefined),
  });
}

/**
 * Zotero's main chrome window is a XUL document with no `<head>` element.
 * Libraries that inject a stylesheet do `document.head.insertBefore(...)` or
 * `document.head.appendChild(...)` unconditionally on init, which throws
 * against a XUL document. Shim a `<head>` in so that does not happen.
 */
function ensureDocumentPart(doc: Document, part: "head" | "body"): void {
  if ((doc as any)[part]) {
    return;
  }
  const element = doc.createElementNS("http://www.w3.org/1999/xhtml", part);
  doc.documentElement?.appendChild(element as unknown as Node);
  Object.defineProperty(doc, part, { value: element, configurable: true });
}

/**
 * Zotero's main chrome window is a XUL document, which has neither a `<head>`
 * nor a `<body>`. Library code assumes both exist:
 *
 *   - stylesheet injection does `document.head.appendChild(...)` on init
 *   - vis-timeline's getScrollBarWidth measures by appending a probe element
 *     to `document.body`, then removing it
 *
 * Both are unconditional, so both throw against a XUL document rather than
 * degrading. Shim the two elements in.
 */
export function ensureDocumentHead(doc: Document): void {
  ensureDocumentPart(doc, "head");
  ensureDocumentPart(doc, "body");
}

export function ensureWindowGlobals(win: Window): void {
  hostWindow = win;
  // `window` itself. Bundles reach for it bare, and a ReferenceError here
  // aborts the caller mid-build: the tab is already added by then, so the
  // symptom is an empty tab rather than an error the user can see.
  defineFromHost("window", (w) => w);
  defineFromHost("document", (w) => w.document);
  defineFromHost("Image", (w) => (w as any).Image);
  defineFromHost("ResizeObserver", (w) => (w as any).ResizeObserver);
  defineFromHost("MutationObserver", (w) => (w as any).MutationObserver);
  defineFromHost("getComputedStyle", (w) => (w as any).getComputedStyle);
  defineFromHost("navigator", (w) => (w as any).navigator);
  defineFromHost("location", (w) => (w as any).location);
  defineFromHost("requestAnimationFrame", (w) =>
    (w as any).requestAnimationFrame?.bind(w),
  );
  defineFromHost("cancelAnimationFrame", (w) =>
    (w as any).cancelAnimationFrame?.bind(w),
  );

  // DOM interface constructors, used bare in `instanceof` checks. vis-timeline
  // does `content instanceof Element` when setting group content, which is a
  // ReferenceError here rather than a false. They must come from the host
  // window: an instance created in that window is only `instanceof` that
  // window's constructor, so a copy from anywhere else would silently compare
  // false and take the wrong branch.
  for (const name of [
    "Element",
    "Node",
    "HTMLElement",
    "SVGElement",
    "DocumentFragment",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
  ]) {
    defineFromHost(name, (w) => (w as any)[name]);
  }
}
