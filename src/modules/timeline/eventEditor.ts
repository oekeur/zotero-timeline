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
 * Dates are TASK-24's; this editor only ever touches title, description and
 * tags, and leaves date/endDate/sources untouched on save.
 */
import { getLocaleID } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import { updateEvent, removeEvent } from "./mutations";
import { updateTimelineDocument } from "./storage";
import type { Event as TimelineEvent } from "./schema";

export interface EventEditorSelection {
  documentId: string;
  libraryID: number;
  event: TimelineEvent;
}

export type EventEditorChange =
  | { kind: "saved"; documentId: string; event: TimelineEvent }
  | { kind: "deleted"; documentId: string; eventId: string };

// Stable hooks a caller (or a test) can select on, since the DOM shape itself
// is not part of the contract.
export const TITLE_INPUT_CLASS = "zoterotimeline-event-title";
export const DESCRIPTION_INPUT_CLASS = "zoterotimeline-event-description";
export const TAG_CLASS = "zoterotimeline-event-tag";
export const TAG_TEXT_CLASS = "zoterotimeline-event-tag-text";
export const TAG_REMOVE_BUTTON_CLASS = "zoterotimeline-event-tag-remove";
export const TAG_INPUT_CLASS = "zoterotimeline-event-tag-input";
export const SAVE_BUTTON_CLASS = "zoterotimeline-event-save";
export const DELETE_BUTTON_CLASS = "zoterotimeline-event-delete";
export const EMPTY_PROMPT_CLASS = "zoterotimeline-event-empty";

/**
 * `selection` null renders a prompt naming both ways to get an event into the
 * editor, rather than blanking - the panel stays in place across a selection
 * change so the canvas next to it never has to reflow.
 *
 * `onChange` runs once a save or delete actually wrote a note, so the caller
 * can refresh the canvas item and, for a delete, clear the selection. A no-op
 * save (nothing actually changed) writes nothing and calls nothing.
 */
export function renderEventEditor(
  container: HTMLElement,
  selection: EventEditorSelection | null,
  onChange?: (change: EventEditorChange) => void,
): void {
  const doc = container.ownerDocument!;
  container.textContent = "";

  if (!selection) {
    const prompt = doc.createElement("p");
    prompt.classList.add(EMPTY_PROMPT_CLASS);
    prompt.setAttribute("data-l10n-id", getLocaleID("event-editor-empty"));
    container.appendChild(prompt);
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
