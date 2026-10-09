# Chicken Countdown

A local countdown instrument with an editable timer face, an optional meeting agenda, cassette-style controls, and a chicken-orchestra alarm. The interface follows the supplied countdown design kit and agenda handoff and works offline.

## Portable two-file version

Run `npm run build` to generate the portable version in `dist/`. Generated files are excluded from Git. Open `dist/chicken-countdown.html` directly in your browser by double-clicking it. Keep `screaming-chickens.mp3` in the same folder. Distribute those two files together; recipients need no Node.js, installation, terminal commands, server, or internet connection. The HTML embeds the styling, JavaScript, icon, font, and font license. Start the timer with a click or Space to enable audio playback.

To regenerate the portable version after editing the source, the developer runs `npm run build`. Only this export step requires Node.js. You can also run `node scripts/export.mjs /path/to/output` to choose the export folder. Both files can be uploaded together to a static web host.

## Run the development server

Install Node.js 20 or newer, then run this from the project folder:

```sh
npm start
```

Open the address printed by the server (`http://127.0.0.1:3000` by default). There are no runtime package dependencies or build steps. Stop the server with Ctrl+C. Set `PORT` to use another port; for example, `PORT=3001 npm start` on macOS/Linux.

## Set and control the timer

The first-use display is **00:00**, with Dark selected and volume at 60%. Click the large digits and type minutes and seconds. Typing `2500` or pasting `25:00` produces **25:00**. The colon stays fixed. Backspace/Delete clear digit positions; select all to replace the entire duration. Enter commits without starting. Blur, Start, or Space also commit valid edits. Incomplete values and seconds above 59 are rejected. The range is **00:00–99:59**; a zero duration cannot start.

- **Start / Resume** counts down from the displayed time. **Pause** freezes it precisely.
- **Stop** keeps the remainder editable and preserves the original duration. **Reset** restores that original duration. Focusing an unchanged stopped remainder does not overwrite the original.
- Click running digits to pause; click paused digits to resume. Double-click running digits to stop and restore the original duration.
- **Space** starts, pauses, or resumes outside the agenda text field, even when another app control has focus. **Escape** cancels the timer and alarm and clears both the original and remaining duration to zero.
- During the last ten seconds, a red glow pulses over the original digit color once per second. Pausing stops the pulse; reduced-motion preferences show a steady glow. At zero, the timer stays red, announces completion, and plays the selected sound once unless muted.

Keep the tab open and your device awake. The timer uses a deadline to account for background-tab delays; browser or operating-system suspension can postpone the alarm until the app wakes. Refreshing stops the countdown and restores the selected agenda item's adjusted duration if an agenda has been saved.

## Meeting agenda

Select **Agenda**, then **Stop** to unlock its display. Enter or paste one duration and title per line:

```text
05:00 Welcome
10:00 Discussion
08:00 Decisions
02:00 Wrap-up
```

Each duration must be exactly `MM:SS`, from `00:01` to `99:59`, followed by a space or tab and a title. Blank lines are ignored; titles retain accents, case, punctuation, internal spacing, and duplicates. Valid edits save on blur, hiding the panel, or Start. The first item loads automatically; later edits keep or clamp the selected item and load its full planned duration. An unchanged blur preserves the timer's remainder. The total is read-only and can exceed `99:59`.

**Start / Resume** locks the agenda. **Pause** and natural expiration keep it locked. **Stop** keeps the timer remainder, unlocks editing, and focuses the visible agenda. Reset and running-display double-click restore the timer baseline, discard pending agenda edits, and lock editing. Escape clears the timer and baseline, discards pending edits, and retains the saved agenda. Showing/hiding preserves timer state, contents, and the editing latch.

Malformed drafts remain visible with line-specific errors and retain the last valid agenda. Even a hidden invalid draft blocks Start and reopens the display. Fix it after Stop, or discard it with Reset/Escape. Editing to empty text clears the list.

With an agenda selected, reaching zero plays the alarm once and enters **OVERTIME**. The red digits count elapsed overtime upward until you finish the slot. Pause and Stop freeze that measurement; Resume continues it. Paused or stopped time does not count toward the slot. Without an agenda, the timer still stops at zero.

**Next** finishes a started slot, silences the alarm, adjusts the schedule, and loads the next item's adjusted duration. Press Start to begin it. If the presenter finishes early, all unused time goes to the next slot. Overtime is taken from upcoming breaks first, then a final **Open discussion** slot. If those buffers are absent or exhausted, the remaining overtime is divided equally among following slots. `Open discussion` is recognized without regard to case only in the last slot.

