# MRCHI Intel Lite — v1.1.6

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
- **Intel Map**: a pyramid of every system in range that lights up when intel
  lands in it; hover any system for the full report. Costs nothing when off.
- **Separate volumes and your own custom sounds** for red and soft alerts.
- **Remembers your last 50 alerts** across restarts, with a Clear button.
- **Bigger text mode** for tired eyes.
- **No spam**: the same report from three people is one ping, not three.
- **Reads intel like a human** — shorthand, nicknames and typos included.

## Changelog

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