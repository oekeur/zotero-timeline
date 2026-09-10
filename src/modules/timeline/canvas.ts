// Captured at module-evaluation time, before vis-timeline's own module body
// runs, so it records exactly what Hammer's `typeof window === "undefined"`
// check will see. If this reports false, the deferred import did not defer.
export const MODULE_EVAL_ENV = {
  // Read off globalThis rather than as bare identifiers. This file compiles
  // against the Zotero sandbox tsconfig, which has no DOM lib, so a bare
  // `typeof window` is a tsc error (TS2552) even though it is legal JS.
  hasWindow: typeof (globalThis as any).window !== "undefined",
  hasDocument: typeof (globalThis as any).document !== "undefined",
};

import { Timeline, DataSet, DataView } from "vis-timeline/standalone";
import {
  dateAtViewportPrecision,
  shiftEdtfDate,
  toTimelineRange,
  type EdtfForm,
} from "../../utils/edtfRange";
import { getString } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import { addEvent, updateEvent, type EventEdits } from "./mutations";
import { updateTimelineDocument, type StoredTimeline } from "./storage";
import type { Event, TimelineDocument } from "./schema";

/**
 * Gesture-parity audit (TASK-27). The rule is one-directional: every canvas
 * gesture that mutates data needs a typed equivalent, but a typed-only route
 * needs no canvas gesture (project/backlog/plans/2026-08-21-m-2-event-
 * authoring.md, "Unknowns"). Re-check this table whenever a new canvas
 * gesture is added.
 *
 * - Select an item (`timeline.on("select", ...)` below): navigation only,
 *   mutates nothing. Exempt, not a gap - confirmed by reading the handler,
 *   which only calls `onSelect`.
 * - Drag the body to move a date (`onMove` below): typed equivalent is
 *   editing `date` (and `endDate`, when present) in the event editor
 *   (eventEditor.ts) and clicking Save. Both routes call
 *   `updateEvent`+`updateTimelineDocument` (mutations.ts, storage.ts) with
 *   the same effect - proven by test/timelineDragPayload.test.ts (drag path)
 *   and test/eventEditor.test.ts's "saves through the mutation and the write
 *   path" (typed path) landing on the same function.
 * - Drag an edge to resize a range (`onMove` below, same handler): same
 *   typed equivalent as above, editing `endDate` (or `date`, for a
 *   start-edge drag). Covered by the same two test files.
 * - Click empty canvas to create an event (`click` handler below): typed
 *   equivalent is the create form in eventEditor.ts's empty-state prompt
 *   (title, date, and a document picker when more than one timeline is
 *   loaded), reachable with nothing selected. Both routes call
 *   `addEvent`+`updateTimelineDocument`. Unlike the click gesture, the typed
 *   form has no canvas position to derive a date from, so it asks for the
 *   date directly rather than inventing a default (see eventEditor.ts's
 *   renderCreateForm docblock for why a placeholder date isn't safe here).
 *   Covered by test/eventCreation.test.ts (click path) and
 *   test/eventEditorCreate.test.ts (typed path). A click landing inside a
 *   sub-lane's row (TASK-15) also sets the new event's `track`, parsed off
 *   the clicked group id by parseGroupId - the create form has no sub-lane
 *   field to set it from, since nothing edits `track` today besides this one
 *   gesture (the parity rule obligates the reverse, a typed route needing no
 *   canvas gesture, not this direction).
 * - Delete: no canvas-only gesture exists today (TASK-25's keyboard-delete
 *   handler was added, found to destabilise unrelated tests through a
 *   `container.focus()` call, and reverted - see TASK-25's Backlog notes).
 *   The only route is already typed, the editor panel's Delete button
 *   (eventEditor.ts, tested in test/eventEditor.test.ts). The parity rule
 *   obligates a canvas gesture to have a typed counterpart, not the reverse,
 *   so this is not a gap and nothing was added back.
 *
 * One documented exception, in the direction the rule permits (a
 * keyboard-only route is allowed; a mouse-only one is not): a parked event
 * (no canvas position at all) is not draggable and has no drag handle - its
 * date is corrected only by typing, per the plan's own resolved "Unknowns".
 *
 * - Toggle a lane's visibility or reorder the lanes (timelineTab.ts's
 *   sidebar): not a canvas gesture at all - there is no pointer interaction
 *   on the canvas itself that does either. The sidebar's controls are a plain
 *   checkbox and plain buttons, both natively operable by click or by
 *   keyboard focus plus Enter/Space, so nothing here is mouse-only and the
 *   audit has nothing to extend for it.
 * - Click-to-activate (the "click" handler below, and the "select" handler
 *   for clicking an existing item): mutates which lane accepts write
 *   gestures, not stored data, so this is the one gesture the parity rule
 *   itself does not obligate a typed equivalent for - there is no document
 *   field "which lane is active" for a form to edit. It still has a
 *   keyboard-reachable route, TASK-39's focusable sidebar row
 *   (timelineTab.ts), which activates on Enter/Space - the same documented
 *   exception a parked event's typing-only correction already uses: a
 *   keyboard-only route is allowed, a mouse-only one is not, and this one is
 *   neither.
 */

/**
 * The items DataSet is keyed by id, and event ids are only unique within their
 * own document, so the key has to carry both. This is also the write-back
 * route: the document an edit belongs to is derived from here and never from
 * `item.group`, which vis-timeline does not guarantee to supply.
 */
