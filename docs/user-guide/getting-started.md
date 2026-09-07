# Getting started

::: warning Pre-release
There is no installable release yet. This page describes the intended first
run so the shape of the plugin is on record; it will become a real walkthrough
when the first feature lands. To try the current state, build it yourself from
[Development setup](/contributing/development-setup).
:::

## What the plugin is for

You are building a chronology, and the evidence for it is already in your Zotero
library. Zotero can tell you what you have read. It cannot tell you what
happened, in what order, and which of your sources back each claim.

Zotero Timeline adds that layer. You author _events_: an event has a title, a
date, an optional description, tags, and any number of links to items in your
library. Each link carries a type, so a source that supports an event and a
source that contradicts it are stored differently and drawn differently.

## Requirements

Zotero 7, 8, 9 or 10. The plugin declares `strict_min_version` 6.999 and
`strict_max_version` 10.0.\*.

The ceiling is narrow on purpose. The plugin replaces
`Zotero.CollectionTreeRow.prototype.getSearchObject` to keep its own storage
notes out of the items list, and it registers a custom `Zotero_Tabs` tab type
whose state persists into the profile's `session.json`. Neither is documented
API, so a Zotero major the plugin has never been tested against is likelier to
break it quietly than to work. A ceiling that is too low makes the plugin absent
from Tools > Plugins, which touches no data and is undone by a release; a
ceiling that is too high lets it load and misbehave on top of a library.

Widening it back is a decision to make against those two call sites, not a
default. Note also that it cannot be tested locally: beta and source builds
ignore `strict_max_version` entirely, and the development profile runs a beta,
so the ceiling only ever applies to users on stable builds.

## The pieces you will meet

**The timeline tab.** One tab, opened from **Tools** or with `shift+T`, holding
a horizontal chronological axis. Each timeline you have toggled on is a lane.
Events are drawn on their lane at their date. Click an event to select it, then
drag to change that date.

**Events.** Created on a timeline, never in your item list. Events are not
Zotero items, so they do not appear in collections, exports, or citations. That
is deliberate; [Why data lives in a note](/user-guide/plugin-data-explanation)
explains the trade.

**Dates.** Dates are written in [EDTF](https://www.loc.gov/standards/datetime/),
the ISO 8601-2 extended date format, so uncertainty is expressible rather than
guessed at:

| You write         | It means                     |
| ----------------- | ---------------------------- |
| `1621`            | that year                    |
| `1621?`           | uncertain, probably 1621     |
| `1580~`           | approximately 1580           |
| `[1580..1590]`    | one year in that range       |
| `1943-05/1943-06` | an interval spanning the two |

**Source links.** From an event, pick an item in your library and give the link
a type. The starting vocabulary is cites, supports, contradicts, primary source
for, and related to. You can rename, add and remove types; see
[the plugin data reference](/user-guide/plugin-data-reference) for where that
list is kept.

**The combined view.** Toggle a second timeline on and both are drawn on the
same axis, and both stay editable. One timeline is active at a time: it is the
one your edits land on, and it is marked on the canvas so you can see where a
drag will go before you make it. Click a lane, an event in it, or its row in the
sidebar to make that timeline active. Toggling a timeline on does not steal the
active mark, so you can bring a second chronology up for reference without
losing your place.

Dragging an event from one lane into another does nothing on purpose. Moving an
event between timelines is a delete and a create rather than an edit, so it goes
through Duplicate in the event editor, which asks you where it should land.

The canvas goes read-only in one case: a library you can read but not write, a
group library shared with you being the usual one. It says so on the surface
rather than leaving you to work it out from controls that do nothing.

## Where your data goes

In your library, not in a plugin config file. Each timeline is a JSON document
held in the content of a Zotero note, parented to a single plugin-owned
container item per library. That container keeps the notes collapsed into one
row and out of Zotero's link-target picker, and that row is hidden from your
item list by default.

The practical consequences are worth knowing before you start:

- Your timelines sync wherever your library syncs, with no extra setup.
- If the container item lands in the trash, your timelines vanish from the
  plugin until you restore it. See
  [Recovering trashed plugin data](/user-guide/plugin-data-howto).
- Events do not show up in Zotero's search, tag selector, or saved searches.
