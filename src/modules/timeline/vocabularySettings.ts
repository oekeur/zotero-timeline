/**
 * The link-type vocabulary editor, in the plugin's preference pane: list the
 * selected library's types, add one, rename one, delete one.
 *
 * The container is rebuilt from scratch on every state change (library
 * switch, selection, add, edit, delete), so its text cannot go through
 * data-l10n-id: Zotero's preferences.js translates a plugin pane's static
 * fragment once, at load, and never revisits nodes inserted afterwards.
 * getString sidesteps that by reading the plugin's own Fluent bundle
 * directly. Only the pane's static heading in preferences.xhtml relies on
 * Fluent.
 *
 * Reads without creating: peekVocabulary, never readVocabulary. A library
 * with no vocabulary note shows the defaults, marked as not yet stored, so
 * opening the pane never scatters a container and a vocabulary note across
 * every group library the user belongs to.
 *
 * Every write is an async queued call to storage.ts's updateVocabulary that
 * can reject (the library is not writable, or the edit would leave the
 * vocabulary empty). The list on screen is never advanced until that promise
 * resolves, so there is nothing to revert on failure - the pane shows what
 * is actually stored throughout, and a rejection surfaces as a persistent
 * message rather than a list that quietly snaps back.
 */
import { getString } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import { StorageError, updateVocabulary } from "./storage";
import {
  addLinkType,
  countLinksUsingType,
  peekVocabulary,
  removeLinkType,
  renameLinkType,
  type VocabularyResult,
} from "./vocabulary";
import type { Vocabulary } from "./schema";

// Stable hooks a caller (or a test) can select on, since the DOM shape itself
// is not part of the contract.
export const LIBRARY_SELECT_CLASS = "zoterotimeline-vocab-library-select";
export const NOTE_CLASS = "zoterotimeline-vocab-note";
export const ERROR_CLASS = "zoterotimeline-vocab-error";
export const ROW_CLASS = "zoterotimeline-vocab-row";
export const ROW_LABEL_CLASS = "zoterotimeline-vocab-row-label";
export const ADD_BUTTON_CLASS = "zoterotimeline-vocab-add";
export const EDIT_BUTTON_CLASS = "zoterotimeline-vocab-edit";
export const DELETE_BUTTON_CLASS = "zoterotimeline-vocab-delete";
export const FIELD_INPUT_CLASS = "zoterotimeline-vocab-field-input";
export const SAVE_BUTTON_CLASS = "zoterotimeline-vocab-save";
export const CANCEL_BUTTON_CLASS = "zoterotimeline-vocab-cancel";

type Mode = { kind: "list" } | { kind: "add" } | { kind: "edit"; id: string };

let selectedLibraryID: number | null = null;
let mode: Mode = { kind: "list" };
let selectedTypeId: string | null = null;
let current: VocabularyResult | null = null;
let loading = false;
let saving = false;
let error: string | null = null;
// The add/edit form's typed label, kept in state rather than left to the
// input element: the container is rebuilt from scratch on every redraw
// (including the one a rejected write triggers), so anything the DOM alone
// held would be destroyed along with it. Reset whenever a form is freshly
// opened or the write it was for lands.
let draftLabel: string | null = null;

/**
 * Renders (mounts) the vocabulary editor into `container`, defaulting to My
 * Library. Resolves once the initial read has landed and the list is drawn,
 * which is what lets a spec await it instead of racing a fixed delay; the
 * pane's own onload handler calls this without awaiting it.
 */
export async function renderVocabularySettings(
  container: HTMLElement,
): Promise<void> {
  selectedLibraryID = Zotero.Libraries.userLibraryID;
  mode = { kind: "list" };
  selectedTypeId = null;
  draftLabel = null;
  error = null;
  current = null;
  await loadLibrary(container);
}

async function loadLibrary(container: HTMLElement): Promise<void> {
  const libraryID = selectedLibraryID!;
  loading = true;
  draw(container);
  const result = await peekVocabulary(libraryID);
  // The user may have switched libraries again while this was in flight.
  if (selectedLibraryID !== libraryID) {
    return;
  }
  current = result;
  loading = false;
  draw(container);
}

/**
 * Every library the vocabulary editor makes sense for. Feeds have no
 * editable content of their own and no vocabulary note belongs there.
 */
function editableLibraries(): ReturnType<typeof Zotero.Libraries.getAll> {
  return Zotero.Libraries.getAll().filter(
    (library) => library.libraryType !== "feed",
  );
}