export function visItemId(documentId: string, eventId: string): string {
  return `${documentId}:${eventId}`;
}

export function parseVisItemId(id: string): {
  documentId: string;
  eventId: string;
} {
  const separator = id.indexOf(":");
  if (separator === -1) {
    throw new Error(`vis item id is not namespaced: ${id}`);
  }
  return {
    documentId: id.slice(0, separator),
    eventId: id.slice(separator + 1),
  };
}

/**
 * The vis group id for a document's sub-lane (TASK-15). `::` rather than
 * `:` (visItemId's separator) so the two id spaces never collide even though
 * they share nothing - a document id is a Zotero object key
 * (Zotero.Utilities.generateObjectKey(), eight alphanumeric characters), which
 * never contains either.
 */
export function trackGroupId(documentId: string, track: string): string {
  return `${documentId}::${track}`;
}

/**
 * The inverse of trackGroupId, and also the read for a group id that was
 * never nested: a document's own top-level group id round-trips through this
 * unchanged, since it never contains `::`.
 */
export function parseGroupId(groupId: string): {
  documentId: string;
  track?: string;
} {
  const separator = groupId.indexOf("::");
  return separator === -1
    ? { documentId: groupId }
    : {
        documentId: groupId.slice(0, separator),
        track: groupId.slice(separator + 2),
      };
}

/**
 * Every distinct track named by `doc`'s events, in first-seen order. Empty
 * for a document with no tracked events - the one-lane case this task must
 * leave exactly as it was.
 */
export function tracksOf(doc: TimelineDocument): string[] {
  const seen = new Set<string>();
  const tracks: string[] = [];
  for (const event of doc.events) {
    if (event.track !== undefined && !seen.has(event.track)) {
      seen.add(event.track);
      tracks.push(event.track);
    }
  }
  return tracks;
}

/**
 * Seven EDTF forms map onto five canvas stylings (project/backlog/plans,
 * 2026-08-22 m-4 decision, resolved by gap review after the count was stated
 * three different ways across the charter, the milestone and TASK-37's own
 * acceptance criteria): a season has real bounds, so it draws as the interval
 * styling that already depicts a real span, and a list makes the same claim a
 * one-of set does, so it draws as that styling. Plain, uncertain and
 * approximate keep their own. `undefined` for plain leaves the base
 * `.vis-item` look untouched.
 */
/**
 * The EDTF forms that assert an extent rather than a precision.
 *
 * A range's width is read against the axis as a duration, so only a form that
 * actually claims one may produce an end. See buildTimelineItem for why the
 * other three forms deliberately produce none.
 */
const EXTENT_FORMS = new Set<EdtfForm>([
  "interval",
  "season",
  "one-of",
  "list",
]);

const FORM_STYLING: Record<EdtfForm, string | undefined> = {
  plain: undefined,
  uncertain: "zt-uncertain",
  approximate: "zt-approximate",
  interval: "zt-interval",
  "one-of": "zt-one-of",
  season: "zt-interval",
  list: "zt-one-of",
};

// The class every parked or flagged item carries, composed alongside
// FORM_STYLING's form-based class (a flagged event still has a readable
// `date` and keeps its form styling) rather than replacing it.
const UNREADABLE_CLASS = "zt-unreadable";

// Applied to a vis group's own `className` field (not an item's), which
// vis-timeline mirrors onto that group's label, foreground row, background
// row and axis DOM - see project/ui-design.md for the tint-plus-bar the
// stylesheet paints from it.
const ACTIVE_LANE_CLASS = "zt-lane-active";

// The inactive lane's own className - carries no styling of its own, and
// exists only so a lane's className is always a real string. vis-timeline@
// 8.5.4's own Group.setData (dist/vis-timeline-graph2d.esm.js) computes
// `data && data.className || null` and, whenever that differs from the
// group's previous className, unconditionally calls addClassName(dom, that
// value) with no guard - addClassName does `classNames.split(" ")`, so
// handing it back `null` (what an omitted or `undefined` className coerces
// to) throws. A group deactivated by clearing its className to `undefined`
// hits that path directly: every lane needs a real string in both states.
const INACTIVE_LANE_CLASS = "zt-lane-inactive";

function edtfErrorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : "no further detail";
}

type Extent = { min: number; max: number };

const PARK_OFFSET_ZERO_SPAN_MS = 24 * 60 * 60 * 1000;

/**
 * Every instant `doc` can be read at, from `date` and `endDate` of every
 * event that parses, or null when none of them do. This is "the document's
 * own readable span" the parked-position rule offsets from - never the
 * viewport, and never limited to the events that are themselves parked or
 * flagged, since an event with a perfectly readable date still contributes to
 * where a broken sibling's date gets parked.
 */
function readableExtent(doc: TimelineDocument): Extent | null {
  const instants: number[] = [];
  const collect = (value: string) => {
    try {
      const range = toTimelineRange(value);
      instants.push(range.start.getTime());
      if (range.end) {
        instants.push(range.end.getTime());
      }
    } catch {
      // Contributes nothing - an unreadable date is not part of the span it
      // is itself offset from.
    }
  };
  for (const event of doc.events) {
    collect(event.date);
    if (event.endDate !== undefined) {
      collect(event.endDate);
    }
  }
  return instants.length === 0
    ? null
    : { min: Math.min(...instants), max: Math.max(...instants) };
}

