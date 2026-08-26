/**
 * Source picker: delegates to Zotero's own native item-selector dialog
 * (chrome://zotero/content/selectItemsDialog.xhtml), the dialog the built-in
 * Related panel's "+" button opens, rather than building one. A dialog opened
 * via ztoolkit.Dialog has no `require`, which the toolkit's
 * VirtualizedTableHelper needs for its bundled React table; the native
 * dialog runs in Zotero's main window and has no such dependency.
 *
 * onlyRegularItems is off, which is what makes notes selectable: Zotero
 * passes the flag through to the item tree as regularOnly, and with it off
 * the tree lists standalone notes and expands parents so child notes are
 * rows of their own. isRegularItem is the tree's only filter predicate, so
 * there is no "notes but not attachments" flag either: attachments and this
 * plugin's own container, storage and vocabulary notes become selectable
 * too, and are rejected after the pick rather than filtered out.
 *
 * filterLibraryIDs scopes the dialog to the event's own library, and the
 * picked item's libraryID is checked again on the way out: a foreign
 * libraryID on a source is always a bug per project/data-model.md, so both
 * paths that could produce one are closed.
 */
import { labelForItem } from "./sourceLabels";
import { CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG } from "./storage";

const PLUGIN_TAGS = [CONTAINER_TAG, STORAGE_TAG, VOCABULARY_TAG];

/**
 * Rejects a pick the dialog could not filter out itself. Exported apart from
 * pickSource so it can be tested without driving the modal dialog.
 */
export function assertEligible(
  item: Zotero.Item,
  libraryID: number,
): Zotero.Item {
  const label = labelForItem(item);
  if (item.isAttachment()) {
    throw new Error(
      `"${label}" is an attachment; cite the item it belongs to instead.`,
    );
  }
  if (PLUGIN_TAGS.some((tag) => item.hasTag(tag))) {
    throw new Error(
      `"${label}" is one of this plugin's own items; it can't be a source.`,
    );
  }
  if (item.libraryID !== libraryID) {
    throw new Error(
      `"${label}" is in another library; a source has to be from this one.`,
    );
  }
  return item;
}

/**
 * Resolves with the item the user picked, or null if they cancelled. Throws
 * on an ineligible pick, naming why, so the caller can put the message next
 * to the form's other validation rather than the dialog reading as though
 * the click never registered.
 */
export async function pickSource(
  libraryID: number,
): Promise<Zotero.Item | null> {
  const io: {
    dataIn: null;
    dataOut: number[] | null;
    filterLibraryIDs: number[];
    singleSelection: boolean;
    onlyRegularItems: boolean;
  } = {
    dataIn: null,
    dataOut: null,
    filterLibraryIDs: [libraryID],
    singleSelection: true,
    onlyRegularItems: false,
  };

  Zotero.getMainWindow().openDialog(
    "chrome://zotero/content/selectItemsDialog.xhtml",
    "",
    "chrome,dialog=no,modal,centerscreen,resizable=yes",
    io,
  );

  const itemID = io.dataOut?.[0];
  if (!itemID) {
    return null;
  }

  const item = (await Zotero.Items.getAsync(itemID)) as Zotero.Item;
  return assertEligible(item, libraryID);
}
