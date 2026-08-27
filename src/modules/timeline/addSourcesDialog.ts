/**
 * "Add as sources to ...": attaches a library-context-menu selection to an
 * event that already exists, on the timeline TimelineMenuEntry names.
 *
 * The event picker is a real chrome document
 * (chrome://zoterotimeline/content/addSourcesDialog.xhtml), the way
 * mindmap's addLink.xhtml is, and deliberately not a ztoolkit.Dialog:
 * timelineTab.ts's own docblock records why a Dialog is unusable here - it
 * opens about:blank, which carries no Fluent strings so every label would
 * render empty, sizes itself on a timer this form's async data-load
 * outlasts, and will not open an HTML select's dropdown at all, which is
 * exactly the control this picker needs for a timeline that can hold many
 * events. Opening the tab in a pick-an-event mode was the other option on
 * the table; a standalone window was chosen instead because the click that
 * opens it comes from the library, not from the tab, and re-resolving the
 * tab onto a library it may not currently show is a bigger disruption than a
 * small window for a two-field form.
 *
 * The form's own text is read through getString rather than data-l10n-id,
 * the same choice vocabularySettings.ts makes and for the same reason: the
 * whole thing is rebuilt from scratch once its data has loaded, so there is
 * nothing for a static <linkset> to translate in place, and the window
 * carries no Fluent linkset of its own as a result.
 *
 * Every source is added inside one updateTimelineDocument call, so a
 * selection of several items writes one note rather than one per item. An
 * item whose ref exactly duplicates one already on the event is refused by
 * TASK-30's own duplicate rule (mutations.ts's addSource) rather than
 * doubled, and is reported back by name next to how many did attach, so a
 * partial result is visible on the surface rather than only in a return
 * value nothing shows.
 */
import { getString } from "../../utils/locale";
import { logFailure } from "../../utils/logging";
import { readCached } from "./documentCache";
import { addSource } from "./mutations";
import { labelForItem } from "./sourceLabels";
import { updateTimelineDocument } from "./storage";
import { peekVocabulary } from "./vocabulary";
import type { TimelineMenuEntry } from "./libraryContextMenu";
import type { LinkType } from "./schema";

export const CONTEXT_CLASS = "zoterotimeline-add-sources-context";
export const EMPTY_CLASS = "zoterotimeline-add-sources-empty";
export const FORM_CLASS = "zoterotimeline-add-sources-form";
export const EVENT_SELECT_CLASS = "zoterotimeline-add-sources-event";
export const TYPE_SELECT_CLASS = "zoterotimeline-add-sources-type";
export const RESULT_CLASS = "zoterotimeline-add-sources-result";
export const ACTIONS_CLASS = "zoterotimeline-add-sources-actions";
export const ATTACH_BUTTON_CLASS = "zoterotimeline-add-sources-attach";
export const DISMISS_BUTTON_CLASS = "zoterotimeline-add-sources-dismiss";

/** The vocabulary's first type, which is what a new source defaults to. A
 * library's vocabulary is never empty (TASK-31's write path refuses that),
 * so this only returns undefined for an empty list nothing here can produce. */
export function defaultTypeId(types: LinkType[]): string | undefined {
  return types[0]?.id;
}

export type AttachOutcome = {
  attached: string[];
  alreadyCited: string[];
};

/**
 * Adds one SourceRef per item onto the named event, in the one note write
 * updateTimelineDocument's mutate callback turns into. An item that would
 * exactly duplicate a ref already on the event is skipped by addSource
 * rather than doubled, and named in `alreadyCited` instead of `attached` so
 * the caller can report a partial result rather than a bare success.
 */
export async function attachItemsToEvent(
  documentId: string,
  libraryID: number,
  eventId: string,
  items: Zotero.Item[],
  typeId: string,
): Promise<AttachOutcome> {
  const attached: string[] = [];
  const alreadyCited: string[] = [];
  await updateTimelineDocument(
    (current) => {
      let next = current;
      for (const item of items) {
        const result = addSource(next, eventId, {
          kind: "item",
          libraryID: item.libraryID,
          key: item.key,
          typeId,
        });
        if (result) {
          next = result;
          attached.push(labelForItem(item));
        } else {
          alreadyCited.push(labelForItem(item));
        }
      }
      return next === current ? null : next;
    },
    documentId,
    libraryID,
  );
  return { attached, alreadyCited };
}

/**
 * Renders the picker into `container`: which event, which link type,
 * Attach and Cancel. Reads the timeline's own document and the library's
 * vocabulary itself, rather than taking either as a parameter, so a caller
 * only ever needs the TimelineMenuEntry the context menu already resolved.
 */
