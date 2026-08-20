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
export function ensureDocumentHead(doc: Document): void {
  if (doc.head) {
    return;
  }
  const head = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "head",
  ) as unknown as HTMLHeadElement;
  doc.documentElement?.appendChild(head as unknown as Node);
  Object.defineProperty(doc, "head", { value: head, configurable: true });
}

export function ensureWindowGlobals(win: Window): void {
  hostWindow = win;
  defineFromHost("document", (w) => w.document);
  defineFromHost("Image", (w) => (w as any).Image);
  defineFromHost("ResizeObserver", (w) => (w as any).ResizeObserver);
  defineFromHost("MutationObserver", (w) => (w as any).MutationObserver);
  defineFromHost("getComputedStyle", (w) => (w as any).getComputedStyle);
}
