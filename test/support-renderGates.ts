/**
 * Reads the state of every gate between "this plugin wants its item-pane
 * section re-rendered" and "the section re-renders".
 *
 * Zotero has six of them and documents none. A fix written against one gate
 * passes its own spec and fails on the next, which is why diagnosing a
 * stale-section defect by reading the code discovers one gate per attempt.
 * Print all six at once instead, then write the fix.
 *
 * Verified against Zotero 10.0-beta.25, `chrome/content/zotero/elements/` in
 * `/opt/zotero-beta/app/omni.ja`. Re-check on a Zotero upgrade: every field
 * below is private and none is part of a plugin API.
 *
 *   itemDetails.js       `box.item = item` fires onItemChange (and so
 *                        setEnabled, and so `hidden`) BEFORE the
 *                        `!box.hidden` test that guards render(), so a
 *                        section disabled for the displayed item never
 *                        updates its own render bookkeeping.
 *   itemDetails.js:299   asyncRender is skipped entirely for a pane that is
 *                        not currently visible. onRender carries no such
 *                        gate.
 *   itemDetails.js:287   render() restores `_lastScrollTop` and then zeroes
 *                        it, so any render not preceded by Zotero's own
 *                        capture scrolls the pane to the top.
 *   _handleTabSelect     sets `skipRender` on every pane of an item-details
 *                        whose tab is not selected, and on reselect renders
 *                        only `if (isTabSelected && this._pendingRender)`.
 *   _pendingRender       belongs to item-details and is set only inside its
 *                        own render(), so a plugin-triggered refresh does
 *                        not arm it.
 *   _isAlreadyRendered   keyed [tabID, item.id] and updated only inside
 *                        render()/asyncRender(), both gated on `!box.hidden`.
 *
 * One instance exists per `item-details` element, and contextPane builds a
 * separate one for every reader and note tab, so `readRenderGates` returns a
 * row per instance rather than a single answer.
 */

type GateRow = {
  /** Which item-details this section instance belongs to, for telling copies apart. */
  host: string;
  /** The item the pane is displaying, which is not always the one last rendered. */
  paneItemID: number | null;
  /** The item the section last rendered, read from the wrapper's own dependency key. */
  renderedItemID: number | null;
  /** Disabled for this item: set by onItemChange before render() is considered. */
  hidden: boolean | null;
  /** Set on every pane whose tab is not the selected one. */
  skipRender: boolean | null;
  /** The section's own deferred-render flag, set when a refresh was suppressed. */
  syncRenderPending: boolean | null;
  /** item-details' flag, the only thing a tab reselect resumes on. */
  pendingRender: boolean | null;
  /** Whether Zotero currently considers the pane scrolled into view. */
  paneVisible: boolean | null;
  /** Where a resumed render would scroll to; 0 means "to the top". */
  lastScrollTop: number | null;
  /** What the section is actually showing, trimmed. */
  bodyText: string;
};

/**
 * Every live instance of `paneID`'s section in `win`, with each gate's state.
 *
 * Pass the result straight into a failure message. Reading which gate is
 * closed is the whole point; a spec that only asserts on body text reports a
 * timeout and leaves the reason to be guessed at.
 */
export function readRenderGates(win: Window, paneID: string): GateRow[] {
  const doc = (win as unknown as { document: Document }).document;
  const sections = [
    ...doc.querySelectorAll(`item-pane-custom-section[data-pane*="${paneID}"]`),
  ];
  return sections.map((section) => {
    const el = section as unknown as {
      hidden?: boolean;
      _syncRenderPending?: boolean;
      _renderDependencies?: unknown[];
      querySelector(sel: string): Element | null;
      closest(sel: string): Element | null;
    };
    const details = el.closest("item-details") as unknown as {
      id?: string;
      item?: { id: number };
      skipRender?: boolean;
      _pendingRender?: boolean;
      _lastScrollTop?: number;
      isPaneVisible?: (pane: string) => boolean;
      dataset?: DOMStringMap;
    } | null;
    const body = el.querySelector('[data-type="body"]');
    const deps = el._renderDependencies;
    return {
      host: details?.id || (details ? "item-details" : "detached"),
      paneItemID: details?.item?.id ?? null,
      // The dependency key is [tabID, item.id]; the second entry is the item
      // this section last actually rendered, which diverges from the pane's
      // current item whenever a render was skipped.
      renderedItemID: Array.isArray(deps)
        ? ((deps[1] as number | undefined) ?? null)
        : null,
      hidden: el.hidden ?? null,
      skipRender: details?.skipRender ?? null,
      syncRenderPending: el._syncRenderPending ?? null,
      pendingRender: details?._pendingRender ?? null,
      paneVisible:
        details?.isPaneVisible && details.dataset
          ? (details.isPaneVisible(paneID) ?? null)
          : null,
      lastScrollTop: details?._lastScrollTop ?? null,
      bodyText: (body?.textContent || "").trim().slice(0, 60),
    };
  });
}

/** `readRenderGates` as one line, for appending to a failure message. */
export function describeRenderGates(win: Window, paneID: string): string {
  return JSON.stringify(readRenderGates(win, paneID));
}
