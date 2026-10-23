# Local Monitor templates

Drop detection art in this folder. The engine reads it on **Start** (and on
**Preview**) and needs at least one file before the monitor will run.

The detector runs in a Python subprocess. Install Python 3.9+ and its packages
once with `python -m pip install -r resources/local-monitor/python/requirements.txt`.
The Local Monitor reports a startup error when Python or one of these packages
is missing.

## Naming

| File name pattern   | Matched against                                   |
| ------------------- | ------------------------------------------------- |
| `image_*`           | both Local windows — hostiles / neutrals (red alert) |

There is only one kind of template. The monitor watches two screen regions,
`Local 1` and `Local 2` — typically one per logged-in character — and **both
regions are matched against the same art**, because an icon belongs to the
game, not to a window. Any hit raises the same red alert; the area label tells
you which Local fired it. There is no separate faction or soft-alert template
set: the soft sound is for proximity and watch-list alerts, not for Local.

The five icons this setup is built around:

| File                                | Catches                    |
| ----------------------------------- | -------------------------- |
| `image_neutral-grey_<scale>.png`    | neutral grey `=`           |
| `image_neutral-orange_<scale>.png`  | neutral orange             |
| `image_hostile-orange_<scale>.png`  | hostile orange             |
| `image_hostile-red_<scale>.png`     | hostile red                |
| `image_war-target_<scale>.png`      | war target                 |

Any number of templates may be present; the engine takes all of
them and reports the count in the status line. It never waits for a particular
number, and it refuses to start only when an enabled area has no template at all.
So four of the five is a perfectly good state while you are still collecting.

Extensions `.png`, `.jpg`, `.jpeg` and `.bmp` are read; PNG is recommended. Files
that match neither prefix are ignored and logged.

## The `_NNN` suffix, and why one file covers every UI scale

EVE's interface scale is a fixed, discrete list. A template is pixels, so art cut
at one scale does not match a client running at another. Rather than storing a
copy per scale, **one master image per icon is expanded to the whole list in
memory at load time**:

```
UI_SCALES = 90, 100, 110, 125, 150, 175, 200
```

The suffix declares the scale the master was captured at, so `image_hostile-red_150.png`
is a 150% capture and gets resampled to every scale above. The master itself is
used verbatim, so a capture already at one of the listed scales costs nothing.
Without a suffix the file is assumed to be 100% and a warning is logged, because
every derived size depends on that number.

This is why you should **capture at the largest UI scale you can**, then let the
engine downsample. Shrinking uses an area filter, so real detail folds into the
average and survives at 90%; growing can only invent detail, so a 90% capture
blown up to 200% is a guess. Five masters at 200% beats five masters at 90%.

## Producing the art

The fastest way to get pixel-exact art is to let the app capture it for you: the
**Set area** button writes a snapshot of the region to
`resources/local-monitor/snapshots/area<N>-<scale>pct.png` right after you drag
the box, and **Snapshot** re-takes it on demand. Both use the exact capture path
the matcher uses, so art cut from that PNG lines up with the live region.

> The `<scale>` in that file name is the **display** scale (Windows), not the EVE
> interface scale. They are unrelated numbers and it is easy to confuse them.

Then slice the candidate icons out so they can be identified by name:

```
node tools/slice-icons.js resources/local-monitor/snapshots/area1-125pct.png --band 4:28 --zoom 8
```

It writes one `tile-NNN.png` per candidate into a `tiles/` folder, each smooth-scaled
so a 9px icon is legible, plus a `manifest.json` giving the exact source rectangle
of every tile. Point a vision model at the folder, ask which file is the icon you
want, and cut that tile's `rect` out of the snapshot. `--band` selects the column
range (default: auto-detected at the left edge); `--rows` also writes a
`contact-sheet.png` grid, which some models read better than separate files.

To crop:

1. Put the EVE client at the largest interface scale the Local window will fit at.
2. Snap a region covering a few rows of the icon column. It does **not** need to be
   the whole window — a narrow region around the icon column is both faster to match
   and guaranteed to fit on screen at a high scale.
3. Slice, identify, then crop the sprite as tightly as you can. Every extra pixel of
   background is correlation the match has to fight.
4. Save as `image_<name>_<scale>.png`, where `<scale>` is the interface scale you
   captured at.

## How matching works

Each template is min-max normalised and slid across the captured region using
OpenCV's `TM_CCOEFF_NORMED` (a contrast-invariant correlation), so overall
brightness differences between the template and the live region are tolerated
but the internal pattern must match. Positions scoring at or above the threshold
slider (default 60 → 0.60) are merged the way `cv.groupRectangles` does, so one
contact reports one detection, not one per pixel of its edge.

A half-resolution pass runs first and only its hits are re-scored at full
resolution, which is what keeps a 250ms poll affordable even with every scale
variant loaded. Keep the region narrow anyway — the coarse pass is proportional
to region area times template count.

If detections are noisy, raise the threshold slider. If you get nothing, lower it
and check the art and the interface scale first; **Preview** shows live match
boxes and the score of the best hit, which is the fastest way to see whether the
right scale variant is firing.

## Licensing

The images that ship with [EVE-Alert](https://github.com/Geuthur/EVE-Alert) are
GPL-3.0, and this app is not, so they are deliberately **not** bundled here. Cut
your own from your own client, or use an asset you have the rights to.
