// Captured at module-evaluation time, before vis-timeline's own module body
// runs, so it records exactly what Hammer's `typeof window === "undefined"`
// check will see. If this reports false, the deferred import did not defer.
export const MODULE_EVAL_ENV = {
  hasWindow: typeof window !== "undefined",
  hasDocument: typeof document !== "undefined",
};

import { Timeline, DataSet } from "vis-timeline/standalone";
import { toTimelineRange } from "../../utils/edtfRange";

/**
 * A hardcoded two-timeline, four-event fixture. It exists to answer the
 * questions the rendering spike was opened for, not to model the domain:
 * whether vis-timeline runs in a privileged Zotero window at all, and what a
 * drag actually hands back.
 *
 * Dates are EDTF, mapped through toTimelineRange, so the fixture exercises the
 * real date path rather than pre-baked Date objects.
 */
interface FixtureEvent {
  eventId: string;
  title: string;
  /** EDTF. See docs/user-guide/getting-started for the accepted forms. */
  date: string;
}

interface FixtureDocument {
  documentId: string;
  title: string;
  events: FixtureEvent[];
}

const FIXTURE: FixtureDocument[] = [
  {
    documentId: "doc-revolt",
    title: "Dutch Revolt",
    events: [
      { eventId: "ev-fury", title: "Iconoclastic Fury", date: "1566" },
      {
        eventId: "ev-utrecht",
        title: "Union of Utrecht",
        date: "1579-01-23",
      },
    ],
  },
  {
    documentId: "doc-sources",
    title: "Source production",
    events: [
      // Approximate: the "~" must survive into the rendered range.
      { eventId: "ev-pamphlets", title: "Pamphlet campaign", date: "1580~" },
      // The ranged item. onMove must report an `end` for this one.
      {
        eventId: "ev-truce",
        title: "Truce negotiations",
        date: "1607-04/1609-04",
      },
    ],
  },
];

/**
 * The items DataSet is keyed by id, and event ids are only unique within their
 * own document, so the key has to carry both. This is also the write-back
 * route: the document an edit belongs to is derived from here and never from
 * `item.group`, which vis-timeline does not guarantee to supply.
 */
function visItemId(documentId: string, eventId: string): string {
  return `${documentId}:${eventId}`;
}

// Last payload onMove received, so a test can assert the drag path actually
// ran rather than inferring it from a DOM that deliberately does not change
// (onMove refuses the edit).
let lastMovePayload: Record<string, unknown> | undefined;

export function getLastMovePayload(): Record<string, unknown> | undefined {
  return lastMovePayload;
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
 * Builds the fixture into `container` and logs every drag.
 *
 * `container` must come from the tab's own document. vis-timeline reads
 * layout from it immediately, so a detached element renders at zero height and
 * looks like a failure to draw.
 */
export function renderFixture(container: HTMLElement): Timeline {
  const items = new DataSet(
    FIXTURE.flatMap((doc) =>
      doc.events.map((event) => {
        const range = toTimelineRange(event.date);
        return {
          id: visItemId(doc.documentId, event.eventId),
          group: doc.documentId,
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
      }),
    ),
  );

  const groups = new DataSet(
    FIXTURE.map((doc) => ({ id: doc.documentId, content: doc.title })),
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

    // The spike's whole point. Log what the payload actually contains rather
    // than trusting the documented shape, then refuse the edit so the fixture
    // stays put across drags.
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

  return timeline;
}
