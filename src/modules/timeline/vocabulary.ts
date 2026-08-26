/**
 * The library's link-type vocabulary: reading it, the defaults, editing it,
 * and recreating it when it has gone missing.
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
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_LINK_TYPES,
  type LinkType,
  type Vocabulary,
} from "./schema";
import {
  VOCABULARY_TAG,
  buildVocabularyNoteHtml,
  createTaggedNote,
  readDocumentFromNote,
  readVocabularyFromNote,
  searchStorageNotes,
  searchVocabularyNotes,
} from "./storage";

export { DEFAULT_LINK_TYPES };

/**
 * What a source link whose typeId matches no type is called. A type can be
 * deleted while links still reference it, so every surface that names a type
 * renders the miss from here rather than showing a raw id.
 */
export const UNKNOWN_TYPE_LABEL = "(unknown type)";

/**
 * What a read found. Five states rather than two, and the distinction is the
 * whole point of the task: collapsing any of the middle ones into "restore
 * the defaults" replaces a list the user edited with silence.
 *
 * The tag is what makes the distinction available. If kind came from parsing
 * the content, "a corrupt vocabulary note" and "no vocabulary note yet" would
 * be the same observation.
 */
export type VocabularyState =
  | "ok"
  | "recovered"
  | "absent"
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
 * Lowest key wins when two live notes exist, the same rule the container uses
 * and for the same reason: item ids are device-local, so any other rule gives
 * two synced machines different answers. That state is reachable in normal
 * use, by recovering and then restoring the trashed note from the trash.
 *
 * Returns null when the library has no vocabulary note at all, leaving the
 * caller to decide what "none yet" means: readVocabulary recovers the
 * defaults and writes them, peekVocabulary reports absence and writes
 * nothing.
 */
async function readStoredVocabulary(
  libraryID: number,
): Promise<VocabularyResult | null> {
  const notes = await searchVocabularyNotes(libraryID);
  if (notes.length === 0) {
    return null;
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

export function warnVocabularyRecovered(): void {
  warn(getString("vocabulary-recovered"));
}

/**
 * The library's vocabulary, recreating it from the defaults only when the
 * library genuinely has none.
 *
 * Recovery writes, so it goes through the storage queue. A caller reaching
 * this from a notifier observer must start it detached and never await it
 * there: a read path that writes is exactly the combination that wedges the
 * queue for the session.
 */
export async function readVocabulary(
  libraryID: number,
  // Injected so a spec can read a recovering library without reaching
  // getString, which throws outside the plugin's own bundle because the addon
  // global does not exist there.
  onRecovered: () => void = warnVocabularyRecovered,
): Promise<VocabularyResult> {
  const stored = await readStoredVocabulary(libraryID);
  if (stored) {
    return stored;
  }

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

/**
 * The library's vocabulary, same as readVocabulary, but creates nothing.
 *
 * A library with no vocabulary note yet reports state "absent" and the
 * defaults, for a surface that must show something without acquiring a
 * container just by being opened - the preference pane lists every editable
 * library, and readVocabulary's recovery would scatter a container and a
 * vocabulary note across every one of them before the user touched anything.
 */
export async function peekVocabulary(
  libraryID: number,
): Promise<VocabularyResult> {
  const stored = await readStoredVocabulary(libraryID);
  return (
    stored ?? {
      types: DEFAULT_LINK_TYPES,
      state: "absent",
      duplicated: false,
    }
  );
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

/**
 * A random id, retried until it doesn't collide with an id already in
 * `vocabulary`. Mirrors mutations.ts's mintEventId.
 */
export function mintLinkTypeId(vocabulary: Vocabulary): string {
  let id: string;
  do {
    id = `type-${Math.random().toString(36).slice(2, 10)}`;
  } while (vocabulary.types.some((type) => type.id === id));
  return id;
}

/**
 * Appends a new type, minting it a fresh id. Always changes the vocabulary,
 * unlike renameLinkType and removeLinkType, so this never returns null.
 */
export function addLinkType(vocabulary: Vocabulary, label: string): Vocabulary {
  const type: LinkType = { id: mintLinkTypeId(vocabulary), label };
  return { ...vocabulary, types: [...vocabulary.types, type] };
}

/**
 * Changes a type's label and never its id, which is what makes a rename
 * migration-free: every SourceRef keeps resolving through the same id.
 *
 * Returns null when `id` does not name a type in `vocabulary`, or when
 * `label` is byte-identical to the current one, so a no-op edit never reaches
 * updateVocabulary's write.
 */
export function renameLinkType(
  vocabulary: Vocabulary,
  id: string,
  label: string,
): Vocabulary | null {
  const index = vocabulary.types.findIndex((type) => type.id === id);
  if (index === -1 || vocabulary.types[index].label === label) {
    return null;
  }
  const types = vocabulary.types.slice();
  types[index] = { ...types[index], label };
  return { ...vocabulary, types };
}

/**
 * Drops the named type and nothing else - no SourceRef anywhere is touched.
 * Returns null when `id` does not name a type in `vocabulary`.
 */
export function removeLinkType(
  vocabulary: Vocabulary,
  id: string,
): Vocabulary | null {
  const types = vocabulary.types.filter((type) => type.id !== id);
  if (types.length === vocabulary.types.length) {
    return null;
  }
  return { ...vocabulary, types };
}

/**
 * How many source links across every timeline in one library reference type
 * `typeId`. Advisory only, for a delete confirmation: the count never blocks
 * or reverses a delete, and deleting a type never touches the documents that
 * reference it.
 *
 * Scoped to one library, unlike mindmap's countLinksUsingType, because the
 * vocabulary itself is per library rather than shared across every library
 * the way mindmap's Zotero.Prefs-backed one is.
 *
 * Reads every storage note directly rather than through listTimelines, which
 * skips a note it cannot parse - here that would report a corrupt timeline's
 * links as zero and let the type be deleted with no warning at all. Returns
 * null, not 0, when any document in the library will not parse.
 */
export async function countLinksUsingType(
  libraryID: number,
  typeId: string,
): Promise<number | null> {
  try {
    let count = 0;
    for (const note of await searchStorageNotes(libraryID)) {
      const { doc } = readDocumentFromNote(note);
      for (const event of doc.events) {
        count += event.sources.filter(
          (source) => source.typeId === typeId,
        ).length;
      }
    }
    return count;
  } catch {
    return null;
  }
}
