/**
 * Linking a stylesheet into a document, and taking it out again.
 *
 * Three callers: the plugin's own main-window sheet, injected per window by
 * hooks.ts, and the two the tab appends into the same document at open, the
 * vendored vis-timeline sheet and the theme layer over it.
 *
 * Order matters for those two. The overrides restate colours the vendored
 * sheet sets at equal specificity, so they win only by coming later in the
 * document. Append them in that order and nothing else is needed.
 *
 * Zotero's main window is a XUL document with no `<head>`; callers that run
 * before `ensureDocumentHead` has shimmed one still work, because the link
 * falls back to `documentElement`.
 */
const HTML_NS = "http://www.w3.org/1999/xhtml";

/** Idempotent: a second call with the same id is a no-op, so reopening a
 *  window or a tab cannot stack duplicate links. */
export function ensureStylesheet(doc: Document, id: string, url: string): void {
  if (doc.getElementById(id)) {
    return;
  }
  const link = doc.createElementNS(HTML_NS, "link") as HTMLLinkElement;
  link.id = id;
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", url);
  (doc.head ?? doc.documentElement)?.appendChild(link as unknown as Node);
}

export function removeStylesheet(doc: Document, id: string): void {
  doc.getElementById(id)?.remove();
}
