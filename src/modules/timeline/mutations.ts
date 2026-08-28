/**
 * Pure in-memory operations on a TimelineDocument: add, update and remove an
 * event or a source on one event, and mint an event id unique within one
 * document. No Zotero import and no write - every export here is a valid
 * `mutate` callback for updateTimelineDocument, which is what keeps one edit
 * to one note and keeps the write path's read-modify-write honest.
 *
 * A source is addressed by its index within `event.sources` rather than by an
 * id: a SourceRef has no id in project/data-model.md, and adding one would be
 * a change to that file rather than a local convenience.
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
import type { Event, SourceRef, TimelineDocument } from "./schema";

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
  track?: string;
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
    ...(input.track !== undefined ? { track: input.track } : {}),
  };
  return { ...doc, events: [...doc.events, event] };
}

/**
 * Appends a copy of `source` to `doc`, under an id minted fresh in `doc`.
 *
 * Not addEvent with extra arguments: addEvent forces `sources: []` because
 * m-3 owns source links, and carrying the sources across is the entire reason
 * duplication exists. Retyping a title is cheap; retyping a source list is
 * not.
 *
 * The id is minted against the TARGET document, so a copy cannot collide with
 * an event already there, and the original keeps its own id. Event ids are
 * unique per document rather than per library (project/data-model.md), so two
 * documents each holding an `ev-abc` is ordinary and not a clash.
 *
 * `keepSources: false` is for a copy landing in another library. A document
 * never holds a SourceRef naming a different library, and that invariant is
 * what makes a stray foreign libraryID diagnosable rather than normal, so the
 * refs are dropped here rather than rewritten. The caller is responsible for
 * saying so: dropping them quietly would hide the one loss this feature is
 * most likely to cause.
 *
 * The copy is independent from the moment it lands. Nothing links the two
 * afterwards and nothing reconciles them; tags are what relate them.
 */
export function copyEventInto(
  doc: TimelineDocument,
  source: Event,
  keepSources: boolean,
): { doc: TimelineDocument; event: Event } {
  const event: Event = {
    id: mintEventId(doc),
    title: source.title,
    ...(source.description !== undefined
      ? { description: source.description }
      : {}),
    date: source.date,
    ...(source.endDate !== undefined ? { endDate: source.endDate } : {}),
    // Cloned, not shared: a copy that aliased the original's array would make
    // an edit to one show up in the other, which is exactly what "independent
    // from the moment it lands" rules out.
    sources: keepSources ? source.sources.map((ref) => ({ ...ref })) : [],
    tags: [...source.tags],
    ...(source.track !== undefined ? { track: source.track } : {}),
  };
  return { doc: { ...doc, events: [...doc.events, event] }, event };
}

export type EventEdits = {
  title?: string;
  description?: string;
  date?: string;
  endDate?: string;
  tags?: string[];
  track?: string;
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
  if ("track" in changes && changes.track === undefined) {
    delete updated.track;
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

export type SourceInput = {
  kind: "item" | "note";
  libraryID: number;
  key: string;
  typeId: string;
  name?: string;
};

/**
 * Whether two source refs make the same claim: same target, same type, same
 * free-text name. `libraryID` identifies what a ref resolves to but is not
 * part of what makes an add a duplicate - see the duplicates decision in
 * project/backlog/plans/2026-08-22-m-3-source-links.md.
 */
function isSameClaim(
  a: Pick<SourceRef, "kind" | "key" | "typeId" | "name">,
  b: Pick<SourceRef, "kind" | "key" | "typeId" | "name">,
): boolean {
  return (
    a.kind === b.kind &&
    a.key === b.key &&
    a.typeId === b.typeId &&
    a.name === b.name
  );
}

/**
 * Appends a SourceRef to the named event. Returns null when `eventId` does
 * not name an event in `doc`, or when `input` exactly duplicates a source
 * already on that event (same kind, key, typeId and name). A ref differing in
 * typeId or in name is a distinct claim and is allowed: one item can be both
 * the primary source for an event and the thing the argument contradicts.
 */
export function addSource(
  doc: TimelineDocument,
  eventId: string,
  input: SourceInput,
): TimelineDocument | null {
  const index = doc.events.findIndex((event) => event.id === eventId);
  if (index === -1) {
    return null;
  }
  const event = doc.events[index];
  const source: SourceRef = {
    kind: input.kind,
    libraryID: input.libraryID,
    key: input.key,
    typeId: input.typeId,
    ...(input.name !== undefined ? { name: input.name } : {}),
  };
  if (event.sources.some((existing) => isSameClaim(existing, source))) {
    return null;
  }
  const events = doc.events.slice();
  events[index] = { ...event, sources: [...event.sources, source] };
  return { ...doc, events };
}

export type SourceEdits = {
  typeId?: string;
  name?: string;
};

/**
 * Applies `changes` to the source at `index` on the named event; every other
 * source, and every other event, is untouched. A `name` key present in
 * `changes` with value `undefined` clears it; a key absent from `changes`
 * leaves the current value alone.
 *
 * Returns null when `eventId` does not name an event, when `index` does not
 * name a source on it, or when the named source is byte-identical after
 * applying `changes` - so a no-op edit never reaches updateTimelineDocument's
 * write.
 */
export function updateSource(
  doc: TimelineDocument,
  eventId: string,
  index: number,
  changes: SourceEdits,
): TimelineDocument | null {
  const eventIndex = doc.events.findIndex((event) => event.id === eventId);
  if (eventIndex === -1) {
    return null;
  }
  const event = doc.events[eventIndex];
  const current = event.sources[index];
  if (current === undefined) {
    return null;
  }
  const updated: SourceRef = { ...current, ...changes };
  if ("name" in changes && changes.name === undefined) {
    delete updated.name;
  }
  if (JSON.stringify(updated) === JSON.stringify(current)) {
    return null;
  }
  const sources = event.sources.slice();
  sources[index] = updated;
  const events = doc.events.slice();
  events[eventIndex] = { ...event, sources };
  return { ...doc, events };
}

/**
 * Drops the source at `index` on the named event, and nothing else. Returns
 * null when `eventId` does not name an event in `doc`, or when `index` does
 * not name a source on it.
 */
export function removeSource(
  doc: TimelineDocument,
  eventId: string,
  index: number,
): TimelineDocument | null {
  const eventIndex = doc.events.findIndex((event) => event.id === eventId);
  if (eventIndex === -1) {
    return null;
  }
  const event = doc.events[eventIndex];
  const sources = event.sources.filter((_, i) => i !== index);
  if (sources.length === event.sources.length) {
    return null;
  }
  const events = doc.events.slice();
  events[eventIndex] = { ...event, sources };
  return { ...doc, events };
}
