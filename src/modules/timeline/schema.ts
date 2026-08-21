/**
 * The shapes the plugin stores, transcribed from project/data-model.md. Pure
 * types and pure functions: nothing here imports Zotero, so nothing here can
 * write.
 *
 * Field names deviate from zotero-linked-mindmaps in three places, because the
 * data model chose first: the version field is `version` rather than
 * `schemaVersion`, the display field is `name` rather than `title`, and a
 * LinkType has no `directional`. A mindmap link joins two nodes and needs a
 * direction; a source link here runs from an event to a Zotero item, and what
 * the two ends are fixes its direction. Adding `directional` back is a change
 * to the data model, not a local one.
 */

/**
 * One constant for both stored shapes, the document and the vocabulary. Two
 * would drift, and "which version is this library on" would stop having an
 * answer.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

export type TimelineDocument = {
  /** Schema version, bumped on any breaking change. */
  version: number;
  /** Stable, unique within the library. */
  id: string;
  /** What the user calls it. */
  name: string;
  events: Event[];
};

export type Event = {
  /** Unique within its document, not across documents. */
  id: string;
  title: string;
  description?: string;
  /** EDTF (ISO 8601-2), as authored. Never rewritten to make it parse. */
  date: string;
  /** EDTF; present makes the event a range. */
  endDate?: string;
  sources: SourceRef[];
  /** Written from v1, so a tag authored now survives to the filtering work. */
  tags: string[];
};

export type SourceRef = {
  kind: "item" | "note";
  libraryID: number;
  /** What Zotero syncs by; numeric ids are device-local. */
  key: string;
  /** A LinkType id, or an id that no longer resolves. */
  typeId: string;
  /** Free text, for the distinction that fits one pair. */
  name?: string;
};

export type LinkType = {
  /** Stable; links store this, never the label. */
  id: string;
  /** Display only, safe to rename. */
  label: string;
};

export type Vocabulary = {
  version: number;
  /** One list per library. */
  types: LinkType[];
};

/**
 * The document exactly as it goes into the note. Two documents that serialise
 * identically are the same stored document, which is how a caller tells a
 * change it made itself apart from someone else's.
 *
 * A plain JSON.stringify, deliberately. Mindmap wraps this in a normalisation
 * step that collapses its NaN "unplaced node" marker to null before writing; a
 * timeline event has no position and no such marker, so there is nothing to
 * normalise.
 *
 * Determinism is the whole point, and it depends on the parser never assigning
 * an explicitly-undefined optional key. See parseTimelineDocument.
 */
export function serializeDocument(doc: TimelineDocument): string {
  return JSON.stringify(doc);
}
