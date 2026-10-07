# How to change the plugin's settings

You will show or hide the plugin's own items in your library, and file a bug
report or feature request with the details prefilled. Link types have their own
page: [How to edit a library's link types](/user-guide/link-types-howto).

## Prerequisites

- The plugin is installed and enabled.
- For the feedback buttons, a GitHub account to submit the form.

All options are listed in [Settings: Zotero Timeline](/user-guide/settings-reference).

## Show the plugin's own items in your library

1. Open Zotero's Settings and choose the "Zotero Timeline" pane.
2. Clear "Hide Zotero Timeline's own items from my library".

"Zotero Timeline (plugin data)" appears in the library root, with the storage and
vocabulary notes as its children. No restart is needed. Tick the box again to hide
them.

Leave the box ticked unless you have a reason. The items hold your timelines;
deleting or editing them by hand can make a timeline unreadable. The trash is not
affected by the setting.

### Verification

Look at the root of the library list. The container is there with the box
cleared and gone with it ticked.

## Report a bug

1. Open Zotero's Settings and choose the "Zotero Timeline" pane.
2. Click "Report a bug…". Your browser opens a GitHub issue form.
3. Read every prefilled field, especially "Error output". It can contain absolute
   file paths that include your user name and home directory. Edit or delete
   anything you do not want to publish.
4. Fill in what happened and the steps to reproduce.
5. Submit the form on GitHub.

Nothing is sent until you submit there.

### Verification

The form shows your plugin version, Zotero version and operating system. "Error
output" is filled only if the plugin logged a recent error; otherwise it is empty
and that is normal.

### Troubleshooting

- **"Error output" begins with a note about dropped entries.** The log did not fit in
  the link. Use Help, Report Errors in Zotero for the full text.
- **Nothing opens.** The plugin could not launch your browser. The failure is
  written to Zotero's error log.

## Request a feature

1. Open Zotero's Settings and choose the "Zotero Timeline" pane.
2. Click "Request a feature…".
3. Fill in the form on GitHub and submit it.

This form has no prefilled fields and carries no log.
