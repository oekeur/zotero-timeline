# What the plugin stores

::: warning Pre-release
This describes the decided storage design. The code that writes it is not
built yet.
:::

Everything this plugin owns lives in your Zotero library as ordinary items.
There is no plugin database and no external file.

## The shapes

| Object            | Where it lives                                            |
| ----------------- | --------------------------------------------------------- |
| Container item    | One top-level item per library, owned by the plugin       |
| Timeline document | One note item per timeline, parented to the container     |
| Link vocabulary   | One note item per library, parented to the same container |

The container exists so that any number of plugin notes collapse into a single
visible top-level row, and so Zotero's native link picker does not offer them
as link targets.

Timeline notes and the vocabulary note are told apart by tag, not by position:
they carry distinct tags, so listing timelines never picks up the vocabulary.

## Inside a timeline document

A timeline document is JSON. It carries a `version`, the timeline's own
metadata, and its events. Each event has:

| Field         | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `id`          | Unique within this document, not across documents  |
| `title`       | What is drawn on the axis                          |
| `description` | Optional free text                                 |
| `date`        | EDTF string                                        |
| `endDate`     | Optional EDTF string, for an event that spans time |
| `sources`     | Links to library items, each with a link-type id   |
| `tags`        | Free-text strings                                  |

A source reference identifies its target as `{kind, libraryID, key}`. Keys are
what Zotero syncs by; the numeric item ids you may see elsewhere are local to
one machine, so all three fields are needed to identify an item.

A link stores the type's `id` and never its label. Renaming a link type
therefore needs no pass over your timelines, and deleting a type leaves the
links that used it intact, rendering as an unknown type rather than
disappearing.

## Inside the vocabulary

A list of link types, each `{id, label}`. It is per library rather than global,
because the container it lives under is per library. A group library can
therefore carry a different vocabulary from your personal one.

The defaults are cites, supports, contradicts, primary source for, and related
to.

If the vocabulary note goes missing, the plugin recreates it from those
defaults and tells you it did, naming the trashed note so you can restore it.
It is not recreated silently: every source link in the library would otherwise
start rendering as an unknown type with no explanation.

## Version refusal

Both stored shapes carry a `version`. A document written by a newer version of
the plugin than the one reading it is neither parsed nor written. It appears in
the timeline list as unreadable, naming its version and the plugin's, and the
rest of the library carries on.

The alternative is worse. Storage is last-write-wins, so a partial parse
followed by a save would silently erase whatever the newer version added, on a
machine nobody was watching.

## What this costs you

Events are invisible to Zotero's own search, tag selector and saved searches,
and they cannot be cited. They are plugin data that happens to be stored in
library items, not library items in their own right.