Break keywords match whole words anywhere in the title, without regard to case or accents. For example, `Team lunch together`, `Teraz prestávka`, and `Tempo per CAFFÈ` all identify breaks. Original titles retain their spelling. Accent folding accepts `káva`/`kava`, `prestávka`/`prestavka`, `caffè`/`caffe`, and `śniadanie`/`sniadanie`; `ĺ`, `ľ`, and `ł` also normalize to `l`. A keyword embedded in an unrelated word, such as `breakthrough`, does not match.

| Language | Break keywords |
| --- | --- |
| English | lunch, break, coffee, lunchbreak, coffeebreak |
| Slovak | prestávka, pauza, cikpauza, obed, káva |
| German | Pause, Kaffee, Kaffeepause, Mittag, Mittagessen, Mittagspause, Raucherpause, Pinkelpause, Toilettenpause, Frühstück (also Fruehstueck) |
| Italian | pausa, pranzo, caffè, intervallo |
| Spanish | pausa, descanso, almuerzo, comida, café, recreo |
| Polish | przerwa, pauza, obiad, kawa, śniadanie |

Adjusted durations stop at zero. If a slot cannot absorb its equal share, the excess is shared among slots that still have time. If all following time is exhausted, the total shows the unavoidable meeting extension. Zero-duration slots can be passed with Next. On the last slot, Next is labelled **Finish** and records the slot's actual duration. There is no automatic advance.

**Previous** loads the preceding item's adjusted duration without completing the current run. Browsing slots that have not started transfers no time. Next and Previous work while running, in overtime, paused, or stopped. **Reset** discards the active run's measured time and restores its timer baseline; it preserves adjustments already applied to other slots. **Eject** is disabled while counting down or measuring overtime; it clears the agenda and timer while keeping the panel visible and locked.

The locked agenda displays adjusted durations, including the actual durations of finished slots. Stop exposes the original plan for editing. Committing a changed plan clears previous timing adjustments; an unchanged blur retains them. Saved adjustments and the selected slot survive refresh, while an unfinished run's elapsed time does not. Automatic gains may extend a slot beyond the manual input limit of `99:59`.

The display is a native textarea with selection, copy/paste, and undo. **Space** types a normal space while this field has focus; use **Enter** to add a line. The timer's Space shortcut applies outside this field. **Escape** still clears the timer and discards pending agenda edits while preserving saved entries. Moving the caret does not change the selected meeting item. Long titles wrap beneath their title column and long lists scroll inside the black glass. The saved agenda and selected item persist with preferences; drafts, visibility, and the editing latch do not persist.

## Sound and theme

The sound menu defaults to **chicken orchestra**, using the bundled `public/sounds/screaming-chickens.mp3`. Choose **Choose file…** to select another audio file from your computer. Audio is decoded locally before the selection changes. Cancelling or choosing an unsupported file preserves the previous sound; choosing a valid file never starts an automatic preview. Sound changes during a run apply to its upcoming alarm. Browser playback failures leave completion visible and show a message in the dock.

The volume slider supports 0–100%, and mute is a separate control. Unmuting restores the last nonzero level. Muting silences any current alarm immediately. Theme, volume, and mute preferences are remembered when browser storage is available. Custom audio stays on your device and is never uploaded; select it again after refreshing. An unavailable custom sound silently falls back to chicken orchestra in the dropdown.

Dark and Light change the palette immediately without changing the timer or sound. The bottom dock stays compact and centered on wide screens and rearranges into rows on narrow screens. In full screen (F11), it fades after 2.5 seconds of inactivity, leaving only a centered, faint engraved-style keyboard hint. Moving the pointer, tabbing, or using a focused control restores the toolbar. A parked pointer, existing focus, or audio message does not prevent fading. An open sound menu or active slider drag keeps the controls visible until that interaction ends.

## Development and checks

Edit `public/` and refresh the browser. The timer and HTTP tests need only Node:

```sh
npm test
```

For browser checks:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

The tests automatically use `/usr/bin/chromium` when available; set `CHROMIUM_PATH` for another installed Chromium executable. They cover masked input, Stop/Reset semantics, pointer and keyboard controls, actual MP3/custom-file playback, invalid-file handling, preferences, final-ten-second warnings, reduced motion, responsive layouts, strict agenda parsing, draft validation, navigation, overtime pause/resume, early completion, break/discussion deductions, equal sharing, exhausted schedules, Unicode editing, and adjusted agenda persistence. They block external requests. `SCREENSHOT_DIR=/tmp/countdown-screens npm run test:browser` also saves reference screenshots.

The app binds to `127.0.0.1` by default. `HOST` and `PORT` are optional. No credentials or external services are required. The self-hosted Barlow Condensed and VT323 fonts are distributed under the SIL Open Font License; see `public/fonts/OFL.txt` and `public/fonts/VT323-OFL.txt`.
