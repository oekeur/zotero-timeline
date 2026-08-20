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
`strict_max_version` 10.\*.

## The pieces you will meet

**The timeline tab.** One tab, opened from the library, holding a horizontal
chronological axis. Each timeline you have toggled on is a lane. Events are
drawn on their lane at their date, and you drag them to change that date.

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
same axis. With more than one timeline visible the canvas becomes read-only,
and says so, because an edit made across merged timelines has to be attributed
back to exactly one document.

## Where your data goes

In your library, not in a plugin config file. Each timeline is a JSON document
held in the content of a Zotero note, parented to a single plugin-owned
container item per library. That container keeps the notes collapsed into one
row and out of Zotero's link-target picker.

The practical consequences are worth knowing before you start:

- Your timelines sync wherever your library syncs, with no extra setup.
- If the container item lands in the trash, your timelines vanish from the
  plugin until you restore it. See
  [Recovering trashed plugin data](/user-guide/plugin-data-howto).
- Events do not show up in Zotero's search, tag selector, or saved searches.
