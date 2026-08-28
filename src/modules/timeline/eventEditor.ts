/**
 * The event editor: title, description and tags for one event, with Save and
 * Delete. One render function that draws into any container, so the same
 * function that mounts beside the timeline canvas today can mount in m-6's
 * item pane later without a rewrite - it never looks a tab or a window up by
 * id, and reaches storage only through the documentId/libraryID it is handed.
 *
 * Not a ztoolkit.Dialog. timelineTab.ts records why: a Dialog opens
 * about:blank, which carries no Fluent strings so every label renders empty,
 * sizes itself on a timer an async render outlasts, and will not open an HTML
 * select's dropdown at all. Every label and button here carries
 * data-l10n-id rather than a value from getString(), which throws or returns
 * the raw key while rendering outside a Fluent-wired document.
 *
 * date and endDate are free-text EDTF (ISO 8601-2), never validated or
 * rewritten on save: a string this plugin's pinned edtf rejects may still be
 * valid EDTF from a level it doesn't implement, so refusing the save would
 * block a correct date the plugin merely can't read. The only feedback is a
 * live parse readout naming which of EDTF's forms the string parsed as
 * (plain/uncertain/approximate/interval/one-of/season/list) and the range it
 * resolves to, or edtf's own thrown message verbatim on a parse failure - the
 * one place a "1580..1590" typo for "1580/1590" (a set of two candidate
 * dates, not a continuous span) is still tellable apart from what was meant.
 *
 * The empty-state prompt (no selection) also carries a create form - title,
 * date, and a document picker when more than one timeline is loaded - the
 * typed equivalent of clicking empty canvas. See canvas.ts's own top-of-file
 * comment for the full gesture-parity audit this belongs to.
 *
 * Sources: what the event cites, added through sourcePicker's native dialog,
 * typed against the library's vocabulary and named through sourceLabels.ts -
 * the one place a source is named everywhere one is shown. Kept as a local
 * array and only turned into a write on Save, exactly like the tag list:
 * two write models on one panel would let a user lose one edit silently with
 * nothing on the surface saying which. A typeId that resolves to no type in
 * the vocabulary is valid data, not corruption, and is never rewritten just
 * for resolving to nothing.
 *
 * Each row's own button, never a click on the row, selects the source's item
 * in the library pane - a read, so it bypasses the sources array entirely
 * rather than going through Save. A ref that resolves to nothing renders no
 * such button.
 *
 * `libraryEditable`, computed once when the tab opens and threaded down from
 * timelineTab.ts, disables every control here that writes: Save, Delete, Add
 * source, each source row's own type-select/name-input/Remove button, and
 * the empty-state create form's inputs and its own Create button - disabled,
 * never removed, so the panel's shape stays the same in every library. It is
 * the same boolean canvas.ts uses to withhold every item's drag handle and
 * refuse click-to-create, read once rather than recomputed here. Everything
 * else stays live: title, date, endDate, description, tags and the
 * source-show button are either a read (see above) or an in-memory edit that
 * only becomes a write on Save, and reading an event's fields while
 * comparing two chronologies is the point of this panel.
 */
import { getLocaleID, getString } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import {
  toTimelineRange,
  type EdtfForm,
  type TimelineRange,
} from "../../utils/edtfRange";
import {
  addEvent,
  addSource,
  copyEventInto,
  removeEvent,
  removeSource,
  updateEvent,
  updateSource,
  type SourceEdits,
} from "./mutations";
import { pickSource } from "./sourcePicker";
import {
  labelForItem,
  labelForSource,
  resolveSourceItem,
} from "./sourceLabels";
import { peekVocabulary, UNKNOWN_TYPE_LABEL } from "./vocabulary";
import { updateTimelineDocument } from "./storage";
import { announce, warn } from "./containerGuard";
import { listTimelinesEverywhereCached } from "./documentCache";
import type { Event as TimelineEvent, LinkType, SourceRef } from "./schema";
import type { FluentMessageId } from "../../../typings/i10n";

export interface EventEditorSelection {
  documentId: string;
  libraryID: number;
  event: TimelineEvent;
}

export type EventEditorChange =
  | { kind: "saved"; documentId: string; event: TimelineEvent }
  | { kind: "deleted"; documentId: string; eventId: string }
  | { kind: "created"; documentId: string; event: TimelineEvent };

/** One row the empty-state create form can target. */
export interface CreatableDocument {
  id: string;
  name: string;
}

