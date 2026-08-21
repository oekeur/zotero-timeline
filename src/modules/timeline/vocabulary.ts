/**
 * The library's link-type vocabulary: reading it, the defaults, and recreating
 * it when it has gone missing. Editing it is not here.
 *
 * Stored as a synced note under the container rather than in Zotero.Prefs, and
 * that is the deliberate divergence from mindmap. A preference is device-local,
 * so a timeline opened on a second machine would render against that machine's
 * vocabulary and every source link would show a label the author never chose.
 *
 * Links store a type's id and never its label, so renaming a label never
 * orphans a link, and a typeId that resolves to nothing is valid data rather
 * than corruption.
 */
import { getString } from "../../utils/locale";
import { warn } from "./containerGuard";
import { CURRENT_SCHEMA_VERSION, type LinkType } from "./schema";
import {
  VOCABULARY_TAG,
  buildVocabularyNoteHtml,
  createTaggedNote,
  readVocabularyFromNote,
  searchVocabularyNotes,
} from "./storage";

/**
 * What a source link whose typeId matches no type is called. A type can be
 * deleted while links still reference it, so every surface that names a type
 * renders the miss from here rather than showing a raw id.
 */
export const UNKNOWN_TYPE_LABEL = "(unknown type)";

/**
 * Adapted from mindmap's five, minus `directional`. A mindmap link joins two
 * nodes and needs a direction; a source link runs from an event to a Zotero
 * item and its direction is fixed by what the two ends are.
 */
export const DEFAULT_LINK_TYPES: LinkType[] = [
  { id: "cites", label: "cites" },
  { id: "supports", label: "supports" },
  { id: "contradicts", label: "contradicts" },
  { id: "primary-source-for", label: "primary source for" },
  { id: "related-to", label: "related to" },
];

/**
 * What a read found. Four states rather than two, and the distinction is the
 * whole point of the task: collapsing any of the middle two into "restore the
 * defaults" replaces a list the user edited with silence.
 *
 * The tag is what makes the distinction available. If kind came from parsing
 * the content, "a corrupt vocabulary note" and "no vocabulary note yet" would
 * be the same observation.
 */
export type VocabularyState =
  | "ok"
  | "recovered"
  | "unreadable"
  | "version-unsupported";

export type VocabularyResult = {
  types: LinkType[];
  state: VocabularyState;
  /** True when the library holds more than one live vocabulary note. */
  duplicated: boolean;
  /** Set when the note could not be read, for the surface that reports it. */
  message?: string;
};

/**
 * The library's vocabulary, recreating it from the defaults only when the
 * library genuinely has none.
 *
 * Recovery writes, so it goes through the storage queue. A caller reaching
 * this from a notifier observer must start it detached and never await it
 * there: a read path that writes is exactly the combination that wedges the
 * queue for the session.
 *
 * Lowest key wins when two live notes exist, the same rule the container uses
 * and for the same reason: item ids are device-local, so any other rule gives
 * two synced machines different answers. That state is reachable in normal
 * use, by recovering and then restoring the trashed note from the trash.
 */
export function warnVocabularyRecovered(): void {
  warn(getString("vocabulary-recovered"));
}

export async function readVocabulary(
  libraryID: number,
  // Injected so a spec can read a recovering library without reaching
  // getString, which throws outside the plugin's own bundle because the addon
  // global does not exist there.
  onRecovered: () => void = warnVocabularyRecovered,
): Promise<VocabularyResult> {
  const notes = await searchVocabularyNotes(libraryID);
  if (notes.length === 0) {
    await createTaggedNote(
      libraryID,
      VOCABULARY_TAG,
      buildVocabularyNoteHtml({
        version: CURRENT_SCHEMA_VERSION,
        types: DEFAULT_LINK_TYPES,
      }),
    );
    // Warned rather than done silently: every source link in the library
    // starts rendering as an unknown type, and the user needs to know the list
    // they edited is in the trash and restorable.
    onRecovered();
    return {
      types: DEFAULT_LINK_TYPES,
      state: "recovered",
      duplicated: false,
    };
  }

  const sorted = [...notes].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const duplicated = sorted.length > 1;

  try {
    return {
      types: readVocabularyFromNote(sorted[0]).types,
      state: "ok",
      duplicated,
    };
  } catch (err) {
    // Deliberately no recovery here. A note that will not parse, or one from a
    // newer plugin, still holds a list the user edited; writing the defaults
    // over it would be the silent replacement this whole path exists to
    // prevent. The caller reports it and the user decides.
    const reason =
      err instanceof Error && "reason" in err
        ? (err as { reason: string }).reason
        : "parse-failed";
    return {
      types: DEFAULT_LINK_TYPES,
      state:
        reason === "version-unsupported" ? "version-unsupported" : "unreadable",
      duplicated,
      message: (err as Error).message,
    };
  }
}

/** Looks a type up by id, never by label, so it survives a rename. */
export function findLinkType(
  types: LinkType[],
  id: string,
): LinkType | undefined {
  return types.find((type) => type.id === id);
}

/** The label to draw for a typeId, including the one that resolves to nothing. */
export function labelFor(types: LinkType[], id: string): string {
  return findLinkType(types, id)?.label ?? UNKNOWN_TYPE_LABEL;
}
