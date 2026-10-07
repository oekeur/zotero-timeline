# How to use sub-lanes

Read and write events in a timeline's sub-lanes.

::: warning No editor control sets a sub-lane
A sub-lane is the `track` value on an event. The event editor has no field for
it, and nothing in the Timeline tab creates a sub-lane or moves an event
between them. A sub-lane exists only while at least one event in the timeline
carries a `track`. The plugin's own note warns that editing the stored note by
hand "will corrupt your timeline", so this page does not describe doing that.
:::

## Prerequisites

- The Timeline tab is open on a timeline that has events with a `track`. How the
  value got there is outside what the tab offers.

## What you see

A timeline with sub-lanes draws its own label as a parent row with one nested
row per sub-lane, each labelled with the track name, in the order the tracks
first appear in the timeline's events. The parent row draws no events of its
own. Events with no track on the same timeline draw in the parent row.

Activating or highlighting a timeline tints the parent row and every sub-lane
together. The sidebar still lists one row for the timeline.

## Create an event in a sub-lane

1. Make the timeline active. Click its name in the sidebar, or click its
   lane once.
2. Click empty space inside the sub-lane's own row, at the date you want. The
   event is created with that sub-lane's track and "Untitled event" as its title.
3. Edit it as usual. See [Create and edit an event](/user-guide/edit-events-howto).

The create form below the "Select an event" prompt has no sub-lane field, so an
event made there has no track.

## Move dates inside a sub-lane

Dragging works as on any lane, and it only changes the date. A drag cannot move
an event into a different sub-lane.

## Duplicate keeps the sub-lane

[Duplicate](/user-guide/duplicate-event-howto) copies the `track` too. A copy
onto another timeline brings its track name with it, so that timeline draws a
sub-lane of that name.

## Verification

- A click in a sub-lane's row draws the new event in that row, not the parent.

## Related

- [The Timeline tab (reference)](/user-guide/timeline-tab-reference)
- [What the plugin stores](/user-guide/plugin-data-reference)
