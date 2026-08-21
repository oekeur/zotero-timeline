/**
 * Runtime validation for the JSON read back out of a note.
 *
 * Hand-rolled type guards rather than a schema library: the shapes are small
 * and flat and this runs once per note open, so a library would buy nothing
 * and cost a dependency.
 *
 * Nothing here imports Zotero and nothing here writes. That is the whole
 * enforcement of "no silent repair": last-write-wins means a document repaired
 * on read becomes the only copy, and the user never authored it. An invalid
 * document is reported and left exactly as it is on disk.
 */
import edtf from "edtf";
import {
  CURRENT_SCHEMA_VERSION,
  type Event,
  type LinkType,
  type SourceRef,
  type TimelineDocument,
  type Vocabulary,
} from "./schema";

export type DateIssue = {
  eventId: string;
  field: "date" | "endDate";
  message: string;
};

export type ParseResult<T> =
  | { ok: true; doc: T; dateIssues: DateIssue[] }
  | { ok: false; error: string; documentVersion?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceRef(value: unknown): value is SourceRef {
  return (
    isRecord(value) &&
    (value.kind === "item" || value.kind === "note") &&
    typeof value.libraryID === "number" &&
    typeof value.key === "string" &&
    typeof value.typeId === "string" &&
    (value.name === undefined || typeof value.name === "string")
  );
}

function isEvent(value: unknown): value is Event {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.description === undefined ||
      typeof value.description === "string") &&
    typeof value.date === "string" &&
    (value.endDate === undefined || typeof value.endDate === "string") &&
    Array.isArray(value.sources) &&
    value.sources.every(isSourceRef) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag: unknown) => typeof tag === "string")
  );
}

export function isLinkType(value: unknown): value is LinkType {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string"
  );
}

/**
 * Rebuilds an event with its optional keys spread in only when present, never
 * assigned as an explicit undefined.
 *
 * An explicitly-undefined key makes the parsed object diverge by key
 * membership from a literal that never mentions the field, which breaks
 * round-trip comparison. The cache tells its own write's notifier echo from a
 * real edit by comparing serialised strings, so a document that does not
 * round-trip byte-identically defeats that comparison and the echo is never
 * suppressed.
 */
function rebuildEvent(event: Event): Event {
  return {
    id: event.id,
    title: event.title,
    ...(event.description !== undefined
      ? { description: event.description }
      : {}),
    date: event.date,
    ...(event.endDate !== undefined ? { endDate: event.endDate } : {}),
    sources: event.sources.map((source) => ({
      kind: source.kind,
      libraryID: source.libraryID,
      key: source.key,
      typeId: source.typeId,
      ...(source.name !== undefined ? { name: source.name } : {}),
    })),
    tags: event.tags,
  };
}

/**
 * Whether `edtf` can read a date string.
 *
 * A string the pinned edtf rejects may still be valid EDTF from a level it
 * does not implement, which is why the message says the plugin could not read
 * the date rather than that the date is invalid, and why a rejected date is
 * never rewritten.
 */
function readDate(value: string): string | null {
  try {
    edtf(value);
    return null;
  } catch (err) {
    return err instanceof Error && err.message
      ? err.message
      : "no further detail";
  }
}

function collectDateIssues(events: Event[]): DateIssue[] {
  const issues: DateIssue[] = [];
  for (const event of events) {
    const dateError = readDate(event.date);
    if (dateError !== null) {
      issues.push({
        eventId: event.id,
        field: "date",
        message: `could not read this date: ${dateError}`,
      });
    }
    if (event.endDate !== undefined) {
      const endError = readDate(event.endDate);
      if (endError !== null) {
        issues.push({
          eventId: event.id,
          field: "endDate",
          message: `could not read this date: ${endError}`,
        });
      }
    }
  }
  return issues;
}

/**
 * Turns unknown JSON into either a document or a named reason it is not one.
 *
 * The version is checked before any shape check. A document from a newer
 * plugin usually fails the shape checks too, and reporting "invalid events
 * array" for it would send the user to the wrong problem entirely.
 *
 * A date that will not parse costs its event, not the document: the issues
 * come back alongside the document rather than marked on it, so nothing about
 * a failed parse can ever be written back. That is true by construction here
 * rather than by remembering to strip marks before every write.
 */
export function parseTimelineDocument(
  data: unknown,
): ParseResult<TimelineDocument> {
  if (!isRecord(data)) {
    return { ok: false, error: "document is not an object" };
  }
  if (data.version !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `unsupported version: document is version ${String(
        data.version,
      )}, this plugin reads version ${CURRENT_SCHEMA_VERSION}`,
      documentVersion: data.version,
    };
  }
  if (typeof data.id !== "string" || data.id === "") {
    return { ok: false, error: "missing or invalid id" };
  }
  if (typeof data.name !== "string") {
    return { ok: false, error: "missing or invalid name" };
  }
  // Rejected rather than left to the timeline list, where a blank entry is
  // unpickable. Recorded in data-model.md alongside the shapes.
  if (data.name.trim() === "") {
    return { ok: false, error: "name is empty" };
  }
  if (!Array.isArray(data.events) || !data.events.every(isEvent)) {
    return { ok: false, error: "invalid events array" };
  }

  const events = data.events.map(rebuildEvent);
  return {
    ok: true,
    doc: {
      version: CURRENT_SCHEMA_VERSION,
      id: data.id,
      name: data.name,
      events,
    },
    dateIssues: collectDateIssues(events),
  };
}

/**
 * The vocabulary note's contents. Same version rule as a document, from the
 * same constant: restoring defaults over a vocabulary written by a newer
 * plugin would throw away link types this one cannot yet name.
 */
export function parseVocabulary(data: unknown): ParseResult<Vocabulary> {
  if (!isRecord(data)) {
    return { ok: false, error: "vocabulary is not an object" };
  }
  if (data.version !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `unsupported version: vocabulary is version ${String(
        data.version,
      )}, this plugin reads version ${CURRENT_SCHEMA_VERSION}`,
      documentVersion: data.version,
    };
  }
  if (!Array.isArray(data.types) || !data.types.every(isLinkType)) {
    return { ok: false, error: "invalid types array" };
  }
  return {
    ok: true,
    doc: {
      version: CURRENT_SCHEMA_VERSION,
      types: data.types.map((type: LinkType) => ({
        id: type.id,
        label: type.label,
      })),
    },
    dateIssues: [],
  };
}
