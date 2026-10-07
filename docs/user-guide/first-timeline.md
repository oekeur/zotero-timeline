# Your first timeline

You will go from a library with no timelines to one timeline holding two
events, one of them citing an item from your library. Then you will find that
event again from the item itself. It takes about ten minutes.

## What you will need

- Zotero with the plugin installed from the `.xpi` on
  [GitHub releases](https://github.com/oekeur/zotero-timeline/releases). See
  [Getting started](/user-guide/getting-started) for the supported Zotero
  versions.
- A library with a few items. Any regular item (a book, an article) will do for
  the source. The tutorial calls the one you cite _Bastille_; use whichever
  item suits the event you write.

## Step 1: Open the Timeline tab

Choose **Tools > Timeline**. Pressing Shift+T with the library focused does the
same, as long as the keyboard focus is not in a text field.

A tab titled "Timeline" opens. It has three parts: a sidebar headed "Timelines"
on the left, the canvas in the middle, and an editor panel on the right that
reads "Select an event to edit it, or click an empty spot on the canvas to
create one there."

You did not create a timeline, but the sidebar already lists one called
"Timeline", with one lane on the canvas. Opening the tab in a library with no
timelines creates it for you, and makes it the active one. This is the only
case where just opening the tab writes anything. Your library also gains two
plugin data items, a container titled "Zotero Timeline (plugin data)" and the
timeline's note under it, which the plugin hides from your item list by
default; see
[Why data lives in a note](/user-guide/plugin-data-explanation) if you want to
know where your timelines are stored.

If you open the tab in a library you cannot edit, a banner says so and nothing
is created.

## Step 2: Create the first event

Click an empty spot on the "Timeline" lane.

The editor panel fills in. The event already exists at this point: it is drawn
on the lane, selected, and stored under the title "Untitled event". The Date
field holds the date under your click, written at the precision of the zoom
level.

Your click only created the event because "Timeline" was the active lane. With
several timelines on the canvas, only one is active at a time, and the first
click on a lane that is not active only makes it active. Nothing is created.
Click a second time to create the event. This stops a click into a timeline you
were only reading from adding an event to it. With the single "Timeline" lane
you will not notice it yet.

## Step 3: Title it and give it a date

In the editor:

1. Type `Bastille falls` in **Title**.
2. Set **Date** to `1789-07-14`.
3. Press **Save**.

Below the Date field, a line of feedback names the date form and the range it
covers. For `1789-07-14` it reads `Plain 7/14/1789 – 7/15/1789`.

The field takes EDTF, the extended date format. Try these in the Date field to
see the feedback change:

| You type     | Feedback starts with | Meaning                          |
| ------------ | -------------------- | -------------------------------- |
| `1789-07-14` | Plain                | A single day                     |
| `1793?`      | Uncertain            | A year you are not sure of       |
| `1793/1794`  | Interval             | A span from one year to the next |

Two things to know about the field:

- A string the plugin cannot read, such as `not a date`, shows "Not a date this
  can read". Save still works. The text is stored as typed and the event is
  drawn parked instead of being refused.
- An interval whose end is not after its start shows "The end must begin after
  the start begins".

Set the date back to `1789-07-14` before moving on.

## Step 4: Cite a library item

In the **Sources** part of the editor:

1. Click **Add source…**. Zotero's own item picker opens in a separate window.
2. Select the item and confirm the dialog.
3. A row for the item appears under Sources. Its type select is set to `cites`.
   There is also a "Name (optional)" field, a **Show in library** button and a
   **Remove** button.

At this point the source is not stored yet. Sources are written on **Save**,
like every other field. Press **Save**.

## Step 5: Create the second event

Click another empty spot on the lane, further along the time axis. Title it
`Terror begins` and set Date to `1793/1794`. Press **Save**.

The canvas now shows both events on the "Timeline" lane.

## Step 6: Find the event from the item

1. In the first event's source row, click **Show in library**. Zotero switches
   to the library tab with your item selected.
2. In the item pane, find the **Timelines** section. It can sit below the fold;
   scroll down, or click its icon in the side navigation.
3. The section lists a group headed "Timeline", with one row: the event title
   `Bastille falls`, and a line beneath it with the date and the source, ending
   in the link type, for example `1789-07-14 · Bastille — cites`, with your item's title in
   place of Bastille.
4. Click the row.

The Timeline tab opens with the event selected and the editor showing it.

An item no event cites shows "Not cited by any event." in the same section.

If the timeline was hidden in the sidebar (the checkbox "Show or hide this
timeline"), the jump turns it back on first. If a tag filter was hiding the
event, the jump clears the filter and says "Tag filter cleared to show this
event."

## What you built

You have one timeline with two events, one of them linked to a library item
with the type `cites`, and you can get from the item back to the event.

From here:

- Add a second timeline with the **+** button in the sidebar (its tooltip is
  "Create a timeline"). It becomes a second lane. Creating a timeline does not
  make it the active one.
- Where the data lives, and why it is a note: [Why data lives in a
  note](/user-guide/plugin-data-explanation) and
  [Plugin data reference](/user-guide/plugin-data-reference).
- Why the editor can lose unsaved edits when something else writes to a
  timeline: [How the Timeline tab redraws](/internals/timeline-tab-explanation).