// Stable hooks a caller (or a test) can select on, since the DOM shape itself
// is not part of the contract.
export const TITLE_INPUT_CLASS = "zoterotimeline-event-title";
export const DATE_INPUT_CLASS = "zoterotimeline-event-date";
export const DATE_FEEDBACK_CLASS = "zoterotimeline-event-date-feedback";
export const END_DATE_INPUT_CLASS = "zoterotimeline-event-end-date";
export const END_DATE_FEEDBACK_CLASS = "zoterotimeline-event-end-date-feedback";
// Shared by both feedback readouts - which field it's naming comes from which
// DATE_FEEDBACK_CLASS/END_DATE_FEEDBACK_CLASS container it's nested under.
export const DATE_FEEDBACK_FORM_CLASS = "zoterotimeline-event-date-form";
export const DATE_FEEDBACK_RANGE_CLASS = "zoterotimeline-event-date-range";
export const DESCRIPTION_INPUT_CLASS = "zoterotimeline-event-description";
export const TAG_CLASS = "zoterotimeline-event-tag";
export const TAG_TEXT_CLASS = "zoterotimeline-event-tag-text";
export const TAG_REMOVE_BUTTON_CLASS = "zoterotimeline-event-tag-remove";
export const TAG_INPUT_CLASS = "zoterotimeline-event-tag-input";
export const TAG_LIST_CLASS = "zoterotimeline-event-tags";
export const SOURCE_LIST_CLASS = "zoterotimeline-event-sources";
export const SOURCE_CLASS = "zoterotimeline-event-source";
export const SOURCE_LABEL_TEXT_CLASS = "zoterotimeline-event-source-label";
export const SOURCE_SHOW_BUTTON_CLASS = "zoterotimeline-event-source-show";
export const SOURCE_TYPE_SELECT_CLASS = "zoterotimeline-event-source-type";
export const SOURCE_NAME_INPUT_CLASS = "zoterotimeline-event-source-name";
export const SOURCE_REMOVE_BUTTON_CLASS = "zoterotimeline-event-source-remove";
export const SOURCE_ADD_BUTTON_CLASS = "zoterotimeline-event-source-add";
export const SOURCE_FEEDBACK_CLASS = "zoterotimeline-event-source-feedback";
export const ACTIONS_CLASS = "zoterotimeline-event-actions";
export const SAVE_BUTTON_CLASS = "zoterotimeline-event-save";
export const DELETE_BUTTON_CLASS = "zoterotimeline-event-delete";
export const DUPLICATE_BUTTON_CLASS = "zoterotimeline-event-duplicate";
export const DUPLICATE_FORM_CLASS = "zoterotimeline-event-duplicate-form";
export const DUPLICATE_TARGET_CLASS = "zoterotimeline-event-duplicate-target";
export const DUPLICATE_CONFIRM_CLASS = "zoterotimeline-event-duplicate-confirm";
export const DUPLICATE_CANCEL_CLASS = "zoterotimeline-event-duplicate-cancel";
export const EMPTY_PROMPT_CLASS = "zoterotimeline-event-empty";
// The typed equivalent of clicking empty canvas (TASK-25) - see the parity
// audit atop canvas.ts. Rendered inside the empty-state prompt above, never
// its own dialog, for the same reason nothing else here is one.
export const CREATE_DOCUMENT_SELECT_CLASS =
  "zoterotimeline-event-create-document";
export const CREATE_TITLE_INPUT_CLASS = "zoterotimeline-event-create-title";
export const CREATE_DATE_INPUT_CLASS = "zoterotimeline-event-create-date";
export const CREATE_DATE_FEEDBACK_CLASS =
  "zoterotimeline-event-create-date-feedback";
export const CREATE_BUTTON_CLASS = "zoterotimeline-event-create";

// One Fluent id per EDTF form edtfRange.ts's formOf can report.
const DATE_FORM_LOCALE_IDS: Record<EdtfForm, FluentMessageId> = {
  plain: "event-editor-date-form-plain",
  uncertain: "event-editor-date-form-uncertain",
  approximate: "event-editor-date-form-approximate",
  interval: "event-editor-date-form-interval",
  "one-of": "event-editor-date-form-one-of",
  season: "event-editor-date-form-season",
  list: "event-editor-date-form-list",
};

function formatDateRange(range: TimelineRange): string {
  const start = range.start.toLocaleDateString();
  return range.end ? `${start} – ${range.end.toLocaleDateString()}` : start;
}

/**
 * Parses `input` and (re)renders the live readout naming the EDTF form it
 * parsed as and the range it resolves to, or edtf's own thrown message
 * verbatim on a parse failure. Never rewrites `input`. Blank input (an
 * optional endDate left empty, or a date field mid-edit) shows no feedback at
 * all rather than an error, since it isn't a parse failure yet.
 */
