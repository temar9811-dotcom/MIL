# MRCHI Intel Lite — v1.3.0

...

## What is it?

MRCHI Intel Lite is a companion app for EVE Online that reads your intel
channels the way a fleet-mate would, and warns you the moment something
hostile shows up near your characters. Instead of you squinting at hundreds
of chat lines while you're flying, the app reads them for you, works out how
far away the threat is, and pings you with a sound, a popup and a coloured
alert — so you can keep doing what you're doing and still know what's
happening around you.

## Under the hood

Windows desktop app built on Electron. A file watcher tails your EVE chat
and game logs in real time (both text encodings handled), a parser pulls
pilots, ships, systems and gang sizes out of free-text intel reports, and a
jump-map of every system in the game does the distance maths. A rules engine
decides what's worth pinging you about, with cooldowns so you're never
spammed. Online characters are detected from your running EVE client windows
(or from chat logs, your choice). The Intel Map renders a live pyramid of
every system in range using a breadth-first search over the jump map.
Settings are stored as versioned JSON that upgrades itself when new options
arrive. Packaged as a standard Windows installer.

## Features

- **Watches your intel channels for you**, so you don't have to.
- **Knows how far away a threat is** from your nearest character, in jumps.
- **Red alerts** when hostiles are inside your danger range — always, no
  exceptions, whatever your other settings say.
- **Soft warnings** for things further out that you still want to know about.
- **Watch list**: ping me when this pilot or this ship type shows up — with
  your own colour per entry.
- **Group pings**: one checkbox to warn about cyno-capable ships, capitals or
  dictors within a range you choose.
- **Activity pings** for bubbles, drags, ESS fights, ansiblex camps and
  gatecamps.
- **Knows who's online** by looking at your EVE client windows (chat logs if
  you prefer), and forgets people when they log off.
- **Character list** showing who's online and which system they're in.
- **Pop-out alerts window** you can drag to a second monitor and keep on top.
- **See-through pop-out (optional)**: tick **Transparent** beside **Always on
  top** to float the alerts window over the game with only the text showing.
  Off by default — the window opens solid.
- **Intel Map**: a pyramid of every system in range that lights up when intel
  lands in it; hover any system for the full report. Costs nothing when off.
  Opens as a 2D star map by default, with a one-click switch to the pyramid.
- **Local Monitor (Experimental)**: opt-in screen monitoring for hostile
  activity in your selected EVE client areas. Enable it in Other Settings.
  Requires Python 3.9+ and the packages listed in
  `resources/local-monitor/python/requirements.txt`.
- **Separate volumes and your own custom sounds** for red and soft alerts.
- **Remembers your last 50 alerts** across restarts, with a Clear button.
- **Bigger text mode** for tired eyes.
- **No spam**: the same report from three people is one ping, not three.
- **Reads intel like a human** — shorthand, nicknames and typos included.
- **Filters chatter from pilot reports** — name grammar, a bundled word list,
  and character existence/activity checks help keep ordinary conversation out
  of alerts. If a lookup service is unavailable, reports still pass through.
- **Clickable link alerts** — d-scan and adashboard links posted in intel raise
  their own alert, and a reported pilot links straight to their zkillboard page
  once their character is resolved.
- **Time-stamped alerts** — every card shows the local time the report came in.
- **Non-alert log** — any intel line the app reads but can't turn into an alert
  is written to a log, so nothing slips through unnoticed. The Debug tab's
  **Export Logs** button copies it and the unverified-pilot log to your
  Documents.

## On hold

**Fuzzy ship-name matching** — resolving hull misspellings that aren't in the
built-in shorthand — was explored but is on hold for now. It needs to clear a
measured accuracy bar before it ships, so the app keeps its existing shorthand
and alias handling unchanged.

## Development