function unionExtent(extents: Array<Extent | null>): Extent | null {
  const present = extents.filter((extent): extent is Extent => extent !== null);
  if (present.length === 0) {
    return null;
  }
  return {
    min: Math.min(...present.map((extent) => extent.min)),
    max: Math.max(...present.map((extent) => extent.max)),
  };
}

/**
 * The position every parked event in one document shares: the latest
 * readable point in `extent` plus five per cent of its span, or one day past
 * it where the span is zero (a document whose only readable dates are
 * instants).
 */
function anchorFromExtent(extent: Extent): Date {
  const span = extent.max - extent.min;
  const offset = span === 0 ? PARK_OFFSET_ZERO_SPAN_MS : span * 0.05;
  return new Date(extent.max + offset);
}

/**
 * Where every parked event in each of `documents` draws, keyed by document
 * id. A document with a readable date of its own is offset from that (see
 * anchorFromExtent); one with none borrows the readable extent of every other
 * document in `visibleDocumentIds`, and falls back to today when nothing
 * anywhere is readable (gap review, 2026-08-23).
 *
 * Callers recompute this on every visibility change rather than caching it
 * across one - the borrowed case is the one place a parked position depends
 * on something outside its own document, so toggling an unrelated timeline
 * has to move it even though zooming never does.
 */
export function computeParkedAnchors(
  documents: Map<string, TimelineDocument>,
  visibleDocumentIds: Set<string>,
): Map<string, Date> {
  const ownExtents = new Map<string, Extent | null>();
  for (const [id, doc] of documents) {
    ownExtents.set(id, readableExtent(doc));
  }
  const anchors = new Map<string, Date>();
  for (const [id, extent] of ownExtents) {
    if (extent) {
      anchors.set(id, anchorFromExtent(extent));
      continue;
    }
    const borrowed = unionExtent(
      Array.from(ownExtents.entries())
        .filter(
          ([otherId]) => otherId !== id && visibleDocumentIds.has(otherId),
        )
        .map(([, otherExtent]) => otherExtent),
    );
    anchors.set(id, borrowed ? anchorFromExtent(borrowed) : new Date());
  }
  return anchors;
}

/**
 * The vis-timeline item for one event, shared by the initial render and a
 * refresh after an edit.
 *
 * `endDate` is what makes an event a range (schema.ts); when it is present,
 * the end endpoint comes from its own resolved instant, not from `date`.
 * `date` alone still supplies the end when `endDate` is absent, which is what
 * keeps a range authored entirely inside `date` as an EDTF Interval or Set
 * (no `endDate`) rendering exactly as it always has.
 *
 * The styling class always comes from `date`'s own form, never from
 * `endDate`: a separate endDate makes an unambiguous span out of two plain
 * instants, so there is no one-of/interval claim in `date` itself for the
 * styling to draw apart.
 *
 * A `date` that will not parse has no start to draw at, so the canvas
 * fabricates one at `parkedAnchor` (the document-wide position every parked
 * event in it shares - see computeParkedAnchors) and marks the item
 * non-editable through vis-timeline's own per-item `editable` flag, which
 * gates the drag handle itself: a delta measured from a fabricated position
 * is not a date. Callers that never hand an unreadable `date` to this
 * function (every one besides the initial render and the toggle listener,
 * since a freshly typed or dragged date is always readable) need not supply
 * `parkedAnchor` at all; today is used if the rare case still hits it.
 *
 * An unreadable `endDate` does not park the event: `date` is real
 * information the document holds, so the event draws at its own start as a
 * flagged point, losing its span rather than its place.
 *
 * `editable` is the library-wide write permission, defaulted to true for
 * every caller that never hands one - every write path in this file besides
 * the initial render and a refresh, since a freshly created or edited event
 * only exists because the write it came from already succeeded. A parked
 * item ignores it and stays non-editable regardless: a delta measured from a
 * fabricated position is not a date whether or not the library can be
 * written, so the two reasons compose one way only, never enabling each
 * other.
 */
export function buildTimelineItem(
  documentId: string,
  event: Event,
  parkedAnchor?: Date,
  editable = true,
) {
  // A tracked event's group is its document's sub-lane (TASK-15), never the
  // document's own top-level group - the parent draws no items of its own
  // once it has nested groups, only the union of its children's.
  const groupId =
    event.track !== undefined
      ? trackGroupId(documentId, event.track)
      : documentId;

  let dateRange: ReturnType<typeof toTimelineRange>;
  try {
    dateRange = toTimelineRange(event.date);
  } catch (err) {
    return {
      id: visItemId(documentId, event.id),
      group: groupId,
      content: event.title,
      start: parkedAnchor ?? new Date(),
      editable: false,
      title: `${event.title} - ${edtfErrorMessage(err)}`,
      className: UNREADABLE_CLASS,
      tags: event.tags,
    };
  }

  // An extent the user asserted, versus a point known to some precision.
  //
  // toTimelineRange returns an `end` for every value, because every EDTF value
  // spans something: "1795" spans a year, "1789-07-14" spans a day. Using it
  // unconditionally made bar width mean the precision of the date rather than
  // the duration of the event, which is why a plain year drew as a five-pixel
  // bar on a decade-wide view and a day drew as a sliver, with the title
  // clipped inside it (TASK-44).
  //
  // Only these four forms assert an extent, and they are exactly the ones
  // TASK-28's decision requires keep rendering as a range when they appear in
  // `date` alone with no endDate. The other three - plain, uncertain,
  // approximate - are a single instant carrying a precision, and get no end,
  // so vis draws them as a box: a marker at the instant with the label above
  // it rather than squeezed inside a bar.
  let end = EXTENT_FORMS.has(dateRange.form) ? dateRange.end : undefined;
  let endDateError: string | undefined;
  if (event.endDate !== undefined) {
    try {
      end = toTimelineRange(event.endDate).start;
    } catch (err) {
      end = undefined;
      endDateError = edtfErrorMessage(err);
    }
  }

  const formClass = FORM_STYLING[dateRange.form];
  return {
    id: visItemId(documentId, event.id),
    group: groupId,
    content: event.title,
    start: dateRange.start,
    ...(end ? { end } : {}),
    editable,
    title: endDateError
      ? `${event.title} (${event.date}) - ${endDateError}`
      : `${event.title} (${event.date})`,
    className: endDateError
      ? [formClass, UNREADABLE_CLASS].filter(Boolean).join(" ")
      : formClass,
    tags: event.tags,
  };
}