export async function renderAddSourcesDialog(
  container: HTMLElement,
  entry: TimelineMenuEntry,
  items: Zotero.Item[],
  onDismiss: () => void,
): Promise<void> {
  const doc = container.ownerDocument!;
  container.textContent = "";

  const context = doc.createElement("p");
  context.classList.add(CONTEXT_CLASS);
  context.textContent = getString("add-sources-dialog-context", {
    args: { count: items.length, timeline: entry.name },
  });
  container.appendChild(context);

  const note = (await Zotero.Items.getAsync(entry.noteItemID)) as
    | Zotero.Item
    | undefined;
  if (!note) {
    const missing = doc.createElement("p");
    missing.classList.add(EMPTY_CLASS);
    missing.textContent = getString("add-sources-dialog-empty");
    container.appendChild(missing);
    appendDismissOnly(doc, container, onDismiss);
    return;
  }

  const [{ doc: timelineDoc }, vocabulary] = await Promise.all([
    readCached(note),
    peekVocabulary(entry.libraryID),
  ]);

  if (timelineDoc.events.length === 0) {
    const empty = doc.createElement("p");
    empty.classList.add(EMPTY_CLASS);
    empty.textContent = getString("add-sources-dialog-empty");
    container.appendChild(empty);
    appendDismissOnly(doc, container, onDismiss);
    return;
  }

  const form = doc.createElement("div");
  form.classList.add(FORM_CLASS);
  container.appendChild(form);

  const eventLabel = doc.createElement("label");
  eventLabel.textContent = getString("add-sources-dialog-event-label");
  form.appendChild(eventLabel);

  const eventSelect = doc.createElement("select");
  eventSelect.classList.add(EVENT_SELECT_CLASS);
  for (const event of timelineDoc.events) {
    const option = doc.createElement("option");
    option.value = event.id;
    option.textContent = `${event.title} — ${event.date}`;
    eventSelect.appendChild(option);
  }
  form.appendChild(eventSelect);

  const typeLabel = doc.createElement("label");
  typeLabel.textContent = getString("add-sources-dialog-type-label");
  form.appendChild(typeLabel);

  const typeSelect = doc.createElement("select");
  typeSelect.classList.add(TYPE_SELECT_CLASS);
  for (const type of vocabulary.types) {
    const option = doc.createElement("option");
    option.value = type.id;
    option.textContent = type.label;
    typeSelect.appendChild(option);
  }
  const initialTypeId = defaultTypeId(vocabulary.types);
  if (initialTypeId !== undefined) {
    typeSelect.value = initialTypeId;
  }
  form.appendChild(typeSelect);

  const result = doc.createElement("div");
  result.classList.add(RESULT_CLASS);
  container.appendChild(result);

  const actions = doc.createElement("div");
  actions.classList.add(ACTIONS_CLASS);
  container.appendChild(actions);

  const attachButton = doc.createElement("button");
  attachButton.type = "button";
  attachButton.classList.add(ATTACH_BUTTON_CLASS);
  attachButton.textContent = getString("add-sources-dialog-attach-button");
  actions.appendChild(attachButton);

  const dismissButton = doc.createElement("button");
  dismissButton.type = "button";
  dismissButton.classList.add(DISMISS_BUTTON_CLASS);
  dismissButton.textContent = getString("add-sources-dialog-cancel-button");
  dismissButton.addEventListener("click", () => onDismiss());
  actions.appendChild(dismissButton);

  attachButton.addEventListener("click", () => {
    void (async () => {
      attachButton.disabled = true;
      try {
        const outcome = await attachItemsToEvent(
          timelineDoc.id,
          entry.libraryID,
          eventSelect.value,
          items,
          typeSelect.value,
        );
        form.style.display = "none";
        attachButton.style.display = "none";

        const success = doc.createElement("p");
        success.textContent = getString("add-sources-dialog-result-success", {
          args: { count: outcome.attached.length },
        });
        result.appendChild(success);

        if (outcome.alreadyCited.length > 0) {
          const skipped = doc.createElement("p");
          skipped.textContent = getString("add-sources-dialog-result-skipped", {
            args: { names: outcome.alreadyCited.join(", ") },
          });
          result.appendChild(skipped);
        }

        dismissButton.textContent = getString(
          "add-sources-dialog-close-button",
        );
      } catch (err) {
        attachButton.disabled = false;
        logFailure(
          `[zoteroTimeline] failed to attach sources: ${(err as Error).message}`,
          err,
        );
      }
    })();
  });
}

function appendDismissOnly(
  doc: Document,
  container: HTMLElement,
  onDismiss: () => void,
): void {
  const actions = doc.createElement("div");
  actions.classList.add(ACTIONS_CLASS);
  container.appendChild(actions);

  const dismissButton = doc.createElement("button");
  dismissButton.type = "button";
  dismissButton.classList.add(DISMISS_BUTTON_CLASS);
  dismissButton.textContent = getString("add-sources-dialog-close-button");
  dismissButton.addEventListener("click", () => onDismiss());
  actions.appendChild(dismissButton);
}

const ADD_SOURCES_DIALOG_URL =
  "chrome://zoterotimeline/content/addSourcesDialog.xhtml";

export const ADD_SOURCES_DIALOG_CONTENT_ID =
  "zoterotimeline-add-sources-dialog-content";

/**
 * Opens the standalone picker and resolves once it closes. Always
 * Zotero.getMainWindow() rather than a passed-in window, the same choice
 * sourcePicker.ts makes: the dialog is a top-level chrome window of its own,
 * not something scoped to whichever pane's context menu it was opened from.
 */
export function openAddSourcesDialog(
  entry: TimelineMenuEntry,
  items: Zotero.Item[],
): Promise<void> {
  return new Promise((resolve) => {
    const mainWindow = Zotero.getMainWindow() as unknown as {
      openDialog: (...args: unknown[]) => Window;
    };
    const dialog = mainWindow.openDialog(
      ADD_SOURCES_DIALOG_URL,
      "",
      "chrome,centerscreen,resizable,dialog=no",
    );

    dialog.addEventListener(
      "load",
      () => {
        dialog.addEventListener("unload", () => resolve(), { once: true });
        dialog.document.documentElement!.setAttribute(
          "title",
          getString("add-sources-dialog-title"),
        );
        const content = dialog.document.getElementById(
          ADD_SOURCES_DIALOG_CONTENT_ID,
        ) as HTMLElement;
        void renderAddSourcesDialog(content, entry, items, () => {
          dialog.close();
        });
      },
      { once: true },
    );
  });
}
