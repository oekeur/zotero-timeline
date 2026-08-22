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

import { Timeline, DataSet } from "vis-timeline/standalone";
import { shiftEdtfDate, toTimelineRange } from "../../utils/edtfRange";
import { logFailure } from "../../utils/logging";
import { updateEvent, type EventEdits } from "./mutations";
import { updateTimelineDocument, type StoredTimeline } from "./storage";
import type { Event, TimelineDocument } from "./schema";

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
 * The vis-timeline item for one event, shared by the initial render and a
 * refresh after an edit.
 *
 * `endDate` is what makes an event a range (schema.ts); when it is present,
 * the end endpoint comes from its own resolved instant, not from `date`.
 * `date` alone still supplies the end when `endDate` is absent, which is what
 * keeps a range authored entirely inside `date` as an EDTF Interval or Set
 * (no `endDate`) rendering exactly as it always has.
 */
export function buildTimelineItem(documentId: string, event: Event) {
  const dateRange = toTimelineRange(event.date);
  const end =
    event.endDate !== undefined
      ? toTimelineRange(event.endDate).start
      : dateRange.end;
  return {
    id: visItemId(documentId, event.id),
    group: documentId,
    content: event.title,
    start: dateRange.start,
    ...(end ? { end } : {}),
    title: `${event.title} (${event.date})`,
    className: dateRange.approximate
      ? "zt-approximate"
      : dateRange.uncertain
        ? "zt-uncertain"
        : undefined,
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
 * selected item, or null when the selection is empty.
 *
 * `container` must come from the tab's own document. vis-timeline reads
 * layout from it immediately, so a detached element renders at zero height and
 * looks like a failure to draw.
 */
export function renderCanvas(
  container: HTMLElement,
  timelines: StoredTimeline[],
  libraryID: number,
  onSelect: (id: string | null) => void,
): { timeline: Timeline; items: DataSet<any> } {
  // Keyed by document id and shared with `onMove` below, so a write updates
  // the same object callers of renderCanvas hold onto (timelineTab.ts keeps
  // its own map over the same `doc` references for the event editor).
  const documents = new Map<string, TimelineDocument>(
    timelines.map(({ doc }) => [doc.id, doc]),
  );

  const items = new DataSet(
    timelines.flatMap(({ doc }) =>
      doc.events.map((event) => buildTimelineItem(doc.id, event)),
    ),
  );

  const groups = new DataSet(
    timelines.map(({ doc }) => ({ id: doc.id, content: doc.name })),
  );

  const timeline = new Timeline(container, items, groups, {
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
          callback(buildTimelineItem(derived.documentId, updatedEvent));
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

  // A real pointer selection emits vis-timeline's own "select" event, but its
  // setSelection() (used by tests, and by anything driving selection
  // programmatically rather than by click) does not - verified against
  // vis-timeline@8.5.4's source, where a click's own handler emits the event
  // itself after calling a different, internal setSelection. Wrapping the
  // public method here is what makes a scripted selection change reach the
  // editor the same way a click does.
  const setSelection = timeline.setSelection.bind(timeline);
  (timeline as any).setSelection = (ids: unknown, options?: unknown) => {
    setSelection(ids as any, options as any);
    const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
    onSelect(list.length === 1 ? String(list[0]) : null);
  };

  timeline.on("select", (props: { items: string[] }) => {
    onSelect(props.items.length === 1 ? props.items[0] : null);
  });

  return { timeline, items };
}
