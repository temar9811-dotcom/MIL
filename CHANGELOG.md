# Changelog

## 1.2.9

### Features

- **Non-alert log** — every chat line the app reads but cannot turn into an alert is now written to `non-alerts.log`, so the lines that slip through are easy to find. A line understood but simply out of range is left out; everything else that produced no alert is recorded. The log starts fresh on every launch.
- **Export logs** — a new **Export Logs** button on the Debug tab copies the non-alert log and the unverified-pilot log into a timestamped folder in your Documents, ready to share.

## 1.2.8

### Features

- **The Intel Map opens as a 2D map** — the pop-out and its tab now start on the 2D star map instead of the pyramid. Switch back to the pyramid any time with the view toggle.
- **See-through alerts pop-out** — the alerts window can now float over the game with only its text showing, so nothing is hidden behind a solid panel. A new **Transparent** checkbox in the pop-out, beside **Always on top**, switches it on or off, and your choice is remembered.

### Fixes

- **The pyramid looks like a pyramid again** — each row is now drawn at its true share of the widest row, so the shape tapers from a single system at the top to the full range at the bottom. Rows had been floored at their own width, which flattened the whole thing into a near-rectangle.
- **"Always on top" in the alerts pop-out actually works** — the checked state was never passed through to the window, so re-enabling it after unchecking did nothing.
- **Alert cards read correctly on a see-through window** — the red and soft fills were never being applied, so the text sat on whatever was behind it. Alerts are now coloured by type: red text for red alerts, amber for soft ones.

## 1.2.7

### Features

- **"What's New" popup** — after the app updates to a new version, a window shows what changed. It appears once per version and never again for the same one.
- **Install updates automatically** — a new setting in Other Settings. On (the default) shows the update dialog and installs the moment the download finishes. Off keeps the hourly check but leaves an **Update Now** button in the header so you install when you choose.

### Fixes

- **Saving Alert Settings no longer rolls your other choices back** — that form wrote only its own fields, so saving it reset the theme, the module switches and every local-monitor setting to their defaults.
- **Updater installed while the log watcher was still running** — the engine and tray are now stopped before the installer takes over, instead of racing the app's shutdown.

### Under the hood

- The installer is now named `MRCHI.Intel.Lite.Setup.<version>.exe`, with dots instead of spaces.
- Removed a second, unused electron-builder config that had been silently ignored for every build.

## 1.2.6

### Fixes

- **Settings persist across restarts** — the app kept two settings files and read one while writing the other, so a restart could roll enabled modules, theme, tray behaviour and alert options back to defaults. There is now a single settings file; an older install's second file is imported once, then ignored.
- **Chat logs folder setting is consumed** — it was saved but never read, so the app kept auto-detecting EVE's log folder instead of the one you picked. A folder you browse to is now used at startup and right after saving.

## 1.2.5

### Fixes

- **Intel Map background and overlay no longer drift apart** — dragging the 2D map used to slide the intel markers off the star-map background and leave the map out of position.

## 1.2.4

### Fixes

- **Pilot names with numbers are no longer cut short** — several distinct causes truncated a name the moment it contained a digit.
- **Stray fragments are dropped** — all-numeric and punctuation-only fragments no longer become pilot names.
- **Multiple pilots in one report split correctly** — reports listing several pilots are no longer merged into one.

### Features

- **d-scan and adashboard links raise an alert** — a bare link with no system text now produces its own alert.
- **Clickable zkillboard links** — reported pilots link to their killboard once their character is resolved.
- **Time tags on alert cards** — cards show the local time a report came in.
- **Unverified names are logged** — a name that fails verification is written to a log so bad reports are easy to find.

## 1.1.6

### Refactor

- **Codebase split into smaller modules** — the largest files were divided into log reading, Intel Map feed and map drawing modules. No visible change.

## 1.1.5

### Fixes

- **Locked log files no longer raise an error** — if EVE holds a log file open, the app waits and retries.

### Features

- **Opt-in "Intensive" map refresh** — refreshes the Intel Map every second for near-live tracking.

## 1.1.4

### Features

- **Re-centre the map on any character** — a dropdown at the top of the Intel Map re-centres the pyramid on any online character without touching alert settings.
- **Immediate intel on open** — the map shows the last few minutes of intel instead of waiting for fresh reports.

## 1.1.3

### Features

- **Merged range labels** — range lines landing on the same row merge into one label.
- **Clear the map** — a Clear button wipes the Intel Map's intel.
- **Cursor-following hover popups** — popups float at your cursor, and the top tile shows your character's name on hover.

## 1.1.2

### Features

- **Crew tracking on the map** — online alts glow green on the pyramid.
- **Beyond-20-jumps box** — characters more than 20 jumps away are grouped separately, and the map never grows past 20 jumps.

## 1.1.1

### Features

- **Primary character** — pick which character is "you" when several are online. They win distance ties on alerts and sit at the top of the Intel Map. Auto behaves exactly as before.

## 1.1.0

### Features

- **Intel Map** — a pyramid of every system in range that lights up with live intel, hover any system for the full report, on-top toggle, auto-sizing window, configurable intel timeout, and zero load when switched off.

## 1.0.5

### Features

- **Scales to thousands of log files** — heavy log folders no longer slow the app down.
- **Duplicate-report filtering** — the same report arriving for several of your characters alerts once.
- **System shorthand** — `78`, `C-J`, `4nd`, `UALX` and friends are recognised.
- **Kill-report handling** — kill reports posted in intel are handled.

### Fixes

- **Slimmer installer** — the installer package is smaller.

## 1.0.4

### Features

- **Intel brain** — understands channel shorthand and typos.
- **Activity pings** — ESS, bubbles, drag, ansiblex and camping are detected.
- **Group pings** — cynos, capitals and dictors, each with its own range.
- **Watch list colour pickers** — colour each watched character.
- **Coloured alert cards** — cards are coloured by alert type.
- **"5 jumps" phrasing** — alerts read "5 jumps" instead of "5".

### Fixes

- **Double-ping protection** — a repeat ping within 10 seconds is suppressed, and red alerts always win inside your range.

## 1.0.3

### Features

- **Separate red/soft alert volumes** — independent volume control per alert type.
- **Custom .wav sounds** — pick a sound per alert type.
- **Bigger text mode** — a larger-text toggle for the alert feed.
- **Settings reorganised** — settings are grouped into clear sections.

## 1.0.2

### Features

- **Presence detection** — online characters are detected from EVE client window titles, with a toggle to fall back to chat logs.
- **Roster cleans up** — offline characters are forgotten automatically.
- **Debug log panel** — a buffered debug history.

## 1.0.1

### Features

- **Alert history survives restarts** — with a Clear button.
- **Pop-out alerts window** — always-on-top, and closing the main window closes it.
- **Window position remembered** — with a tidied menu bar.

## 1.0.0

### Features

- **First release** — watches EVE chat logs and alerts when hostiles are reported near your characters, with sound and notifications, a character roster and basic settings.
