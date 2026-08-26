/**
 * How a source item is named wherever one is shown: the picker's rejection
 * message first, then the editor's source list, the jump target, and m-6's
 * item-pane section as each is built. Kept apart from the picker and the
 * editor so any of them can label an item without pulling the others in
 * behind it.
 */

export const MISSING_ITEM_LABEL = "(missing item)";
export const EMPTY_NOTE_LABEL = "(empty note)";

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
    return item.getDisplayTitle();
  }
  const preview = notePreview(item);
  const parentID = item.parentID;
  if (!parentID) {
    return preview;
  }
  const parent = Zotero.Items.get(parentID) as Zotero.Item | false;
  return parent ? `${preview} — ${parent.getDisplayTitle()}` : preview;
}
