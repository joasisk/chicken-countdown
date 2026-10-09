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

Keep the tab open and your device awake. The timer uses a deadline to account for background-tab delays; browser or operating-system suspension can postpone the alarm until the app wakes. Refreshing stops the countdown and restores the selected agenda item's planned duration if an agenda has been saved.

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

**Previous / Eject / Next** are available only after the countdown naturally expires. Previous/Next select one adjacent item, silence the alarm, load its planned duration, and immediately disable all three keys until another expiration. Press Start to begin that item. Eject clears the agenda and timer while keeping the panel visible and locked. There is no automatic advance.

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

The tests automatically use `/usr/bin/chromium` when available; set `CHROMIUM_PATH` for another installed Chromium executable. They cover masked input, Stop/Reset semantics, pointer and keyboard controls, actual MP3/custom-file playback, invalid-file handling, preferences, final-ten-second warnings, reduced motion, responsive layouts, strict agenda parsing, draft validation, expiry-only transport, Unicode editing, and agenda persistence. They block external requests. `SCREENSHOT_DIR=/tmp/countdown-screens npm run test:browser` also saves reference screenshots.

The app binds to `127.0.0.1` by default. `HOST` and `PORT` are optional. No credentials or external services are required. The self-hosted Barlow Condensed and VT323 fonts are distributed under the SIL Open Font License; see `public/fonts/OFL.txt` and `public/fonts/VT323-OFL.txt`.
