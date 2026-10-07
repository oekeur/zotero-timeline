# How to duplicate an event to another timeline

Copy an event onto another timeline, in the same library or another one you can
edit.

::: warning Save first
Duplicate copies the event as it was **last saved**, not as it looks in the
editor. Unsaved edits are not copied, and in the cases checked they are also
dropped from the editor when the copy lands. This is current behaviour, tracked
as TASK-99. Click **Save** before you duplicate.
:::

## Prerequisites

- The Timeline tab is open on a library you can edit, with the event selected.
- The event is saved.
- A target timeline exists. Libraries you cannot write are not offered.

## Steps

1. Click **Save** if you changed anything.
2. Click **Duplicate**. A form opens below the buttons.
3. Pick the target in the select (tooltip "The timeline to copy this event
   onto"). Timelines are grouped under their library's name. The event's own
   timeline is listed but never preselected. The form preselects the first
   other timeline.
4. Click **Copy**. **Cancel** closes the form, and clicking **Duplicate** again
   also closes it.

## What the copy holds

The copy gets a new id and carries the title, description, date, end date, tags,
sources and sub-lane of the last saved event. It is independent from then on:
changing one does not change the other.

The editor stays on the original, and the selection does not move. **Delete**
therefore still deletes the original. To delete the copy, select it first.

A copy into another library leaves the sources behind, because a timeline cannot
cite items from another library. A message that you must click away says how
many were dropped: "Copied to (timeline), without its one source. A timeline
cannot cite items from another library."

## Verification

- A message reads "Copied to (timeline)." and the form closes.
- For a target in the library the tab shows, and visible, the copy is drawn on
  the target's lane.
- Selecting the copy shows the title, tags and description you last saved.

## Related

- [The Timeline tab (reference)](/user-guide/timeline-tab-reference)
- [Create and edit an event](/user-guide/edit-events-howto)