// Last payload onMove received, so a test can assert the drag path actually
// ran rather than inferring it from a DOM that deliberately does not change
// (onMove refuses the edit).
let lastMovePayload: Record<string, unknown> | undefined;

export function getLastMovePayload(): Record<string, unknown> | undefined {
  return lastMovePayload;
}

/**
 * Builds every readable timeline in `timelines` into `container` and wires up
 * drag write-back. `onSelect` receives the namespaced id of the single
 * selected item, or null when the selection is empty. `onDocumentChange`, if
 * given, receives a document whenever a create replaces this function's own
 * copy of it with a freshly written one - the caller's separate `documents`
 * map (timelineTab.ts keeps one for the editor panel) needs the same update or
 * a newly created event is invisible to it until something else refreshes it.
 *
 * `container` must come from the tab's own document. vis-timeline reads
 * layout from it immediately, so a detached element renders at zero height and
 * looks like a failure to draw.
 *
 * Every group starts visible, ordered the way `timelines` was handed in. The
 * sidebar (timelineTab.ts) never rebuilds these DataSets to toggle or
 * reorder a lane: it flips a group's `visible` field and rewrites `order`
 * fields on the returned `groups` DataSet, which is what keeps a toggle
 * instant and re-reads no document.
 *
 * `libraryEditable` is read once at tab-open and never re-read here - the
 * one input the read-only rule follows, never the count of timelines this
 * call was handed. It reaches every item through buildTimelineItem's own
 * `editable` parameter rather than through vis-timeline's global
 * `options.editable`, composed with which lane is active (below): an item's
 * effective editable is `libraryEditable && <its document is the active
 * one>`, recomputed through the same per-item flag whenever activation
 * changes rather than through a second, global mechanism. A parked item
 * still ignores both and stays non-editable regardless (buildTimelineItem's
 * own doc, and TASK-38) - non-editable wins wherever any reason applies. It
 * also refuses the click-to-create gesture directly, since that gesture has
 * no vis-level editable flag of its own to gate it - see the "click" handler
 * below.
 *
 * Exactly one visible lane is active at a time, never expressed as vis
 * state: `activeDocumentId` below is a plain closure variable, restored on
 * every activation change rather than read back off vis, so a future rebuild
 * of the vis instance (TASK-43) has something plain to restore it from. It
 * starts as the topmost of `timelines` (index 0, the same array order the
 * groups below draw as `order: 0`), which is what makes a single visible
 * timeline behave exactly as it did before this task existed - it is the
 * only lane there is to be active. Activation follows an explicit act -
 * clicking a lane, an event in it, or (timelineTab.ts) its sidebar row -
 * never a visibility toggle turning a lane on, which is the ordinary "bring
 * up a reference chronology while editing another" gesture and must not move
 * the drag handles out from under the user. The `groups.on("update", ...)`
 * listener below is the one place activation moves on its own: whenever the
 * active document stops being visible - toggled off, or (the zero-then-one
 * recovery case) never chosen because nothing was visible at all - it falls
 * back to the topmost still-visible timeline, or to no active timeline when
 * none is.
 */
