# MRCHI Intel Lite

A lightweight EVE Online intel alert tool for Windows. It watches your EVE chat
logs in real time, tracks where your characters are, and alerts you when
hostiles are reported within jump range.

## Features

- **Live chat log watching** (UTF-16LE EVE logs, per-line BOMs handled)
- **Character presence** — detects your characters from log headers, tracks their
  current system from Local, online/offline by activity (20min startup gate,
  30min offline timeout)
- **Intel parsing** — pilots, ships, systems and hostile counts extracted from
  free-form intel channel reports (including `+N` counts and `clr` handling)
- **Jump distance alerts** — RED within your proximity range, SOFT via a
  configurable watch list (pilot/ship/extra-range bands)
- **One-line alert cards + Windows notifications + configurable-volume sounds**
- **Settings persistence** (proximity, channels, watch list, volume, window state)

## Install (users)

Run `MRCHI Intel Lite Setup.exe` from Releases. The app reads logs from
`Documents\EVE\logs\Chatlogs` automatically (or a folder you choose).

## Development

```bash
npm install
npm start            # run
npm run start:debug  # run with debug logging on at startup
npm run build:win    # produce dist\MRCHI Intel Lite Setup.exe