function updateDateFeedback(
  doc: Document,
  feedback: HTMLElement,
  input: string,
): void {
  feedback.textContent = "";
  if (!input.trim()) {
    return;
  }

  let range: TimelineRange;
  try {
    range = toTimelineRange(input);
  } catch (err) {
    feedback.textContent = (err as Error).message;
    return;
  }

  const formSpan = doc.createElement("span");
  formSpan.classList.add(DATE_FEEDBACK_FORM_CLASS);
  formSpan.setAttribute(
    "data-l10n-id",
    getLocaleID(DATE_FORM_LOCALE_IDS[range.form]),
  );
  feedback.appendChild(formSpan);

  const rangeSpan = doc.createElement("span");
  rangeSpan.classList.add(DATE_FEEDBACK_RANGE_CLASS);
  rangeSpan.textContent = formatDateRange(range);
  feedback.appendChild(rangeSpan);
}

/**
 * The create form shown alongside the empty-state prompt: title, a free-text
 * EDTF date with the same live feedback the edit form's date field has, and a
 * document picker only when more than one timeline is loaded (a single
 * loaded document needs no picker to be unambiguous). No canvas position
 * exists here to derive a date from the way TASK-25's click gesture does, so
 * unlike that gesture this one asks for the date directly rather than
 * inventing a default - a blank date field does nothing on Create, since
 * Event.date is required and a placeholder value would break the canvas the
 * next time it re-renders (buildTimelineItem parses `date` unconditionally).
 * A blank title falls back to the same "Untitled event" string the click
 * gesture uses, so the two routes produce the same stored title when neither
 * types one.
 *
 * Every control here is disabled when the library cannot be written, unlike
 * the edit form's fields: this form has no existing event to display, so
 * there is nothing to read once the one thing it is for - producing a write
 * - is refused, the same reasoning that leaves the sidebar's own create form
 * unreachable behind a disabled control.
 */
function renderCreateForm(
  doc: Document,
  container: HTMLElement,
  creatable: { libraryID: number; documents: CreatableDocument[] },
  onChange: ((change: EventEditorChange) => void) | undefined,
  libraryEditable: boolean,
): void {
  const { libraryID, documents } = creatable;

  let documentSelect: HTMLSelectElement | undefined;
  if (documents.length > 1) {
    const selectLabel = doc.createElement("label");
    selectLabel.setAttribute(
      "data-l10n-id",
      getLocaleID("event-editor-create-document-label"),
    );
    container.appendChild(selectLabel);

    documentSelect = doc.createElement("select");
    documentSelect.classList.add(CREATE_DOCUMENT_SELECT_CLASS);
    documentSelect.disabled = !libraryEditable;
    for (const candidate of documents) {
      const option = doc.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.name;
      documentSelect.appendChild(option);
    }
    container.appendChild(documentSelect);
  }

  const titleLabel = doc.createElement("label");
  titleLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-title-label"),
  );
  container.appendChild(titleLabel);

  const titleInput = doc.createElement("input");
  titleInput.type = "text";
  titleInput.classList.add(CREATE_TITLE_INPUT_CLASS);
  titleInput.disabled = !libraryEditable;
  container.appendChild(titleInput);

  const dateLabel = doc.createElement("label");
  dateLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-date-label"),
  );
  container.appendChild(dateLabel);

  const dateInput = doc.createElement("input");
  dateInput.type = "text";
  dateInput.classList.add(CREATE_DATE_INPUT_CLASS);
  dateInput.disabled = !libraryEditable;
  container.appendChild(dateInput);

  const dateFeedback = doc.createElement("p");
  dateFeedback.classList.add(CREATE_DATE_FEEDBACK_CLASS);
  container.appendChild(dateFeedback);
  dateInput.addEventListener("input", () => {
    updateDateFeedback(doc, dateFeedback, dateInput.value);
  });

  const createButton = doc.createElement("button");
  createButton.type = "button";
  createButton.classList.add(CREATE_BUTTON_CLASS);
  createButton.disabled = !libraryEditable;
  createButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-create-button"),
  );
  container.appendChild(createButton);

  createButton.addEventListener("click", () => {
    const date = dateInput.value;
    if (!date.trim()) {
      return;
    }
    const documentId = documentSelect ? documentSelect.value : documents[0].id;
    const title =
      titleInput.value.trim() || getString("event-editor-untitled-title");
    void (async () => {
      try {
        let newEventId: string | undefined;
        const result = await updateTimelineDocument(
          (current) => {
            const next = addEvent(current, { title, date });
            newEventId = next.events[next.events.length - 1].id;
            return next;
          },
          documentId,
          libraryID,
        );
        const created = result?.events.find((e) => e.id === newEventId);
        if (result && created) {
          onChange?.({ kind: "created", documentId, event: created });
        }
      } catch (err) {
        logFailure(
          `[zoteroTimeline] failed to create an event in document ${documentId}: ${(err as Error).message}`,
          err,
        );
      }
    })();
  });
}

