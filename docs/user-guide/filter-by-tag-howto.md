# How to filter by tag

Narrow the canvas to the events that carry the tags you pick.

## Prerequisites

- At least one event on a visible timeline has a tag. Add one in the event
  editor: type it in "Add a tag and press Enter", press Enter, click **Save**.

## Steps

1. Find the "Tags" section at the bottom of the sidebar. It lists one chip for
   every tag used on a visible timeline, sorted by character code (capitals
   before lowercase).
2. Click a chip. It becomes selected, and every event on the canvas that does
   not carry that tag is hidden.
3. Click more chips to widen the filter. An event shows when it carries any of
   the selected tags.
4. Click a selected chip again to clear it. With none selected, nothing is
   hidden.

## What the filter does and does not do

- It hides events with no tags as soon as any chip is selected.
- A lane with no matching events stays on the canvas, empty.
- Only tags from visible timelines are offered. Hide a timeline and its tags
  leave the list. If a selected tag leaves with it, the selection drops it.
- "Alpha" and "alpha" are two chips. The filter does not fold case.
- If the filter hides the event open in the editor, the editor returns to its
  empty state.
- The filter is not stored. Closing the tab clears it.

## When a jump clears the filter

Clicking an event in the item pane's "Timelines" section jumps to it in the tab.
If your filter would hide that event, the plugin clears the filter first, so the
event can be shown. A line under "Tags" then reads "Tag filter cleared to show
this event." It goes away the next time the sidebar redraws, such as on your next
chip click. If the filter already shows the event, nothing changes and no notice
appears.

## Verification

- The selected chips are marked, and the hidden events are gone from the
  canvas.
- With no tags on any visible timeline, the section reads "No tags on the
  visible timelines yet. Add one from the event editor to filter by it here."

## Related

- [The Timeline tab (reference)](/user-guide/timeline-tab-reference)
- [Create and edit an event](/user-guide/edit-events-howto)
