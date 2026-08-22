/**
 * Pure in-memory operations on a TimelineDocument: add, update and remove an
 * event, and mint an event id unique within one document. No Zotero import
 * and no write - every export here is a valid `mutate` callback for
 * updateTimelineDocument, which is what keeps one edit to one note and keeps
 * the write path's read-modify-write honest.
 *
 * Mirrors zoteroMindmap's mutations.ts, including its central rule: removing
 * an object and leaving a reference to it is the one way a document goes
 * incoherent. An Event carries no reference to another Event - sources point
 * at Zotero items and notes, never at events in this or another document, per
 * project/data-model.md - so removeEvent has nothing else in this document to
 * clean up. That is unlike mindmap's removeNode, which also drops every link
 * touching the removed node.
 *
 * Optional fields are omitted, never assigned an explicit `undefined`, for
 * the same reason validate.ts's rebuildEvent does it: an explicit-undefined
 * key makes the result diverge by key membership from a literal that never
 * mentions the field, and documentCache tells a write's own notifier echo
 * from a real edit by comparing serialised strings.
 */
import type { Event, TimelineDocument } from "./schema";

/**
 * A random id, retried until it doesn't collide with an id already in `doc`.
 * Event ids are unique per document, not per library (project/data-model.md),
 * so the collision check is scoped to `doc.events` alone.
 */
export function mintEventId(doc: TimelineDocument): string {
  let id: string;
  do {
    id = `ev-${Math.random().toString(36).slice(2, 10)}`;
  } while (doc.events.some((event) => event.id === id));
  return id;
}

export type EventInput = {
  title: string;
  date: string;
  description?: string;
  endDate?: string;
  tags?: string[];
};

/**
 * Appends a new event, minting it a fresh id and writing `sources: []` (m-3
 * owns source links). Always changes the document, so unlike updateEvent and
 * removeEvent this never returns null.
 */
export function addEvent(
  doc: TimelineDocument,
  input: EventInput,
): TimelineDocument {
  const event: Event = {
    id: mintEventId(doc),
    title: input.title,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    date: input.date,
    ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    sources: [],
    tags: input.tags ?? [],
  };
  return { ...doc, events: [...doc.events, event] };
}

export type EventEdits = {
  title?: string;
  description?: string;
  date?: string;
  endDate?: string;
  tags?: string[];
};

/**
 * Applies `changes` to the named event only; every other event is untouched.
 * A key present in `changes` with value `undefined` clears that optional
 * field; a key absent from `changes` leaves the current value alone.
 *
 * Returns null when `eventId` does not name an event in `doc`, or when the
 * named event is byte-identical after applying `changes` - so a no-op edit
 * never reaches updateTimelineDocument's write.
 */
export function updateEvent(
  doc: TimelineDocument,
  eventId: string,
  changes: EventEdits,
): TimelineDocument | null {
  const index = doc.events.findIndex((event) => event.id === eventId);
  if (index === -1) {
    return null;
  }
  const current = doc.events[index];
  const updated: Event = { ...current, ...changes };
  if ("description" in changes && changes.description === undefined) {
    delete updated.description;
  }
  if ("endDate" in changes && changes.endDate === undefined) {
    delete updated.endDate;
  }
  if (JSON.stringify(updated) === JSON.stringify(current)) {
    return null;
  }
  const events = doc.events.slice();
  events[index] = updated;
  return { ...doc, events };
}

/**
 * Drops the named event and nothing else. Returns null when `eventId` does
 * not name an event in `doc`.
 */
export function removeEvent(
  doc: TimelineDocument,
  eventId: string,
): TimelineDocument | null {
  const events = doc.events.filter((event) => event.id !== eventId);
  if (events.length === doc.events.length) {
    return null;
  }
  return { ...doc, events };
}