/**
 * Selects a source's item in the library pane, which switches Zotero away
 * from the timeline tab. Only ever reached from a row's own button, never
 * from clicking the row: losing the canvas has to be something the user
 * asked for rather than a side effect of inspecting a source.
 *
 * ZoteroPane.selectItem is async in Zotero's own source (chrome/content/
 * zotero/zoteroPane.js) despite the vendored zotero-types typing it as
 * synchronous - awaited here to match the real behavior.
 */
async function showSourceItemInLibrary(item: Zotero.Item): Promise<void> {
  await Zotero.getActiveZoteroPane().selectItem(item.id);
}

/**
 * Whether two source refs make the same claim. Mirrors mutations.ts's own
 * isSameClaim, which addSource uses at write time but does not export - a
 * SourceRef has no id to key a shared helper on, and this lets a duplicate
 * the picker just produced be refused with a message before the row exists,
 * rather than silently dropped at Save.
 */
function isSameSourceClaim(
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
 * `selection` null renders a prompt naming both ways to get an event into the
 * editor, rather than blanking - the panel stays in place across a selection
 * change so the canvas next to it never has to reflow. `creatable`, when
 * given, adds the typed equivalent of clicking empty canvas below the prompt.
 *
 * `onChange` runs once a save, delete or create actually wrote a note, so the
 * caller can refresh the canvas item and, for a delete, clear the selection.
 * A no-op save (nothing actually changed) writes nothing and calls nothing.
 *
 * `libraryEditable` defaults to true so every existing caller (including the
 * whole test suite) keeps behaving as it did before this parameter existed;
 * timelineTab.ts is the one caller that ever passes false.
 */
export function renderEventEditor(
  container: HTMLElement,
  selection: EventEditorSelection | null,
  onChange?: (change: EventEditorChange) => void,
  creatable?: { libraryID: number; documents: CreatableDocument[] },
  libraryEditable = true,
): void {
  const doc = container.ownerDocument!;
  container.textContent = "";

  if (!selection) {
    const prompt = doc.createElement("p");
    prompt.classList.add(EMPTY_PROMPT_CLASS);
    // Both halves of the writable prompt are impossible in a library that
    // cannot be written: editing is refused and a click on empty canvas
    // creates nothing. Left unswitched it sat one line under the read-only
    // banner telling the user to do exactly what the banner had just said
    // could not happen.
    prompt.setAttribute(
      "data-l10n-id",
      getLocaleID(
        libraryEditable ? "event-editor-empty" : "event-editor-empty-read-only",
      ),
    );
    container.appendChild(prompt);
    if (creatable && creatable.documents.length > 0) {
      renderCreateForm(doc, container, creatable, onChange, libraryEditable);
    }
    return;
  }

  const { documentId, libraryID, event } = selection;

  const titleLabel = doc.createElement("label");
  titleLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-title-label"),
  );
  container.appendChild(titleLabel);

  const titleInput = doc.createElement("input");
  titleInput.type = "text";
  titleInput.value = event.title;
  titleInput.classList.add(TITLE_INPUT_CLASS);
  container.appendChild(titleInput);

  const dateLabel = doc.createElement("label");
  dateLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-date-label"),
  );
  container.appendChild(dateLabel);

  const dateInput = doc.createElement("input");
  dateInput.type = "text";
  dateInput.value = event.date;
  dateInput.classList.add(DATE_INPUT_CLASS);
  container.appendChild(dateInput);

  const dateFeedback = doc.createElement("p");
  dateFeedback.classList.add(DATE_FEEDBACK_CLASS);
  container.appendChild(dateFeedback);

  dateInput.addEventListener("input", () => {
    updateDateFeedback(doc, dateFeedback, dateInput.value);
  });
  updateDateFeedback(doc, dateFeedback, dateInput.value);

  const endDateLabel = doc.createElement("label");
  endDateLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-end-date-label"),
  );
  container.appendChild(endDateLabel);

  const endDateInput = doc.createElement("input");
  endDateInput.type = "text";
  endDateInput.value = event.endDate ?? "";
  endDateInput.classList.add(END_DATE_INPUT_CLASS);
  container.appendChild(endDateInput);

  const endDateFeedback = doc.createElement("p");
  endDateFeedback.classList.add(END_DATE_FEEDBACK_CLASS);
  container.appendChild(endDateFeedback);

  endDateInput.addEventListener("input", () => {
    updateDateFeedback(doc, endDateFeedback, endDateInput.value);
  });
  updateDateFeedback(doc, endDateFeedback, endDateInput.value);

  const descriptionLabel = doc.createElement("label");
  descriptionLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-description-label"),
  );
  container.appendChild(descriptionLabel);

  const descriptionInput = doc.createElement("textarea");
  descriptionInput.value = event.description ?? "";
  descriptionInput.classList.add(DESCRIPTION_INPUT_CLASS);
  container.appendChild(descriptionInput);

  const tagsLabel = doc.createElement("label");
  tagsLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-tags-label"),
  );
  container.appendChild(tagsLabel);

  // A token field, not a comma-separated one: no character is reserved, so a
  // tag containing a comma round-trips through the document unchanged. Kept
  // as a local array and only turned into a write on Save.
  const tags = event.tags.slice();
  const tagList = doc.createElement("div");
  tagList.classList.add(TAG_LIST_CLASS);
  container.appendChild(tagList);

  function renderTags(): void {
    tagList.textContent = "";
    tags.forEach((tag, index) => {
      const chip = doc.createElement("span");
      chip.classList.add(TAG_CLASS);
      const tagText = doc.createElement("span");
      tagText.classList.add(TAG_TEXT_CLASS);
      tagText.textContent = tag;
      chip.appendChild(tagText);

      const removeButton = doc.createElement("button");
      removeButton.type = "button";
      removeButton.classList.add(TAG_REMOVE_BUTTON_CLASS);
      removeButton.setAttribute(
        "data-l10n-id",
        getLocaleID("event-editor-tag-remove-button"),
      );
      removeButton.addEventListener("click", () => {
        tags.splice(index, 1);
        renderTags();
      });
      chip.appendChild(removeButton);

      tagList.appendChild(chip);
    });
  }
  renderTags();

  const tagInputLabel = doc.createElement("label");
  tagInputLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-tag-input-label"),
  );
  container.appendChild(tagInputLabel);

  const tagInput = doc.createElement("input");
  tagInput.type = "text";
  tagInput.classList.add(TAG_INPUT_CLASS);
  container.appendChild(tagInput);
  tagInput.addEventListener("keydown", (ev) => {
    // The sandbox's generated event map types every "keydown" listener's
    // event as the bare Event interface rather than KeyboardEvent, which is
    // an imprecision in that generated map rather than anything true at
    // runtime - a real keydown is always a KeyboardEvent.
    if ((ev as KeyboardEvent).key !== "Enter") {
      return;
    }
    ev.preventDefault();
    const value = tagInput.value.trim();
    if (!value) {
      return;
    }
    tags.push(value);
    tagInput.value = "";
    renderTags();
  });

  const sourcesLabel = doc.createElement("label");
  sourcesLabel.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-sources-label"),
  );
  container.appendChild(sourcesLabel);

  // Kept as a local array and only turned into a write on Save, the same
  // rule the tag list above follows. originalIndex addresses the source's
  // position in event.sources at the moment the panel opened - a SourceRef
  // has no id, so Save diffs against that index rather than the row's
  // current position, which shifts as rows are added and removed.
  const sources: Array<{ ref: SourceRef; originalIndex: number | null }> =
    event.sources.map((ref, originalIndex) => ({
      ref: { ...ref },
      originalIndex,
    }));

  const sourceList = doc.createElement("div");
  sourceList.classList.add(SOURCE_LIST_CLASS);
  container.appendChild(sourceList);

  const sourceFeedback = doc.createElement("p");
  sourceFeedback.classList.add(SOURCE_FEEDBACK_CLASS);
  container.appendChild(sourceFeedback);

  // Empty until the library's vocabulary resolves, so a row renders with
  // just its own typeId (as the unknown-type option) rather than blocking
  // the rest of the panel on an async read.
  let vocabularyTypes: LinkType[] = [];

  function renderSources(): void {
    sourceList.textContent = "";
    sources.forEach((row, index) => {
      const rowEl = doc.createElement("div");
      rowEl.classList.add(SOURCE_CLASS);
      sourceList.appendChild(rowEl);

      const labelSpan = doc.createElement("span");
      labelSpan.classList.add(SOURCE_LABEL_TEXT_CLASS);
      labelSpan.textContent = labelForSource(row.ref);
      rowEl.appendChild(labelSpan);

      // No button at all when the ref resolves to nothing: the label already
      // reads "(missing item)", so a disabled button here would explain
      // nothing a hidden one doesn't already cover, and there is nothing to
      // jump to.
      const resolvedItem = resolveSourceItem(row.ref);
      if (resolvedItem) {
        const showButton = doc.createElement("button");
        showButton.type = "button";
        showButton.classList.add(SOURCE_SHOW_BUTTON_CLASS);
        showButton.setAttribute(
          "data-l10n-id",
          getLocaleID("event-editor-source-show-button"),
        );
        showButton.addEventListener("click", () => {
          void showSourceItemInLibrary(resolvedItem);
        });
        rowEl.appendChild(showButton);
      }

      const typeSelect = doc.createElement("select");
      typeSelect.classList.add(SOURCE_TYPE_SELECT_CLASS);
      typeSelect.disabled = !libraryEditable;
      typeSelect.setAttribute(
        "data-l10n-id",
        getLocaleID("event-editor-source-type-select"),
      );
      for (const type of vocabularyTypes) {
        const option = doc.createElement("option");
        option.value = type.id;
        option.textContent = type.label;
        typeSelect.appendChild(option);
      }
      // A typeId a deleted link type left behind is valid data, not
      // corruption (vocabulary.ts), and keeps its id across a save unless
      // the user picks a different one - so the select needs an option for
      // it even though the vocabulary itself no longer offers one.
      if (!vocabularyTypes.some((type) => type.id === row.ref.typeId)) {
        const unknownOption = doc.createElement("option");
        unknownOption.value = row.ref.typeId;
        unknownOption.textContent = UNKNOWN_TYPE_LABEL;
        typeSelect.appendChild(unknownOption);
      }
      typeSelect.value = row.ref.typeId;
      typeSelect.addEventListener("change", () => {
        row.ref = { ...row.ref, typeId: typeSelect.value };
      });
      rowEl.appendChild(typeSelect);

      // Always rendered, blank when unset, rather than a reveal/collapse
      // toggle: the field exists for a distinction that applies to one pair
      // and is low-stakes enough that a persistent empty slot is simpler
      // than an extra control, and it keeps every row's shape identical
      // whether or not the field is populated.
      const nameInput = doc.createElement("input");
      nameInput.type = "text";
      nameInput.classList.add(SOURCE_NAME_INPUT_CLASS);
      nameInput.disabled = !libraryEditable;
      nameInput.setAttribute(
        "data-l10n-id",
        getLocaleID("event-editor-source-name-input"),
      );
      nameInput.value = row.ref.name ?? "";
      nameInput.addEventListener("input", () => {
        const name = nameInput.value.trim() || undefined;
        row.ref = { ...row.ref, name };
      });
      rowEl.appendChild(nameInput);

      const removeButton = doc.createElement("button");
      removeButton.type = "button";
      removeButton.classList.add(SOURCE_REMOVE_BUTTON_CLASS);
      removeButton.disabled = !libraryEditable;
      removeButton.setAttribute(
        "data-l10n-id",
        getLocaleID("event-editor-source-remove-button"),
      );
      removeButton.addEventListener("click", () => {
        sources.splice(index, 1);
        renderSources();
      });
      rowEl.appendChild(removeButton);
    });
  }
  renderSources();

  // Non-creating: opening the editor on an event that cites nothing yet
  // must not scatter a vocabulary note into a library that never had one,
  // the same restraint TASK-34's preference pane takes and for the same
  // reason (see vocabulary.ts's peekVocabulary docblock).
  const vocabularyReady = peekVocabulary(libraryID).then((result) => {
    vocabularyTypes = result.types;
    renderSources();
  });

  const addSourceButton = doc.createElement("button");
  addSourceButton.type = "button";
  addSourceButton.classList.add(SOURCE_ADD_BUTTON_CLASS);
  addSourceButton.disabled = !libraryEditable;
  addSourceButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-source-add-button"),
  );
  container.appendChild(addSourceButton);
  addSourceButton.addEventListener("click", () => {
    void (async () => {
      sourceFeedback.textContent = "";
      let item: Zotero.Item | null;
      try {
        item = await pickSource(libraryID);
      } catch (err) {
        sourceFeedback.textContent = (err as Error).message;
        return;
      }
      if (!item) {
        return;
      }
      await vocabularyReady;
      const ref: SourceRef = {
        kind: item.isNote() ? "note" : "item",
        libraryID: item.libraryID,
        key: item.key,
        typeId: vocabularyTypes[0]?.id ?? "",
      };
      if (sources.some((row) => isSameSourceClaim(row.ref, ref))) {
        sourceFeedback.textContent = `"${labelForItem(item)}" is already a source on this event with the same type and no name.`;
        return;
      }
      sources.push({ ref, originalIndex: null });
      renderSources();
    })();
  });

  const actions = doc.createElement("div");
  actions.classList.add(ACTIONS_CLASS);
  container.appendChild(actions);

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.classList.add(SAVE_BUTTON_CLASS);
  saveButton.disabled = !libraryEditable;
  saveButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-save-button"),
  );
  actions.appendChild(saveButton);
  saveButton.addEventListener("click", () => {
    void (async () => {
      try {
        const result = await updateTimelineDocument(
          (current) => {
            let next =
              updateEvent(current, event.id, {
                title: titleInput.value,
                description: descriptionInput.value.trim()
                  ? descriptionInput.value
                  : undefined,
                date: dateInput.value,
                endDate: endDateInput.value.trim()
                  ? endDateInput.value
                  : undefined,
                tags: tags.slice(),
              }) ?? current;

            // Updates first, while every original index is still valid since
            // the array's length hasn't changed yet; removals next, highest
            // index first, so removing one never shifts an index still to be
            // processed; additions last, since they only ever append. This
            // keeps every untouched source in place and reaches each of
            // TASK-30's mutations at most once per row, all inside the one
            // mutate call updateTimelineDocument turns into one note write.
            for (const row of sources) {
              if (row.originalIndex === null) {
                continue;
              }
              const original = event.sources[row.originalIndex];
              const changes: SourceEdits = {};
              if (row.ref.typeId !== original.typeId) {
                changes.typeId = row.ref.typeId;
              }
              if (row.ref.name !== original.name) {
                changes.name = row.ref.name;
              }
              if (Object.keys(changes).length === 0) {
                continue;
              }
              const updated = updateSource(
                next,
                event.id,
                row.originalIndex,
                changes,
              );
              if (updated) {
                next = updated;
              }
            }

            const keptIndices = new Set(
              sources
                .map((row) => row.originalIndex)
                .filter((index): index is number => index !== null),
            );
            const removedIndices = event.sources
              .map((_, index) => index)
              .filter((index) => !keptIndices.has(index))
              .sort((a, b) => b - a);
            for (const index of removedIndices) {
              const removed = removeSource(next, event.id, index);
              if (removed) {
                next = removed;
              }
            }

            for (const row of sources) {
              if (row.originalIndex !== null) {
                continue;
              }
              const added = addSource(next, event.id, {
                kind: row.ref.kind,
                libraryID: row.ref.libraryID,
                key: row.ref.key,
                typeId: row.ref.typeId,
                name: row.ref.name,
              });
              if (added) {
                next = added;
              }
            }

            return next === current ? null : next;
          },
          documentId,
          libraryID,
        );
        const updated = result?.events.find((e) => e.id === event.id);
        if (updated) {
          onChange?.({ kind: "saved", documentId, event: updated });
        }
      } catch (err) {
        logFailure(
          `[zoteroTimeline] failed to save event ${event.id}: ${(err as Error).message}`,
          err,
        );
      }
    })();
  });

  const deleteButton = doc.createElement("button");
  deleteButton.type = "button";
  deleteButton.classList.add(DELETE_BUTTON_CLASS);
  deleteButton.disabled = !libraryEditable;
  deleteButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-delete-button"),
  );
  actions.appendChild(deleteButton);
  deleteButton.addEventListener("click", () => {
    void (async () => {
      try {
        const result = await updateTimelineDocument(
          (current) => removeEvent(current, event.id),
          documentId,
          libraryID,
        );
        if (result) {
          onChange?.({ kind: "deleted", documentId, eventId: event.id });
        }
      } catch (err) {
        logFailure(
          `[zoteroTimeline] failed to delete event ${event.id}: ${(err as Error).message}`,
          err,
        );
      }
    })();
  });

  /*
   * Duplicate, beside Delete because that is where the user already is when
   * they decide to copy, and because it adds no canvas gesture for TASK-27's
   * parity audit to match.
   *
   * An inline form rather than a further window, so the control carries no
   * ellipsis (project/ui-design.md section 4, rule 1). The target is a plain
   * <select> with one <optgroup> per library, which gives the grouping and the
   * per-library labelling the task asks for natively, and reads at the
   * editor's width without a second column.
   */
  const duplicateButton = doc.createElement("button");
  duplicateButton.type = "button";
  duplicateButton.classList.add(DUPLICATE_BUTTON_CLASS);
  duplicateButton.disabled = !libraryEditable;
  duplicateButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-duplicate-button"),
  );
  actions.appendChild(duplicateButton);

  const duplicateForm = doc.createElement("div");
  duplicateForm.classList.add(DUPLICATE_FORM_CLASS);
  duplicateForm.hidden = true;
  container.appendChild(duplicateForm);

  const targetSelect = doc.createElement("select");
  targetSelect.classList.add(DUPLICATE_TARGET_CLASS);
  targetSelect.disabled = !libraryEditable;
  targetSelect.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-duplicate-target"),
  );
  duplicateForm.appendChild(targetSelect);

  const confirmButton = doc.createElement("button");
  confirmButton.type = "button";
  confirmButton.classList.add(DUPLICATE_CONFIRM_CLASS);
  confirmButton.disabled = !libraryEditable;
  confirmButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-duplicate-confirm"),
  );
  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.classList.add(DUPLICATE_CANCEL_CLASS);
  cancelButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-duplicate-cancel"),
  );
  duplicateForm.appendChild(confirmButton);
  duplicateForm.appendChild(cancelButton);

  // Keyed by option value so the write knows which library it is writing to
  // without re-reading anything.
  const targets = new Map<string, { libraryID: number; name: string }>();

  async function fillTargets(): Promise<void> {
    targetSelect.textContent = "";
    targets.clear();
    const grouped = await listTimelinesEverywhereCached();
    for (const group of grouped) {
      const optgroup = doc.createElement("optgroup");
      // Named on the group, because two libraries may hold timelines with the
      // same name and the option alone would not say which was which.
      optgroup.label = group.libraryName;
      for (const timeline of group.timelines) {
        const option = doc.createElement("option");
        const value = `${group.libraryID}:${timeline.doc.id}`;
        option.value = value;
        option.textContent = timeline.doc.name;
        // The event's own timeline is a legal target and stays listed, but it
        // is never what the control is already pointing at: a copy onto the
        // timeline you are already on is the least likely thing meant, and
        // preselecting it would make a stray confirm do it.
        option.selected = false;
        targets.set(value, {
          libraryID: group.libraryID,
          name: timeline.doc.name,
        });
        optgroup.appendChild(option);
      }
      targetSelect.appendChild(optgroup);
    }
    const first = [...targets.keys()].find(
      (key) => key !== `${libraryID}:${documentId}`,
    );
    targetSelect.value = first ?? "";
  }

  duplicateButton.addEventListener("click", () => {
    if (!duplicateForm.hidden) {
      duplicateForm.hidden = true;
      return;
    }
    duplicateForm.hidden = false;
    void fillTargets().catch((err) => {
      logFailure(
        `[zoteroTimeline] failed to list duplicate targets: ${(err as Error).message}`,
        err,
      );
    });
  });

  cancelButton.addEventListener("click", () => {
    duplicateForm.hidden = true;
  });

  confirmButton.addEventListener("click", () => {
    void (async () => {
      const target = targets.get(targetSelect.value);
      if (!target) {
        return;
      }
      const targetDocumentId = targetSelect.value.slice(
        String(target.libraryID).length + 1,
      );
      // Sources cross library boundaries only by being dropped. A document
      // never holds a SourceRef naming another library, and that invariant is
      // what makes a stray foreign libraryID diagnosable rather than normal.
      const keepSources = target.libraryID === libraryID;
      const leftBehind = keepSources ? 0 : event.sources.length;
      try {
        // One write, against the target alone. The source document is never
        // opened for writing, which is what makes "the original is untouched"
        // and "a failed write changes nothing anywhere" both true without an
        // ordering argument.
        const result = await updateTimelineDocument(
          (current) => copyEventInto(current, event, keepSources).doc,
          targetDocumentId,
          target.libraryID,
        );
        if (!result) {
          return;
        }
        // Reported through a ProgressWindow, not into this panel. The write
        // fires the canvas rebuild (TASK-43), which restores the selection and
        // re-renders the editor, so a message drawn here is destroyed before
        // anyone reads it - measured, after doing exactly that.
        //
        // A cross-library copy uses warn(), which has no close timer and must
        // be clicked away: sources being left behind is a real loss and the
        // one thing about this action a user most needs to notice.
        if (leftBehind > 0) {
          warn(
            getString("event-editor-duplicate-done-without-sources", {
              args: { timeline: target.name, count: leftBehind },
            }),
          );
        } else {
          announce(
            getString("event-editor-duplicate-done", {
              args: { timeline: target.name },
            }),
          );
        }
        duplicateForm.hidden = true;
      } catch (err) {
        logFailure(
          `[zoteroTimeline] failed to duplicate event ${event.id}: ${(err as Error).message}`,
          err,
        );
      }
    })();
  });
}
