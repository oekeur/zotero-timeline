/**
 * How a source item is named wherever one is shown: the picker's rejection
 * message first, then the editor's source list, the jump target, and m-6's
 * item-pane section as each is built. Kept apart from the picker and the
 * editor so any of them can label an item without pulling the others in
 * behind it.
 */
import type { SourceRef } from "./schema";

export const MISSING_ITEM_LABEL = "(missing item)";
export const EMPTY_NOTE_LABEL = "(empty note)";
export const UNTITLED_ITEM_LABEL = "(untitled item)";

// Long enough to tell two notes apart at a glance, short enough that the
// label still fits on one line next to a validation message.
const NOTE_PREVIEW_LENGTH = 60;

// The entities Zotero's note editor actually emits. A DOM parse would be more
// thorough, but note HTML is simple enough not to warrant one here.
const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, " "],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, "&"],
];

function notePreview(item: Zotero.Item): string {
  let text = item.getNote().replace(/<[^>]*>/g, " ");
  for (const [pattern, replacement] of ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, " ").trim();

  if (text === "") {
    return EMPTY_NOTE_LABEL;
  }
  if (text.length <= NOTE_PREVIEW_LENGTH) {
    return text;
  }
  return `${text.slice(0, NOTE_PREVIEW_LENGTH).trimEnd()}…`;
}

/**
 * Labels a source item: a regular item by its title, a note by a preview of
 * its content rather than Zotero's derived title, which is a note's first
 * line and is often blank. A child note's label carries its parent's title
 * after it, because the picker lists child notes as rows of their own and
 * several can read identically.
 */
export function labelForItem(item: Zotero.Item): string {
  if (!item.isNote()) {
    // Zotero allows an item with no title and derives an empty string for it,
    // so a row named from this would render as nothing at all. Name it the way
    // a missing item and an empty note are named rather than leaving a blank.
    return item.getDisplayTitle() || UNTITLED_ITEM_LABEL;
  }
  const preview = notePreview(item);
  const parentID = item.parentID;
  if (!parentID) {
    return preview;
  }
  const parent = Zotero.Items.get(parentID) as Zotero.Item | false;
  return parent ? `${preview} — ${parent.getDisplayTitle()}` : preview;
}

/**
 * Labels a stored SourceRef by resolving it to the item it points at and
 * naming that, rather than reading ref.kind: a ref can outlive what it
 * points at being replaced, and the label should describe what is actually
 * there. Missing is reachable in normal use, between an erase and the prune
 * landing, and permanently in a group library the user has lost access to.
 */
export function labelForSource(ref: SourceRef): string {
  const item = Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.key);
  return item ? labelForItem(item) : MISSING_ITEM_LABEL;
}