function draw(container: HTMLElement): void {
  const doc = container.ownerDocument!;
  container.textContent = "";

  container.appendChild(buildLibraryRow(doc, container));

  if (loading || current === null) {
    const note = doc.createElement("p");
    note.classList.add(NOTE_CLASS);
    note.textContent = getString("vocabulary-loading");
    container.appendChild(note);
    return;
  }

  if (current.state === "absent") {
    appendNote(container, doc, getString("vocabulary-not-yet-stored"));
  } else if (current.state === "version-unsupported") {
    appendNote(container, doc, getString("vocabulary-version-unsupported"));
  } else if (current.state === "unreadable") {
    appendNote(
      container,
      doc,
      getString("vocabulary-unreadable", {
        args: { message: current.message ?? "" },
      }),
    );
  }

  if (error) {
    const errorNote = doc.createElement("p");
    errorNote.classList.add(ERROR_CLASS);
    errorNote.setAttribute("role", "alert");
    errorNote.textContent = error;
    container.appendChild(errorNote);
  }

  if (mode.kind !== "list") {
    drawForm(container, doc, mode.kind === "edit" ? mode.id : null);
    return;
  }

  drawList(container, doc);
}

function appendNote(container: HTMLElement, doc: Document, text: string): void {
  const note = doc.createElement("p");
  note.classList.add(NOTE_CLASS);
  note.textContent = text;
  container.appendChild(note);
}

function buildLibraryRow(doc: Document, container: HTMLElement): HTMLElement {
  const row = doc.createElement("div");
  row.classList.add("zoterotimeline-vocab-library-row");

  const label = doc.createElement("label");
  label.classList.add("zoterotimeline-vocab-library-label");
  label.textContent = getString("vocabulary-library-label");
  row.appendChild(label);

  const select = doc.createElement("select");
  select.classList.add(LIBRARY_SELECT_CLASS);
  for (const library of editableLibraries()) {
    const option = doc.createElement("option");
    option.value = String(library.libraryID);
    option.textContent = library.name;
    option.selected = library.libraryID === selectedLibraryID;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    selectedLibraryID = Number(select.value);
    mode = { kind: "list" };
    selectedTypeId = null;
    draftLabel = null;
    error = null;
    current = null;
    void loadLibrary(container);
  });
  row.appendChild(select);

  return row;
}

function drawList(container: HTMLElement, doc: Document): void {
  const types = current!.types;
  const hasSelection =
    selectedTypeId !== null && types.some((type) => type.id === selectedTypeId);

  const list = doc.createElement("div");
  list.classList.add("zoterotimeline-vocab-list");
  container.appendChild(list);

  for (const type of types) {
    const row = doc.createElement("div");
    row.classList.add(ROW_CLASS);
    row.tabIndex = 0;
    if (type.id === selectedTypeId) {
      row.classList.add("selected");
    }
    row.addEventListener("click", () => {
      selectedTypeId = type.id;
      draw(container);
    });

    const labelSpan = doc.createElement("span");
    labelSpan.classList.add(ROW_LABEL_CLASS);
    labelSpan.textContent = type.label;
    row.appendChild(labelSpan);

    list.appendChild(row);
  }

  const footer = doc.createElement("div");
  footer.classList.add("zoterotimeline-vocab-footer");
  container.appendChild(footer);

  const addButton = doc.createElement("button");
  addButton.type = "button";
  addButton.classList.add(ADD_BUTTON_CLASS);
  addButton.textContent = getString("vocabulary-add-button");
  addButton.disabled = saving;
  addButton.addEventListener("click", () => {
    mode = { kind: "add" };
    draftLabel = null;
    error = null;
    draw(container);
  });
  footer.appendChild(addButton);

  const editButton = doc.createElement("button");
  editButton.type = "button";
  editButton.classList.add(EDIT_BUTTON_CLASS);
  editButton.textContent = getString("vocabulary-edit-button");
  editButton.disabled = !hasSelection || saving;
  editButton.addEventListener("click", () => {
    if (!selectedTypeId) {
      return;
    }
    mode = { kind: "edit", id: selectedTypeId };
    draftLabel = null;
    error = null;
    draw(container);
  });
  footer.appendChild(editButton);

  const deleteButton = doc.createElement("button");
  deleteButton.type = "button";
  deleteButton.classList.add(DELETE_BUTTON_CLASS);
  deleteButton.textContent = getString("vocabulary-delete-button");
  deleteButton.disabled = !hasSelection || saving;
  deleteButton.addEventListener("click", () => {
    if (!selectedTypeId) {
      return;
    }
    void handleDelete(container, doc, selectedTypeId);
  });
  footer.appendChild(deleteButton);
}

