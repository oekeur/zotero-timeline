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
 */
import edtf from "edtf";
import { getLocaleID, getString } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import { toTimelineRange, type TimelineRange } from "../../utils/edtfRange";
import { addEvent, updateEvent, removeEvent } from "./mutations";
import { updateTimelineDocument } from "./storage";
import type { Event as TimelineEvent } from "./schema";
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
export const ACTIONS_CLASS = "zoterotimeline-event-actions";
export const SAVE_BUTTON_CLASS = "zoterotimeline-event-save";
export const DELETE_BUTTON_CLASS = "zoterotimeline-event-delete";
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

// One Fluent id per EDTF form edtf@4.11.1 can report via `.type` (plus
// uncertain/approximate, which share type "Date" with the plain form and are
// told apart only by their qualifiers).
const DATE_FORM_LOCALE_IDS: Record<string, FluentMessageId> = {
  plain: "event-editor-date-form-plain",
  uncertain: "event-editor-date-form-uncertain",
  approximate: "event-editor-date-form-approximate",
  interval: "event-editor-date-form-interval",
  "one-of": "event-editor-date-form-one-of",
  season: "event-editor-date-form-season",
  list: "event-editor-date-form-list",
};

function formOf(
  type: string,
  uncertain: boolean,
  approximate: boolean,
): string {
  // The test bundler's scope hoisting renames some of edtf's classes to avoid
  // colliding with an identically-named binding elsewhere in the bundle
  // ("Date" collides with the global; "Set" doesn't and is left alone) -
  // `.type` is `this.constructor.name`, so it inherits whatever name survived
  // that pass. Verified empirically against the live bundle: "Date" comes
  // back "_Date", "Interval" comes back "_Interval", "Set" comes back "Set"
  // unchanged. Stripping a leading underscore is exact for every case seen
  // and a no-op for every case that isn't.
  const normalized = type.replace(/^_+/, "");
  switch (normalized) {
    case "Date":
      if (uncertain) return "uncertain";
      if (approximate) return "approximate";
      return "plain";
    case "Interval":
      return "interval";
    // EDTF Level 2's square-bracket notation ("[1580,1590]", "[1580..1590]")
    // parses to type "Set": a discrete list of candidate dates, not a
    // continuous span, even though toTimelineRange maps both onto a similar
    // start/end for drawing.
    case "Set":
      return "one-of";
    case "Season":
      return "season";
    case "List":
      return "list";
    default:
      return normalized;
  }
}

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

  let value: ReturnType<typeof edtf>;
  let range: TimelineRange;
  try {
    value = edtf(input);
    range = toTimelineRange(input);
  } catch (err) {
    feedback.textContent = (err as Error).message;
    return;
  }

  const form = formOf(value.type, range.uncertain, range.approximate);
  const formSpan = doc.createElement("span");
  formSpan.classList.add(DATE_FEEDBACK_FORM_CLASS);
  const localeId = DATE_FORM_LOCALE_IDS[form];
  if (localeId) {
    formSpan.setAttribute("data-l10n-id", getLocaleID(localeId));
  } else {
    formSpan.textContent = form;
  }
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
 */
function renderCreateForm(
  doc: Document,
  container: HTMLElement,
  creatable: { libraryID: number; documents: CreatableDocument[] },
  onChange?: (change: EventEditorChange) => void,
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
 * `selection` null renders a prompt naming both ways to get an event into the
 * editor, rather than blanking - the panel stays in place across a selection
 * change so the canvas next to it never has to reflow. `creatable`, when
 * given, adds the typed equivalent of clicking empty canvas below the prompt.
 *
 * `onChange` runs once a save, delete or create actually wrote a note, so the
 * caller can refresh the canvas item and, for a delete, clear the selection.
 * A no-op save (nothing actually changed) writes nothing and calls nothing.
 */
export function renderEventEditor(
  container: HTMLElement,
  selection: EventEditorSelection | null,
  onChange?: (change: EventEditorChange) => void,
  creatable?: { libraryID: number; documents: CreatableDocument[] },
): void {
  const doc = container.ownerDocument!;
  container.textContent = "";

  if (!selection) {
    const prompt = doc.createElement("p");
    prompt.classList.add(EMPTY_PROMPT_CLASS);
    prompt.setAttribute("data-l10n-id", getLocaleID("event-editor-empty"));
    container.appendChild(prompt);
    if (creatable && creatable.documents.length > 0) {
      renderCreateForm(doc, container, creatable, onChange);
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

  const actions = doc.createElement("div");
  actions.classList.add(ACTIONS_CLASS);
  container.appendChild(actions);

  const saveButton = doc.createElement("button");
  saveButton.type = "button";
  saveButton.classList.add(SAVE_BUTTON_CLASS);
  saveButton.setAttribute(
    "data-l10n-id",
    getLocaleID("event-editor-save-button"),
  );
  actions.appendChild(saveButton);
  saveButton.addEventListener("click", () => {
    void (async () => {
      try {
        const result = await updateTimelineDocument(
          (current) =>
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
            }),
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
}