Run the parser and fixture tests with `npm test` (Node's built-in test runner).

## Changelog

### 1.3.0
Pilot reports now pass through name and character checks before alerting. The
engine batches lookups, keeps processing responsive during network delays, and
records gated or expired lines with a reason. Cached character activity also
filters dormant pilots from the Intel Map backfill. The opt-in Local Monitor is
available in packaged builds and is labelled **Experimental** in Other Settings.

### 1.2.9
A non-alert log and a way to share it. Every chat line the app reads but cannot
turn into an alert is now written to `non-alerts.log` — a report understood but
simply out of range is left out, everything else that produced no alert is kept.
The log starts fresh on each launch. The Debug tab gained an **Export Logs**
button that copies it and the unverified-pilot log into a timestamped folder in
your Documents.

The alerts pop-out is tidier too: it now opens **solid** rather than see-through
(the **Transparent** checkbox is still there if you want the floating look), is
half as tall at 320px, and its title and checkboxes no longer sit inside the
window's edge.

Fuzzy ship-name matching was explored for this release but is **on hold** — it
needs to clear a measured accuracy bar before it ships, so the existing
shorthand and alias handling is unchanged.

### 1.2.8
Map view and see-through alerts. The Intel Map now opens as a 2D star map
instead of the pyramid, switchable any time with the view toggle. The alerts
pop-out gained a "Transparent" checkbox beside "Always on top" so it can float
over the game with only its text showing, and the choice is remembered.

Three fixes came with it. The pyramid tapers properly again — rows had been
floored at their own width, flattening the shape into a near-rectangle. The
"Always on top" checkbox in the pop-out now actually works, having never passed
its state through to the window. And alert cards are coloured by type (red text
for red alerts, amber for soft) so they read correctly on the see-through
window, where their fills were never being applied.

### 1.2.7
A "What's New" window now appears once after each update, so you can see what
changed without hunting for it. Other Settings gained an "Install updates
automatically" toggle: leave it on and updates install the moment they finish
downloading, or switch it off to keep the hourly check and install from an
"Update Now" button in the header when you choose.

Two fixes came with it. Saving the Alert Settings tab used to write only its own
fields, which quietly reset your theme, module switches and local-monitor
settings to their defaults; it now saves alongside the rest. And the app stops
its log watcher and tray cleanly before an installer takes over, instead of
racing its own shutdown.

### 1.0.0
First release. Watches EVE chat logs, alerts when hostiles are reported near
your characters with sound and notification, character roster, basic
settings.

### 1.0.1
Alert quality pass. Alert history survives restarts, Clear button, pop-out
alerts window with always-on-top, closing the main window closes the pop-out,
tidied menu bar, window position remembered.

### 1.0.2
Presence pass. Detects online characters from EVE client window titles with a
toggle to fall back to chat logs, roster forgets offline characters, debug
log panel with buffered history.

### 1.0.3
Sound and comfort. Separate red/soft alert volumes, custom .wav sounds per
alert type, bigger text mode, settings reorganised into clear sections.

### 1.0.4
Intel brain. Understands channel shorthand and typos, activity pings (ESS,
bubbles, drag, ansiblex, camping), group pings (cynos, capitals, dictors)
with per-group ranges, watch list colour pickers, coloured alert cards,
10-second double-ping protection, red alerts always win inside your range,
alerts read "5 jumps" instead of "5".

### 1.0.5
Scale and ship pass. Handles thousands of log files without slowing down,
slimmer installer, duplicate-report filtering across your characters, system
shorthand (78, C-J, 4nd, UALX and friends), kill-report handling.

### 1.1.0
Intel Map. A pyramid of every system in range that lights up with live intel,
hover any system for the full report, on-top toggle, auto-sizing window,
configurable intel timeout, and zero load when switched off.

### 1.1.1
Primary character. Pick which character is "you" when several are online:
they win distance ties on alerts and sit at the top of the Intel Map.
Leave it on Auto and everything behaves exactly as before.

### 1.1.2
Intel Map crew tracking. Online alts glow green on the pyramid, characters
more than 20 jumps away appear in a "beyond 20 jumps" box, and the map never
grows past 20 jumps no matter what your ranges say.

### 1.1.3
Intel Map polish. Range lines that land on the same row merge into one
label, a Clear button wipes the map's intel, hover popups now float at your
cursor, and the top tile shows your character's name on hover.

### 1.1.4
Intel Map focus and memory. A dropdown at the top of the map re-centres the
pyramid on any online character without touching your alert settings, and
opening the map now shows the last few minutes of intel immediately instead
of waiting for fresh reports.

### 1.1.5
Steadiness and speed. If EVE has a log file locked, the app waits and retries
instead of throwing an error, and an opt-in "Intensive" toggle refreshes the
map every second for near-live tracking.

### 1.1.6
Spring clean under the hood. The biggest code files were split into smaller
modules (log reading, Intel Map feed, map drawing). No visible change — just
easier to keep sharp.

### 1.2.4
Intel accuracy and links. Pilot names that contain numbers are no longer cut
short, stray all-numeric or punctuation-only fragments are dropped, and
several pilots listed in one report are split apart correctly instead of being
merged into one.
d-scan and adashboard links posted in intel now raise an alert on their own,
reported pilots get a clickable zkillboard link once their character is
resolved, alert cards show the local time a report came in, and any name that
fails verification is written to a log so bad reports are easy to find.

### 1.2.6
Settings now persist. The app kept two settings files and read one while writing
the other, so a restart could roll your choices (enabled modules, theme, tray
behaviour, alert options) back to defaults. There is now a single settings file;
an older install's second file is imported once, then ignored.

The "Chat logs folder" setting now takes effect. It was saved but never read, so
the app kept auto-detecting EVE's log folder instead of watching the one you
picked. A folder you browse to is now used at startup and right after saving.

### 1.2.5
Intel Map fix. Dragging the 2D map now keeps the star-map background and the
lit intel layer moving together. Before, grabbing the map slid the intel
markers off the background and left the map out of position.
