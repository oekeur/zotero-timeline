# Settings: Zotero Timeline

The plugin's pane in Zotero's Settings window is titled "Zotero Timeline". It has
three groups, in this order: the preference for hiding the plugin's own items, the
link-type editor, and the feedback buttons. The pane's last line shows the plugin
name, build version and build time.

For tasks, see [How to change the plugin's settings](/user-guide/settings-howto)
and [How to edit a library's link types](/user-guide/link-types-howto).

## Hide the plugin's own items

| Control  | Label                                              |
| -------- | -------------------------------------------------- |
| Checkbox | "Hide Zotero Timeline's own items from my library" |

Default: on. The preference is `extensions.zotero.zoterotimeline.hideTimelineNotes`.

The help text under it reads: "Zotero Timeline keeps your timelines in a note
item in each library, so they sync with everything else. Turn this off if you want
to see those items in your library."

With the preference on, the item tree leaves out the "Zotero Timeline (plugin
data)" container and the storage and vocabulary notes under it, in every library
and collection view. Two views are never filtered: the trash, so that trashed
plugin data stays recoverable, and feeds. The change applies to open item trees
without a restart, in both directions.

## Link types

The editor works on one library at a time. See
[what the plugin stores](/user-guide/plugin-data-reference) for how a vocabulary is
stored.

### Layout

- **Library**: a select listing every library except feeds, My Library first
  selected each time the pane opens. Switching libraries discards an open add or
  edit form.
- **List**: the library's link types, one row each, showing the label. Click a row
  to select it.
- **Buttons**: "Add", "Edit", "Delete". "Edit" and "Delete" are disabled until a
  row is selected. All three are disabled while a write is in progress.
- **Form**: "Label" field with "Save" and "Cancel", shown in place of the list
  while adding or editing. A label that is blank after trimming is ignored.

A new library's list starts as the defaults: cites, supports, contradicts,
primary source for, related to.

### Behavior

- **Add** appends a type with a freshly generated id.
- **Edit** changes the label and never the id. Every source link keeps pointing at
  the same type, so a rename needs no migration. Saving the label unchanged writes
  nothing.
- **Delete** removes the type from the list and touches no source link. A link that
  used the type then shows "(unknown type)". Deleting always asks first.
- A library's list cannot be emptied.
- The list on screen only changes after the write has succeeded, so a failed write
  leaves the list and your typed label as they were.

### Delete confirmation

Titled "Delete link type". The message counts the source links in that library's
timelines that use the type:

| Count   | Message                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| 0       | "Delete this link type? No source links use it."                                                                     |
| 1       | "Delete this link type? 1 source link uses it and will show as "(unknown type)" there."                              |
| 2+      | "Delete this link type? N source links use it and will show as "(unknown type)" there."                              |
| Unknown | "Could not check how many source links use this type: the library's timeline data could not be read. Delete anyway?" |

The count is advice. It never blocks the delete.

### Notes the editor can show

| Text                                                                                                                                              | Meaning                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| "Loading…"                                                                                                                                        | The library's list is being read.                                 |
| "These are the default link types. They have not been saved for this library yet; the first change you make here creates the list."               | The library has no stored list. Opening the pane creates nothing. |
| "This library's link types were saved by a newer version of Zotero Timeline and can't be edited here. Update the plugin to edit them."            | The stored list is from a newer plugin version.                   |
| "Zotero Timeline could not read this library's link types (&lt;message&gt;). It will not overwrite them; fix or restore the note from the trash." | The stored list does not parse.                                   |

### Errors on save

| Message                                                                                 | Cause                            |
| --------------------------------------------------------------------------------------- | -------------------------------- |
| "This library can't be edited, so the change was not saved."                            | The library is read-only.        |
| "A library's link types can't be empty. Add another type before deleting the last one." | The delete would empty the list. |
| "Zotero Timeline could not save this change: &lt;message&gt;"                           | Any other failure.               |

### Where changes show

Every write to a library's timeline data, including a vocabulary change, makes the
Timelines section in the item pane read again. A renamed type therefore shows its
new label in the section without any click there.

## Feedback

Two buttons open a GitHub issue form in your default browser through
`Zotero.launchURL`. The help text reads: "Report a bug opens a form on GitHub with
your plugin version, your Zotero version, your operating system, and this plugin's
recent errors already filled in. Nothing is sent until you submit the form there,
and every field stays editable first."

| Button               | Opens                                                                                 | Prefilled                                                              |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| "Report a bug…"      | `https://github.com/oekeur/zotero-timeline/issues/new` with the `bug_report.yml` form | "Plugin version", "Zotero version", "Operating system", "Error output" |
| "Request a feature…" | The same address with the `feature_request.yml` form                                  | Nothing                                                                |

The operating system is Windows, macOS, Linux or Other.

### What "Error output" contains

The text comes from Zotero's recent-error buffer, which exists whether or not
debug logging was ever enabled. Only entries that belong to this plugin are kept:
those carrying the `[zoteroTimeline]` prefix (matched without regard to capitalisation) and uncaught
exceptions whose source file is the plugin's own script, `zoterotimeline.js`.
Other plugins' errors and Zotero's own are left out.

The field is omitted when no entry qualifies. The whole link is capped at 6900
characters, so when the entries do not fit the oldest are dropped and the text
begins with "[older entries dropped to fit the URL; the full log is in Zotero
under Help, Report Errors.]".

Entries can contain absolute file paths, which name your operating system account
and home directory. Read the field before you submit.

## Language

The pane, the item pane section and the context menu are translated into Dutch
(nl-NL). Zotero picks the language from its own locale setting, read at startup.
For example, the two buttons read "Een bug melden…" and "Een functie voorstellen…".

Link-type names are not translated. They are stored data seeded once per
library, not interface strings, so they stay as stored in every language. A type
you rename keeps the label you typed.

## Related

- [How to change the plugin's settings](/user-guide/settings-howto)
- [How to edit a library's link types](/user-guide/link-types-howto)
- [What the plugin stores](/user-guide/plugin-data-reference)
