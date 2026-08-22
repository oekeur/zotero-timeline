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
import { toTimelineRange } from "../../utils/edtfRange";
import type { StoredTimeline } from "./storage";
import type { Event } from "./schema";

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

/** The vis-timeline item for one event, shared by the initial render and a refresh after an edit. */
export function buildTimelineItem(documentId: string, event: Event) {
  const range = toTimelineRange(event.date);
  return {
    id: visItemId(documentId, event.id),
    group: documentId,
    content: event.title,
    start: range.start,
    ...(range.end ? { end: range.end } : {}),
    title: `${event.title} (${event.date})`,
    className: range.approximate
      ? "zt-approximate"
      : range.uncertain
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
 * Builds every readable timeline in `timelines` into `container` and logs
 * every drag. `onSelect` receives the namespaced id of the single selected
 * item, or null when the selection is empty.
 *
 * `container` must come from the tab's own document. vis-timeline reads
 * layout from it immediately, so a detached element renders at zero height and
 * looks like a failure to draw.
 */
export function renderCanvas(
  container: HTMLElement,
  timelines: StoredTimeline[],
  onSelect: (id: string | null) => void,
): { timeline: Timeline; items: DataSet<any> } {
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

    // The write-back is TASK-26's job. Log what the payload actually contains
    // rather than trusting the documented shape, then refuse the edit so the
    // canvas stays put across drags for now.
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
      Zotero.debug(
        `[ZoteroTimeline] onMove payload: ${JSON.stringify({
          id: item.id,
          content: item.content,
          start: item.start,
          end: item.end ?? null,
          hasEnd: item.end !== undefined,
          group: item.group ?? null,
          hasGroup: "group" in item && item.group !== undefined,
          derivedDocumentId: derived.documentId,
          derivedEventId: derived.eventId,
          groupMatchesDerived:
            item.group === undefined
              ? "group absent"
              : String(item.group) === derived.documentId,
        })}`,
      );
      callback(null);
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
