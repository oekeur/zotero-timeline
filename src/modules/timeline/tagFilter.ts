/**
 * The tag filter: the union of tags carried by events on the timelines
 * TASK-39's sidebar currently shows, and the bank of toggle chips that lets a
 * user narrow the canvas by them (applied to the canvas itself by TASK-51).
 *
 * The set comes from the visible timelines, not the library. A tag authored
 * on a timeline toggled out of the view is not offered: filtering by it would
 * produce an empty canvas with no way to tell whether the tag matched nothing
 * or its timeline was simply closed. Compared as authored - no case folding,
 * no normalisation. Two spellings are two tags, and showing both is the
 * signal to fix one, not something this module silently merges.
 *
 * Several tags select the union. The purpose is surfacing everything on a
 * subject across timelines, and an intersection narrows the wrong way for
 * that: two tags naming the same subject differently would return nothing.
 */
import { getLocaleID } from "../../utils/locale";
import type { StoredTimeline } from "./storage";

export const TAG_FILTER_CLASS = "zoterotimeline-sidebar-tags";
export const TAG_FILTER_HEADING_CLASS = "zoterotimeline-sidebar-tags-heading";
export const TAG_FILTER_LIST_CLASS = "zoterotimeline-tag-filter-list";
export const TAG_FILTER_CHIP_CLASS = "zoterotimeline-tag-filter-chip";
export const TAG_FILTER_CHIP_SELECTED_CLASS =
  "zoterotimeline-tag-filter-chip-selected";
export const TAG_FILTER_EMPTY_CLASS = "zoterotimeline-tag-filter-empty";

/**
 * The union of every tag on every event across `visible`, sorted for a
 * stable, scannable list. Sorting only orders the display; it folds nothing,
 * so two differently-spelled or differently-cased tags still show as two
 * entries.
 */
export function collectVisibleTags(visible: StoredTimeline[]): string[] {
  const tags = new Set<string>();
  for (const timeline of visible) {
    for (const event of timeline.doc.events) {
      for (const tag of event.tags) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags).sort();
}

/**
 * Renders the tag filter section into `container`, replacing whatever it
 * held. The caller owns the selection: `onToggle` fires with the clicked
 * tag, and the caller is expected to update its own state and call this
 * again, the same rebuild-on-change pattern every other sidebar control
 * already follows (see timelineTab.ts's renderSidebar).
 */
export function renderTagFilter(
  doc: Document,
  container: HTMLElement,
  allTags: string[],
  selected: ReadonlySet<string>,
  onToggle: (tag: string) => void,
): void {
  container.textContent = "";
  container.classList.add(TAG_FILTER_CLASS);

  const heading = doc.createElement("div");
  heading.classList.add(TAG_FILTER_HEADING_CLASS);
  heading.setAttribute(
    "data-l10n-id",
    getLocaleID("timeline-sidebar-tags-heading"),
  );
  container.appendChild(heading);

  if (allTags.length === 0) {
    const empty = doc.createElement("div");
    empty.classList.add(TAG_FILTER_EMPTY_CLASS);
    empty.setAttribute(
      "data-l10n-id",
      getLocaleID("timeline-sidebar-tags-empty"),
    );
    container.appendChild(empty);
    return;
  }

  const list = doc.createElement("div");
  list.classList.add(TAG_FILTER_LIST_CLASS);
  for (const tag of allTags) {
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.classList.add(TAG_FILTER_CHIP_CLASS);
    // The tag itself, authored free text rather than a plugin message, so it
    // is set directly rather than through data-l10n-id.
    chip.textContent = tag;
    const isSelected = selected.has(tag);
    chip.setAttribute("aria-pressed", String(isSelected));
    chip.classList.toggle(TAG_FILTER_CHIP_SELECTED_CLASS, isSelected);
    chip.addEventListener("click", () => onToggle(tag));
    list.appendChild(chip);
  }
  container.appendChild(list);
}