export function renderCanvas(
  container: HTMLElement,
  timelines: StoredTimeline[],
  libraryID: number,
  libraryEditable: boolean,
  onSelect: (id: string | null) => void,
  onDocumentChange?: (doc: TimelineDocument) => void,
): {
  timeline: Timeline;
  items: DataSet<any>;
  groups: DataSet<any>;
  activateDocument: (documentId: string | null) => void;
  getActiveDocument: () => string | null;
  setTagFilter: (tags: ReadonlySet<string>) => void;
  refreshParkedAnchorsAfterEdit: (documentId: string) => void;
} {
  // Keyed by document id and shared with `onMove` below, so a write updates
  // the same object callers of renderCanvas hold onto (timelineTab.ts keeps
  // its own map over the same `doc` references for the event editor).
  const documents = new Map<string, TimelineDocument>(
    timelines.map(({ doc }) => [doc.id, doc]),
  );

  // See the docblock above: the topmost timeline starts active, so a single
  // visible timeline is always the active one.
  let activeDocumentId: string | null = timelines[0]?.doc.id ?? null;

  // Every group starts visible (below), so the initial anchors are computed
  // against every loaded document.
  const initialAnchors = computeParkedAnchors(
    documents,
    new Set(documents.keys()),
  );

  const items = new DataSet(
    timelines.flatMap(({ doc }) =>
      doc.events.map((event) =>
        buildTimelineItem(
          doc.id,
          event,
          initialAnchors.get(doc.id),
          libraryEditable && doc.id === activeDocumentId,
        ),
      ),
    ),
  );

  /**
   * A document's top-level group, plus one nested sub-lane group per track its
   * events name (TASK-15). A document with no tracked events gets exactly the
   * row it always did - no `nestedGroups` field at all - which is what keeps
   * every timeline that has never used a track rendering unchanged.
   *
   * The parent carries no items of its own once it has sub-lanes
   * (buildTimelineItem routes a tracked event to its sub-lane's group, never
   * the document's), so nesting never gives one document two places an event
   * could land.
   */
  function buildGroupRows(
    doc: TimelineDocument,
    order: number,
    laneClass: string,
  ): Array<{
    id: string;
    content: string;
    order: number;
    visible: boolean;
    className: string;
    nestedGroups?: string[];
  }> {
    const tracks = tracksOf(doc);
    const parent = {
      id: doc.id,
      content: doc.name,
      order,
      visible: true,
      className: laneClass,
      ...(tracks.length > 0
        ? { nestedGroups: tracks.map((track) => trackGroupId(doc.id, track)) }
        : {}),
    };
    const children = tracks.map((track, trackOrder) => ({
      id: trackGroupId(doc.id, track),
      content: track,
      order: trackOrder,
      visible: true,
      className: laneClass,
    }));
    return [parent, ...children];
  }

  const groups = new DataSet(
    timelines.flatMap(({ doc }, order) =>
      buildGroupRows(
        doc,
        order,
        doc.id === activeDocumentId ? ACTIVE_LANE_CLASS : INACTIVE_LANE_CLASS,
      ),
    ),
  );

  /**
   * Every top-level document group's id, keyed off `documents` rather than the
   * DataSet's own shape, so a sub-lane row (nested under one, same DataSet,
   * same `order` field but scoped to its own siblings, never comparable to a
   * document's) is never mistaken for one. Every caller that treats a groups
   * row as a document - activation fallback, parked-anchor visibility, the
   * sidebar - reads through this rather than the DataSet directly.
   */
  function documentGroupRows(): Array<{ id: string; visible?: boolean }> {
    return (
      groups.get({ order: "order" }) as Array<{
        id: string;
        visible?: boolean;
      }>
    ).filter((group) => documents.has(String(group.id)));
  }

  // The tag filter, applied through a DataView rather than by rebuilding
  // `items` itself: every write path above (rebuildDocumentItems, onMove,
  // click-to-create, and timelineTab.ts's save/create/delete callbacks) keeps
  // writing straight to the real DataSet, and vis-timeline's own coercion
  // pipe (typeCoerceDataSet) forwards those writes through the view. Only
  // `refresh()` needs calling when the filter itself changes. An empty set
  // means no filter is active, so nothing is hidden.
  let tagFilter: ReadonlySet<string> = new Set();
  function itemMatchesTagFilter(item: { tags?: string[] }): boolean {
    return (
      tagFilter.size === 0 ||
      (item.tags ?? []).some((tag) => tagFilter.has(tag))
    );
  }
  const itemsView = new DataView(items, { filter: itemMatchesTagFilter });

  /** Every group id currently visible, read straight off the live groups DataSet. */
  function visibleDocumentIds(): Set<string> {
    return new Set(
      documentGroupRows()
        .filter((group) => group.visible !== false)
        .map((group) => String(group.id)),
    );
  }

  /**
   * Rebuilds every item of `documentId` with its current parked anchor (if
   * any of its events are parked) and its current editable state - the same
   * shape buildTimelineItem always produces, just re-derived rather than
   * re-read from storage. Called after activation changes, on exactly the
   * two documents it affects (the previously and newly active one), never on
   * every loaded document.
   */
  function rebuildDocumentItems(documentId: string): void {
    const doc = documents.get(documentId);
    if (!doc) {
      return;
    }
    const anchor = computeParkedAnchors(documents, visibleDocumentIds()).get(
      documentId,
    );
    const editable = libraryEditable && documentId === activeDocumentId;
    for (const event of doc.events) {
      items.update(buildTimelineItem(documentId, event, anchor, editable));
    }
  }

  /**
   * The one place an edit made in this tab re-derives parked positions.
   *
   * buildTimelineItem falls back to `new Date()` when it is handed no anchor,
   * so an event that becomes parked through the editor drew on today and left
   * the viewport entirely - it read as deleted until the tab was reopened,
   * which recomputed anchors properly on the way in.
   *
   * Two documents can move, not one. The edited document's own parked events
   * follow its readable extent, and a document with NO readable date borrows
   * the visible extent, so an edit that changed what is readable anywhere
   * moves every borrower too. That is the same rule the groups listener below
   * applies on a visibility change, for the same reason.
   */
  function refreshParkedAnchorsAfterEdit(documentId: string): void {
    rebuildDocumentItems(documentId);
    for (const [otherId, doc] of documents) {
      if (otherId === documentId || readableExtent(doc) !== null) {
        continue;
      }
      rebuildDocumentItems(otherId);
    }
  }

  /**
   * The one place `activeDocumentId` changes. Composes with libraryEditable
   * (never bypasses it) and with a parked event's own hardcoded
   * non-editability (rebuildDocumentItems goes through buildTimelineItem,
   * which never looks at the editable it's handed for a parked item) - so
   * the two reasons an item might refuse a drag stay independent, per the
   * plan's "non-editable wins wherever either reason applies".
   */
  /**
   * A document's own group id plus every sub-lane group nested under it - the
   * full set of rows activation's className has to reach, so a document with
   * tracks (TASK-15) tints every one of its lanes together rather than just
   * its own top-level row.
   */
  function laneRowIds(documentId: string): string[] {
    const doc = documents.get(documentId);
    return doc
      ? [
          documentId,
          ...tracksOf(doc).map((track) => trackGroupId(documentId, track)),
        ]
      : [documentId];
  }

  function activateDocument(documentId: string | null): void {
    if (documentId === activeDocumentId) {
      return;
    }
    const previous = activeDocumentId;
    activeDocumentId = documentId;
    if (previous !== null && documents.has(previous)) {
      for (const id of laneRowIds(previous)) {
        groups.update({ id, className: INACTIVE_LANE_CLASS });
      }
      rebuildDocumentItems(previous);
    }
    if (documentId !== null && documents.has(documentId)) {
      for (const id of laneRowIds(documentId)) {
        groups.update({ id, className: ACTIVE_LANE_CLASS });
      }
      rebuildDocumentItems(documentId);
    }
  }

  const timeline = new Timeline(container, itemsView, groups, {
    editable: {
      updateTime: true,
      updateGroup: false,
      add: false,
      remove: false,
    },
    stack: true,
    orientation: "top",
    margin: { item: 8 },
    zoomKey: "ctrlKey",
    // vis-timeline's own default - named explicitly because the sidebar's
    // reorder buttons depend on it: a group's numeric `order` field is what
    // decides the vertical order, and rewriting that field is the entire
    // reorder mechanism.
    groupOrder: "order",

    // vis-timeline's own onMove contract calls this callback once, whenever
    // it is called - _onDragEnd (vis-timeline/.../vis-timeline-graph2d.js)
    // does nothing else with `props` after invoking it, so a callback that
    // resolves after an await is not racing anything internal. That is what
    // makes the async write below safe: the item's DOM position simply holds
    // at the raw dragged spot until the callback fires, then snaps to
    // whatever this call actually wrote.
    onMove(item: any, callback: (item: any | null) => void) {
      const derived = parseVisItemId(String(item.id));
      lastMovePayload = {
        id: item.id,
        content: item.content,
        start: item.start,
        end: item.end ?? null,
        hasEnd: item.end !== undefined,
        group: item.group ?? null,
        hasGroup: "group" in item && item.group !== undefined,
        derivedDocumentId: derived.documentId,
        derivedEventId: derived.eventId,
      };

      void (async () => {
        const targetDoc = documents.get(derived.documentId);
        const index =
          targetDoc?.events.findIndex((e) => e.id === derived.eventId) ?? -1;
        if (!targetDoc || index === -1) {
          callback(null);
          return;
        }
        const event = targetDoc.events[index];

        try {
          // The document a write belongs to always comes from the namespaced
          // id, never from item.group - vis-timeline does not guarantee group
          // agrees with it (see visItemId above).
          const dateRange = toTimelineRange(event.date);
          // Mirrors buildTimelineItem's own choice of end endpoint: endDate
          // owns it when present, `date` alone otherwise.
          const originalEnd =
            event.endDate !== undefined
              ? toTimelineRange(event.endDate).start
              : dateRange.end;
          const proposedStart = item.start as Date;
          const proposedEnd = item.end as Date | undefined;

          const startDelta =
            proposedStart.getTime() - dateRange.start.getTime();
          const endDelta =
            originalEnd !== undefined && proposedEnd !== undefined
              ? proposedEnd.getTime() - originalEnd.getTime()
              : undefined;

          const changes: EventEdits = {
            date: shiftEdtfDate(event.date, {
              ...(startDelta !== 0 ? { start: startDelta } : {}),
              // Only folds the end delta into `date` itself when `date` is
              // what encodes the range (no endDate): shiftEdtfDate falls
              // back to `delta.end` for a plain instant when `delta.start`
              // is omitted, which would wrongly move a single-instant
              // `date` by the end delta once endDate owns the end.
              ...(event.endDate === undefined &&
              endDelta !== undefined &&
              endDelta !== 0
                ? { end: endDelta }
                : {}),
            }),
          };
          if (event.endDate !== undefined && endDelta !== undefined) {
            changes.endDate = shiftEdtfDate(event.endDate, {
              start: endDelta,
            });
          }

          const result = await updateTimelineDocument(
            (current) => updateEvent(current, derived.eventId, changes),
            derived.documentId,
            libraryID,
          );

          if (result === null) {
            // Nothing actually changed (e.g. a drag that released back where
            // it started) - accept the drop as-is, nothing was written.
            callback(item);
            return;
          }
          const updatedEvent = result.events.find(
            (e) => e.id === derived.eventId,
          );
          if (!updatedEvent) {
            callback(null);
            return;
          }
          targetDoc.events[index] = updatedEvent;
          // Passes the freshly built item, not the raw dragged one: a
          // year-only date always lands on Jan 1, a day-precision one keeps
          // whatever the drag actually resolved to, and either way the
          // canvas ends up showing exactly what was written, not where the
          // pointer happened to let go.
          callback(
            buildTimelineItem(
              derived.documentId,
              updatedEvent,
              undefined,
              libraryEditable && derived.documentId === activeDocumentId,
            ),
          );
        } catch (err) {
          logFailure(
            `[zoteroTimeline] failed to write drag for event ${derived.eventId}: ${(err as Error).message}`,
            err,
          );
          callback(null);
        }
      })();
    },
  });

  /**
   * A parked event's position depends on which other timelines are visible
   * only when its own document has no readable date at all (computeParkedAnchors)
   * - every other parked event's anchor comes solely from its own document and
   * never moves here. Listening on the groups DataSet itself, rather than
   * requiring the sidebar's toggle handler to call back in, is what makes this
   * work without the sidebar (timelineTab.ts) knowing parked events exist:
   * `visible` already flows through this DataSet for every reason it was
   * built, and this just reads the same field.
   *
   * Reads only `documents`, already held in memory from the initial render or
   * updated in place by onMove/click-to-create above - no document is
   * re-read.
   *
   * The same listener also carries the active-lane fallback: if the active
   * document just stopped being visible - toggled off directly, or
   * (activeDocumentId already null) never chosen because nothing was visible
   * until this update - activation moves to the topmost still-visible
   * timeline, the rows' own `order` already sorted ascending by
   * `documentGroupRows()` below - document rows only, never a sub-lane: a
   * sub-lane's `order` is scoped to its own siblings under one parent, not
   * comparable against another document's, so it must never be read as if it
   * were one. Ordinary reordering or toggling a lane *on* while the active
   * one stays visible leaves this condition false and activation untouched,
   * which is what keeps a toggle-on from stealing the handles out from under
   * whoever is mid-edit elsewhere.
   *
   * The work itself runs a microtask after the groups DataSet's own "update"
   * dispatch finishes, never inside this listener's own call frame.
   * `DataSetPart._trigger` (vis-data/peer/umd/vis-data.js:12192-12199) calls
   * every subscriber of an event synchronously, one after another on one call
   * stack; `groups.on("update", ...)` below is one of those subscribers, so a
   * write made from inside it runs with the groups DataSet's own dispatch
   * loop still on the stack underneath it, not after it. That is not a
   * redraw-timing difference between the two DataSets: `ItemSet._onUpdate`
   * (items) and `_onAddGroups` (groups) both end the same way, at
   * `body.emitter.emit("_change", { queue: true })`
   * (vis-timeline-graph2d.js:28498 and :28583), and Core's own "_change"
   * listener (:32064-32068) sends a queued change to `_redraw`, which
   * `throttle()` (:13641) always defers to the next requestAnimationFrame -
   * never synchronously, from either an items write or a groups write. What
   * the microtask actually escapes is the open DataSet dispatch itself:
   * writing `items` from inside the still-running `groups` "update" dispatch
   * is what let vis-timeline reach into a group it had not finished
   * reconciling and throw (measured: `groups.update({ visible: true })` on a
   * document holding a parked event, from either the sidebar checkbox or a
   * jump-triggered reveal, throws inside vis-timeline's own
   * `_orderGroups`). Deferring past the dispatch removes the re-entrancy
   * without changing what gets drawn: `pendingParkedAndActivationRefresh`
   * coalesces several synchronous `groups.update()` calls (batch reorders, a
   * hide followed immediately by a reveal) into the single microtask that
   * runs after the last of them, and that microtask re-reads visibility
   * fresh rather than closing over anything computed before it ran, so the
   * result reflects every write that landed by the time it executes, not
   * just the one that happened to schedule it.
   */
  let pendingParkedAndActivationRefresh = false;
  function refreshParkedAnchorsAndActivation(): void {
    const rows = documentGroupRows();
    const visibleIds = new Set(
      rows.filter((group) => group.visible !== false).map((g) => String(g.id)),
    );

    if (activeDocumentId === null || !visibleIds.has(activeDocumentId)) {
      const topmostVisible = rows.find((group) => group.visible !== false);
      activateDocument(topmostVisible ? String(topmostVisible.id) : null);
    }

    const anchors = computeParkedAnchors(documents, visibleIds);
    const updates: ReturnType<typeof buildTimelineItem>[] = [];
    for (const [documentId, doc] of documents) {
      if (readableExtent(doc) !== null) {
        continue; // this document's own anchor never depends on visibility
      }
      const anchor = anchors.get(documentId)!;
      const editable = libraryEditable && documentId === activeDocumentId;
      for (const event of doc.events) {
        try {
          toTimelineRange(event.date);
        } catch {
          updates.push(buildTimelineItem(documentId, event, anchor, editable));
        }
      }
    }
    if (updates.length > 0) {
      items.update(updates);
    }
  }
  groups.on("update", () => {
    if (pendingParkedAndActivationRefresh) {
      return;
    }
    pendingParkedAndActivationRefresh = true;
    void Promise.resolve().then(() => {
      pendingParkedAndActivationRefresh = false;
      try {
        refreshParkedAnchorsAndActivation();
      } catch (err) {
        logFailure(
          `[zoteroTimeline] failed to refresh parked anchors and activation: ${(err as Error).message}`,
          err,
        );
      }
    });
  });

  // Selecting a single item also activates its document (clicking an event
  // activates its lane, per the plan) - both routes below funnel through
  // here, so a real click and a scripted setSelection() activate exactly the
  // same way. Selecting nothing, or several items, leaves activation alone:
  // there is no single document a cleared or multi-item selection names.
  function handleSelectionChange(ids: string[]): void {
    onSelect(ids.length === 1 ? ids[0] : null);
    if (ids.length === 1) {
      activateDocument(parseVisItemId(ids[0]).documentId);
    }
  }

  // A real pointer selection emits vis-timeline's own "select" event, but its
  // setSelection() (used by tests, and by anything driving selection
  // programmatically rather than by click) does not - verified against
  // vis-timeline@8.5.4's source, where a click's own handler emits the event
  // itself after calling a different, internal setSelection. Wrapping the
  // public method here is what makes a scripted selection change reach the
  // editor, and now activation, the same way a click does.
  const setSelection = timeline.setSelection.bind(timeline);
  (timeline as any).setSelection = (ids: unknown, options?: unknown) => {
    setSelection(ids as any, options as any);
    const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
    handleSelectionChange(list.map(String));
  };

  timeline.on("select", (props: { items: string[] }) => {
    handleSelectionChange(props.items);
  });

  // Clicking empty space inside a document's row is how an event gets
  // created here - there is no dialog to interrupt the gesture, so the click
  // itself supplies both the target document (`group`) and the date (`time`).
  // Unlike onMove above, `group` is the only and correct signal for which
  // document (and, per TASK-15, which sub-lane) was clicked: onMove's "never
  // trust item.group" rule exists because an *existing* item's write-back
  // must key off the id-derived documentId, since vis-timeline does not
  // guarantee item.group agrees with it. There is no item yet here, so no id
  // exists to derive a document from - group is what the click actually
  // landed on, parsed through parseGroupId since it may name a sub-lane
  // rather than the document itself.
  //
  // `item` present means an existing item was clicked (handled by "select"
  // above); `group` absent means the click landed outside any document's row
  // (e.g. the time axis), and there is no target document to create into -
  // both cases do nothing, since creating a timeline itself is out of scope.
  //
  // A click that lands on empty space in a document's row activates that
  // row's lane first (only "select" handles an item click, above). When that
  // click found the lane already inactive, activating it is the click's
  // entire effect: the same click that would have created an event in an
  // active lane instead just arms this one, so one click into a document the
  // user was only reading never also writes into it. A second click, now
  // that the lane is active, falls through to create as usual.
  timeline.on(
    "click",
    (props: { item?: unknown; group?: unknown; time: Date }) => {
      if (props.item == null && props.group != null) {
        const documentId = parseGroupId(String(props.group)).documentId;
        if (documentId !== activeDocumentId) {
          activateDocument(documentId);
          return;
        }
      }
      if (props.item != null || props.group == null) {
        return;
      }
      // No item exists yet for a disabled state to attach to, so read-only
      // refuses the gesture itself rather than a control - the same outcome
      // every other write gets from its own editable flag being false.
      if (!libraryEditable) {
        return;
      }
      const { documentId, track } = parseGroupId(String(props.group));
      void (async () => {
        const targetDoc = documents.get(documentId);
        if (!targetDoc) {
          return;
        }
        try {
          const date = dateAtViewportPrecision(
            props.time,
            timeline.getWindow(),
          );
          let newEventId: string | undefined;
          const result = await updateTimelineDocument(
            (current) => {
              const next = addEvent(current, {
                title: getString("event-editor-untitled-title"),
                date,
                ...(track !== undefined ? { track } : {}),
              });
              newEventId = next.events[next.events.length - 1].id;
              return next;
            },
            documentId,
            libraryID,
          );
          if (!result || !newEventId) {
            return;
          }
          // Replaces this function's own copy so a drag started on the new
          // event right after creating it finds it - addEvent returns a new
          // document rather than mutating targetDoc in place, unlike an edit.
          documents.set(documentId, result);
          onDocumentChange?.(result);
          const newEvent = result.events.find((e) => e.id === newEventId)!;
          items.add(
            buildTimelineItem(
              documentId,
              newEvent,
              undefined,
              libraryEditable && documentId === activeDocumentId,
            ),
          );
          // The wrapped setSelection above notifies onSelect, which is what
          // opens the editor panel on the event just created.
          (timeline as any).setSelection([visItemId(documentId, newEvent.id)]);
        } catch (err) {
          logFailure(
            `[zoteroTimeline] failed to create an event in document ${documentId}: ${(err as Error).message}`,
            err,
          );
        }
      })();
    },
  );

  /**
   * Applies the tag filter: an item carrying none of `tags` is hidden,
   * every other item stays, and a lane emptied by the filter keeps its row
   * rather than collapsing (`groups` is untouched here).
   *
   * A selected item the filter just hid loses its selection. vis-timeline's
   * own item removal, driven by `itemsView.refresh()` below, already drops
   * it from the timeline's internal selection array (verified against
   * ItemSet's `_removeItem`), so this only has to tell `onSelect` the way a
   * real deselection would, which is what blanks the editor panel.
   */
  function setTagFilter(tags: ReadonlySet<string>): void {
    const hadSelection = timeline.getSelection().length > 0;
    tagFilter = tags;
    itemsView.refresh();
    if (hadSelection && timeline.getSelection().length === 0) {
      onSelect(null);
    }
  }

  return {
    timeline,
    items,
    groups,
    activateDocument,
    getActiveDocument: () => activeDocumentId,
    setTagFilter,
    refreshParkedAnchorsAfterEdit,
  };
}