function drawForm(
  container: HTMLElement,
  doc: Document,
  editId: string | null,
): void {
  const existing = editId
    ? current!.types.find((type) => type.id === editId)
    : undefined;

  const form = doc.createElement("div");
  form.classList.add("zoterotimeline-vocab-form");
  container.appendChild(form);

  const label = doc.createElement("label");
  label.textContent = getString("vocabulary-field-label");
  form.appendChild(label);

  const input = doc.createElement("input");
  input.type = "text";
  input.value = draftLabel ?? existing?.label ?? "";
  input.classList.add(FIELD_INPUT_CLASS);
  form.appendChild(input);

  const actions = doc.createElement("div");
  actions.classList.add("zoterotimeline-vocab-form-actions");
  form.appendChild(actions);

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.classList.add(SAVE_BUTTON_CLASS);
  saveButton.textContent = getString("vocabulary-save-button");
  saveButton.disabled = saving;
  saveButton.addEventListener("click", () => {
    draftLabel = input.value;
    const label = input.value.trim();
    if (!label) {
      return;
    }
    if (editId) {
      void performWrite(container, (vocabulary) =>
        renameLinkType(vocabulary, editId, label),
      );
    } else {
      void performWrite(container, (vocabulary) =>
        addLinkType(vocabulary, label),
      );
    }
  });
  actions.appendChild(saveButton);

  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.classList.add(CANCEL_BUTTON_CLASS);
  cancelButton.textContent = getString("vocabulary-cancel-button");
  cancelButton.disabled = saving;
  cancelButton.addEventListener("click", () => {
    mode = { kind: "list" };
    draftLabel = null;
    error = null;
    draw(container);
  });
  actions.appendChild(cancelButton);
}

/**
 * Runs one queued vocabulary write and redraws from its outcome.
 *
 * `mode` is only reset to "list" on success (inside the try block, after the
 * write resolves): a rejection jumps straight to the catch and leaves an
 * open add/edit form's typed input in place rather than discarding it. The
 * displayed list itself is never touched until `result` is in hand, so a
 * failure has nothing to revert - `current` still holds the last state that
 * was actually read from storage.
 */
async function performWrite(
  container: HTMLElement,
  mutate: (vocabulary: Vocabulary) => Vocabulary | null,
): Promise<void> {
  const libraryID = selectedLibraryID!;
  saving = true;
  error = null;
  draw(container);
  try {
    const result = await updateVocabulary(libraryID, mutate);
    if (result) {
      current = {
        types: result.types,
        state: "ok",
        duplicated: current?.duplicated ?? false,
      };
    }
    mode = { kind: "list" };
    draftLabel = null;
  } catch (err) {
    logFailure(
      `[zoteroTimeline] failed to update the vocabulary for library ${libraryID}: ${(err as Error).message}`,
      err,
    );
    error = writeErrorMessage(err);
  } finally {
    saving = false;
    draw(container);
  }
}

function writeErrorMessage(err: unknown): string {
  if (err instanceof StorageError && err.reason === "not-writable") {
    return getString("vocabulary-error-not-writable");
  }
  if (err instanceof StorageError && err.reason === "empty-vocabulary") {
    return getString("vocabulary-error-empty");
  }
  return getString("vocabulary-error-generic", {
    args: { message: (err as Error).message },
  });
}

type ConfirmDeleteFn = (
  win: mozIDOMWindowProxy,
  title: string,
  message: string,
) => boolean;

const defaultConfirmDelete: ConfirmDeleteFn = (win, title, message) =>
  Services.prompt.confirm(win, title, message);

let confirmDelete: ConfirmDeleteFn = defaultConfirmDelete;

/**
 * Overrides the delete confirmation dialog. Services.prompt is a native
 * XPCOM interface rather than a plain JS object the plugin owns, so a live
 * spec cannot safely monkey-patch it the way it could a class from
 * zotero-plugin-toolkit - the same reasoning readVocabulary's onRecovered
 * parameter documents for getString. Called with no argument, this restores
 * the real dialog. Exported through addon.api for the same reason
 * renderVocabularySettings is: a spec drives the plugin's own bundle, not
 * its own copy of this module.
 */
export function setConfirmDeleteForTests(fn?: ConfirmDeleteFn): void {
  confirmDelete = fn ?? defaultConfirmDelete;
}

async function handleDelete(
  container: HTMLElement,
  doc: Document,
  id: string,
): Promise<void> {
  const libraryID = selectedLibraryID!;
  const count = await countLinksUsingType(libraryID, id);
  const message =
    count === null
      ? getString("vocabulary-delete-confirm-unknown")
      : getString("vocabulary-delete-confirm-used", { args: { count } });

  const win = doc.defaultView as unknown as mozIDOMWindowProxy | null;
  const confirmed = win
    ? confirmDelete(win, getString("vocabulary-delete-confirm-title"), message)
    : false;
  if (!confirmed) {
    return;
  }

  selectedTypeId = null;
  await performWrite(container, (vocabulary) => removeLinkType(vocabulary, id));
}
