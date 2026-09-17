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
 * block a correct date the plugin merely can't read. The live feedback names
 * which of EDTF's forms the string parsed as
 * (plain/uncertain/approximate/interval/one-of/season/list) and the range it
 * resolves to, or one of two one-line readouts on a parse failure, never
 * edtf's own thrown message: a string naming that the end's start instant
 * isn't after the start's, for a string that parsed but whose Interval
 * refused it on exactly that check (see updateDateFeedback's own comment for
 * what that means in practice), a generic "not a date" for anything the
 * grammar itself rejects. That raw message - the full grammar dump, or
 * edtf's own upper-bound wording for a refused Interval - still reaches
 * Zotero.debug on every failure, and reaches the user verbatim as the parked
 * item's hover title (canvas.ts), which is where a "1580..1590" typo for
 * "1580/1590" (a set of two candidate dates, not a continuous span) is still
 * tellable apart from what was meant.
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
 * for resolving to nothing. Removing a source is explicit intent, recorded
 * the moment its Remove button is clicked rather than inferred at Save time
 * from a row going unmatched: a stored source Save reads that no row and no
 * recorded removal names - because it was added from outside this panel
 * after the row list was built, or because a stale re-render mid-Save left a
 * row's `original` behind what is actually stored - is left untouched.
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
import { logFailure, logTrace } from "../../utils/logging";
import {
  toTimelineRange,
  type EdtfForm,
  type TimelineRange,
} from "../../utils/edtfRange";
import {
  addEvent,
  addSource,
  copyEventInto,
  isSameClaim,
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
import { readTimelineDocument, updateTimelineDocument } from "./storage";
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
// The preset-sources list the library context menu's "add to new event"
// entry populates - read-only here; a source's type and name are edited
// after Save, through the normal edit form's own source rows.
export const CREATE_SOURCES_LIST_CLASS = "zoterotimeline-event-create-sources";
export const CREATE_SOURCE_ITEM_CLASS =
  "zoterotimeline-event-create-source-item";

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
 * parsed as and the range it resolves to. On a parse failure this shows one
 * of two one-line readouts, never edtf's own thrown message: a generic
 * "not a date" for anything the grammar itself rejects, or a string naming
 * that the end must start after the start starts, for a string that parsed
 * fine but whose Interval refused it on exactly that check (see the catch
 * block below for what "starts after" means for a mixed-precision pair).
 * Never rewrites `input`, and never refuses the save that follows: a string
 * edtf rejects is still stored verbatim and drawn parked (see canvas.ts), so
 * this panel only ever describes what was typed. Blank input (an optional
 * endDate left empty, or a date field mid-edit) shows no feedback at all
 * rather than an error, since it isn't a parse failure yet.
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
    const message = (err as Error).message;
    logTrace(`[zoteroTimeline] date field rejected "${input}": ${message}`);
    // edtf@4.11.1 throws exactly two shapes: a multi-line grammar dump (or
    // the one-line "No possible parsings") for a string it can't parse at
    // all, or a RangeError for a string that DID parse but whose Interval
    // refused it. That refusal (interval.js's upper setter) compares the two
    // bounds' own START instants, not their spans or precisions: a date-only
    // bound is UTC midnight and a bare timestamp is local time, so
    // "2001-01-01/2001" is refused too (1 Jan 2001 UTC midnight is not after
    // itself), the same shape as a genuinely reversed pair. Neither reading
    // is shown verbatim: the RangeError's own message names the upper
    // bound's start instant after edtf has reserialised it as UTC, which is
    // a value the user never typed and, for the mixed-precision case, not
    // even the span they were comparing.
    feedback.textContent = getString(
      err instanceof RangeError
        ? "event-editor-date-end-before-start"
        : "event-editor-date-unreadable",
    );
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
 * loaded document needs no picker to be unambiguous) and no `presetCreate`
 * fixed the target already. No canvas position exists here to derive a date
 * from the way TASK-25's click gesture does, so unlike that gesture this one
 * asks for the date directly rather than inventing a default - a blank date
 * field does nothing on Create, since Event.date is required and a
 * placeholder value would break the canvas the next time it re-renders
 * (buildTimelineItem parses `date` unconditionally). A blank title falls back
 * to the same "Untitled event" string the click gesture uses, so the two
 * routes produce the same stored title when neither types one.
 *
 * `presetCreate`, when given, is the library context menu's "add to new
 * event" entry point: `documentId` is fixed (no picker, regardless of
 * `documents.length`) and `items` are listed read-only, each becoming a
 * SourceRef on the event Create writes, typed to the library vocabulary's
 * first type - the same default the single "Add source" button uses. An item
 * that would exactly duplicate a ref already on the event is refused by
 * addSource's own duplicate rule; since the event is brand new that can only
 * happen if two of the preset items would resolve to an identical claim, and
 * when it does the refused ones are named back through a warn() rather than
 * silently dropped - a batch that hides a partial failure is worse than one
 * that refuses. Editing a source's type or name happens after Create, through
 * the normal edit form's own source rows, not here.
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
  presetCreate?: { documentId: string; items: Zotero.Item[] },
): void {
  const { libraryID, documents } = creatable;

  let documentSelect: HTMLSelectElement | undefined;
  if (!presetCreate && documents.length > 1) {
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

  if (presetCreate && presetCreate.items.length > 0) {
    const sourcesLabel = doc.createElement("label");
    sourcesLabel.setAttribute(
      "data-l10n-id",
      getLocaleID("event-editor-create-sources-label"),
    );
    container.appendChild(sourcesLabel);

    const sourcesList = doc.createElement("ul");
    sourcesList.classList.add(CREATE_SOURCES_LIST_CLASS);
    for (const item of presetCreate.items) {
      const li = doc.createElement("li");
      li.classList.add(CREATE_SOURCE_ITEM_CLASS);
      li.textContent = labelForItem(item);
      sourcesList.appendChild(li);
    }
    container.appendChild(sourcesList);
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
    const documentId = presetCreate
      ? presetCreate.documentId
      : documentSelect
        ? documentSelect.value
        : documents[0].id;
    const title =
      titleInput.value.trim() || getString("event-editor-untitled-title");
    void (async () => {
      try {
        const typeId = presetCreate?.items.length
          ? ((await peekVocabulary(libraryID)).types[0]?.id ?? "")
          : "";
        let newEventId: string | undefined;
        const attached: string[] = [];
        const alreadyCited: string[] = [];
        const result = await updateTimelineDocument(
          (current) => {
            let next = addEvent(current, { title, date });
            newEventId = next.events[next.events.length - 1].id;
            for (const item of presetCreate?.items ?? []) {
              const added = addSource(next, newEventId, {
                kind: item.isNote() ? "note" : "item",
                libraryID: item.libraryID,
                key: item.key,
                typeId,
              });
              if (added) {
                next = added;
                attached.push(labelForItem(item));
              } else {
                alreadyCited.push(labelForItem(item));
              }
            }
            return next;
          },
          documentId,
          libraryID,
        );
        const created = result?.events.find((e) => e.id === newEventId);
        if (result && created) {
          if (alreadyCited.length > 0) {
            warn(
              getString("event-editor-create-sources-skipped", {
                args: { names: alreadyCited.join(", ") },
              }),
            );
          }
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
 *
 * `presetCreate`, when given, is the library context menu's "add to new
 * event" entry point: the create form targets `presetCreate.documentId`
 * directly (no document picker, regardless of how many are loaded) and lists
 * `presetCreate.items` as sources attached on Create. Nothing is written by
 * rendering this - the event, and its sources, are written only once Create
 * is clicked.
 */
export function renderEventEditor(
  container: HTMLElement,
  selection: EventEditorSelection | null,
  onChange?: (change: EventEditorChange) => void,
  creatable?: { libraryID: number; documents: CreatableDocument[] },
  libraryEditable = true,
  presetCreate?: { documentId: string; items: Zotero.Item[] },
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
    if (creatable && (creatable.documents.length > 0 || presetCreate)) {
      renderCreateForm(
        doc,
        container,
        creatable,
        onChange,
        libraryEditable,
        presetCreate,
      );
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
  // rule the tag list above follows. `original` is the ref the row was
  // rendered from (null for a row added this session), and Save diffs
  // against it by identity (isSameClaim) rather than by position - a
  // position shifts under a second Save in the same session once the first
  // one has already added or removed a source, but a ref's identity does
  // not.
  type SourceRow = { ref: SourceRef; original: SourceRef | null };
  const sources: SourceRow[] = event.sources.map((ref) => ({
    ref: { ...ref },
    original: { ...ref },
  }));

  // Removal is explicit intent, recorded here rather than inferred from a
  // row simply going unmatched against whatever Save reads at write time: an
  // outside write, or a stale re-render mid-Save (see runSave below), must
  // never delete a source the user never clicked Remove on. Every removed
  // row is pushed here, including one whose `original` is still null because
  // its own addition is mid-Save: that addition's post-save reset (see
  // runSave below) promotes such a row's `original` once the add actually
  // lands, which is what lets a *later* Save's removal match it. A row whose
  // addition never gets a Save at all stays null forever and is pruned at
  // the next snapshot instead (see runSave below), since it never had
  // anything in storage to remove.
  //
  // Holds the row object itself, not a copy of `original` taken at click
  // time: a Remove click can land while that same row's own Save is still
  // writing, and `original` only reaches the value that Save is about to
  // write once its post-save reset runs (see runSave below). Resolving
  // `original` fresh from the row when the *next* Save takes its snapshot,
  // rather than freezing it at click time, is what lets that next Save's
  // removal match what actually landed in storage.
  const removed: SourceRow[] = [];

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
        removed.push(row);
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
      if (sources.some((row) => isSameClaim(row.ref, ref))) {
        sourceFeedback.textContent = `"${labelForItem(item)}" is already a source on this event with the same type and no name.`;
        return;
      }
      sources.push({ ref, original: null });
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
  // Chained rather than guarded by disabling the button: a click's snapshot
  // must be taken only once every earlier click's save (including its
  // post-save reset below) has settled, or a second click's `original` is
  // stale against what the first already wrote (see the removal pass below).
  // `.then(runSave, runSave)` rather than `.finally` so one failing save
  // still lets the next click's snapshot run instead of wedging the chain.
  let saveChain: Promise<void> = Promise.resolve();
  saveButton.addEventListener("click", () => {
    saveChain = saveChain.then(runSave, runSave);
  });
  async function runSave(): Promise<void> {
    // Captured now, not read live from `sources` inside the mutate callback
    // below: that callback runs after an await (storage's own note refresh),
    // and an edit landing in that window must not change what this Save
    // writes, nor be lost from the post-save reset (see the reset below).
    const snapshot = sources.map((row) => ({
      row,
      original: row.original,
      ref: { ...row.ref },
      // Set once the addition pass below actually appends this entry's ref.
      // An entry with a null `original` that this Save's addSource call
      // refuses (a duplicate of a claim the same write already keeps) must
      // not be promoted to "written" by the post-save reset - it stays null
      // so the next Save retries the addition instead of silently dropping
      // it (see the reset below).
      added: false,
      // Set by the update pass below for an entry with a non-null `original`:
      // true once its update actually landed, or once the pass found no
      // change to make in the first place. An entry whose original names a
      // claim the update pass never found in storage (a stale re-render's
      // row, see the module docblock) stays false, which keeps the post-save
      // reset from promoting `original` to a ref that was never actually
      // written under that identity.
      written: false,
    }));
    // Same reasoning for removals: a Remove click landing in that window
    // must not be applied by this Save (it wasn't there when this Save's
    // snapshot was taken) and must not be lost - it stays in `removed` for
    // the next Save unless this one already claims it (see the post-save
    // clearing below). `original` is resolved here, from the row, rather
    // than carried as a value fixed at click time: a Remove click can land
    // while that same row's own earlier Save is still writing, and its
    // `original` only catches up to what that Save wrote once this
    // snapshot is taken (see the post-save reset below).
    const removedSnapshot = removed
      .map((row) => ({ row, original: row.original }))
      .filter(
        (entry): entry is { row: SourceRow; original: SourceRef } =>
          entry.original !== null,
      );
    // A row removed while its own addition was never saved (`original` still
    // null, and no Save is in flight for it right now - this snapshot is
    // only ever taken once the previous Save's chain has fully settled)
    // never reaches `removedSnapshot` above and never will: there is nothing
    // in storage for it to remove. Dropped here rather than left to grow
    // `removed` forever.
    for (let i = removed.length - 1; i >= 0; i--) {
      if (removed[i].original === null) {
        removed.splice(i, 1);
      }
    }
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

          // Every source is addressed by identity (isSameClaim), never by
          // its position in the render-time snapshot or in the as-read
          // document: a second Save in the same editor session, or a write
          // from outside the editor entirely, has already shifted both.
          // Identity is many-to-one though (two rows can carry the same
          // kind/key/typeId/name), so each stored source is consumed by at
          // most one edit or removal below - whichever claims the first
          // not-yet-consumed matching index. A stored source no row edits
          // and no recorded removal names is left alone: removal is
          // explicit intent (the Remove button, tracked in `removed`
          // above), never inferred from a row simply going unmatched, which
          // is what let a source a stale re-render never carried a row for
          // get deleted by a later Save (see the module docblock's Sources
          // paragraph).
          const sourcesOf = (doc: typeof current) =>
            doc.events.find((e) => e.id === event.id)?.sources ?? [];
          const asRead = sourcesOf(next);
          const consumed = new Array<boolean>(asRead.length).fill(false);

          // Updates: only rows whose live ref actually differs from what
          // they were rendered from. A row whose original claims nothing in
          // `asRead` is skipped rather than throwing - harmless even when
          // the render this row came from was stale, since unlike the old
          // rule nothing here deletes anything on a mismatch.
          for (const entry of snapshot) {
            if (entry.original === null) {
              continue;
            }
            const original = entry.original;
            const changes: SourceEdits = {};
            if (entry.ref.typeId !== original.typeId) {
              changes.typeId = entry.ref.typeId;
            }
            if (entry.ref.name !== original.name) {
              changes.name = entry.ref.name;
            }
            if (Object.keys(changes).length === 0) {
              entry.written = true;
              continue;
            }
            const index = asRead.findIndex(
              (source, i) => !consumed[i] && isSameClaim(source, original),
            );
            if (index === -1) {
              continue;
            }
            consumed[index] = true;
            const updated = updateSource(next, event.id, index, changes);
            if (updated) {
              next = updated;
              entry.written = true;
            }
          }

          // Removals: each ref the user actually clicked Remove on this
          // session, matched the same way, highest index first so an
          // earlier removal never shifts a later one out from under it.
          const removalIndices: number[] = [];
          for (const entry of removedSnapshot) {
            const index = asRead.findIndex(
              (source, i) =>
                !consumed[i] && isSameClaim(source, entry.original),
            );
            if (index === -1) {
              continue;
            }
            consumed[index] = true;
            removalIndices.push(index);
          }
          removalIndices.sort((a, b) => b - a);
          for (const index of removalIndices) {
            const removedNext = removeSource(next, event.id, index);
            if (removedNext) {
              next = removedNext;
            }
          }

          // Additions last, since they only ever append. A refused duplicate
          // leaves `entry.added` false, which keeps the post-save reset below
          // from promoting it to "written".
          for (const entry of snapshot) {
            if (entry.original !== null) {
              continue;
            }
            const added = addSource(next, event.id, {
              kind: entry.ref.kind,
              libraryID: entry.ref.libraryID,
              key: entry.ref.key,
              typeId: entry.ref.typeId,
              name: entry.ref.name,
            });
            if (added) {
              next = added;
              entry.added = true;
            }
          }

          return next === current ? null : next;
        },
        documentId,
        libraryID,
      );
      const updated = result?.events.find((e) => e.id === event.id);
      if (updated) {
        // Driven from the snapshot, not from `row.ref`: an edit landing
        // while the save was in flight must keep its own live `ref`
        // untouched (it is still unsaved) while still getting an
        // `original` that reflects what this Save actually wrote, which is
        // the snapshot's ref, not the edited live one. A row's `original`
        // is updated whether that row is still in `sources` or has since
        // been moved to `removed`: a removed row's `original` has to keep
        // tracking what this Save actually wrote, or the next Save's
        // removal (built from `removed` at its own snapshot time) matches
        // nothing and the removal is lost. A row that is in neither - gone
        // from `sources` without ever being recorded as removed - is
        // skipped rather than resurrected. An entry whose `original` was
        // null and whose addition this Save's addSource call refused stays
        // null, so the next Save retries the addition instead of treating
        // the refusal as a write. An entry whose `original` was not null
        // stays there too unless `written` is true: an update pass that
        // never found this identity in storage did not write anything under
        // it, and promoting `original` anyway would make the next Save
        // believe a claim that is actually still `original`'s has already
        // become `ref` - retrying the same update, or the same removal, is
        // what the next Save needs to be able to do instead.
        for (const entry of snapshot) {
          if (!sources.includes(entry.row) && !removed.includes(entry.row)) {
            continue;
          }
          if (entry.original === null) {
            if (!entry.added) {
              continue;
            }
          } else if (!entry.written) {
            continue;
          }
          entry.row.original = { ...entry.ref };
        }
        onChange?.({ kind: "saved", documentId, event: updated });
      }
      // Cleared whether the write produced a document or was a no-op
      // (`result` null: nothing in this snapshot actually differed from
      // storage, including a removal that matched nothing because the claim
      // was already gone) - only a removal that never reached storage at all
      // stays outstanding, and that only happens when the write below
      // throws. Clearing here regardless of `updated` is what keeps a
      // completed removal from later matching a claim someone else re-adds
      // from outside: the intent to remove was already satisfied once, and
      // holding onto it would delete that unrelated re-add on the next Save.
      for (const entry of removedSnapshot) {
        const index = removed.indexOf(entry.row);
        if (index !== -1) {
          removed.splice(index, 1);
        }
      }
    } catch (err) {
      logFailure(
        `[zoteroTimeline] failed to save event ${event.id}: ${(err as Error).message}`,
        err,
      );
    }
  }

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
      try {
        // Read fresh rather than copy the `event` this render captured: a
        // save made earlier in this same editor session writes the document
        // but never refreshes that closed-over object, so it would otherwise
        // still carry whatever title, tags, description and sources were on
        // screen when the panel opened.
        const currentDoc = await readTimelineDocument(documentId, libraryID);
        const currentEvent = currentDoc?.events.find((e) => e.id === event.id);
        if (!currentEvent) {
          return;
        }
        const leftBehind = keepSources ? 0 : currentEvent.sources.length;
        // One write, against the target alone. The source document is never
        // opened for writing, which is what makes "the original is untouched"
        // and "a failed write changes nothing anywhere" both true without an
        // ordering argument.
        const result = await updateTimelineDocument(
          (current) => copyEventInto(current, currentEvent, keepSources).doc,
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
