# Chicken Countdown

A local countdown instrument with an editable timer face, a quiet control dock, and a chicken-orchestra alarm. The interface follows the supplied countdown design kit and works offline.

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
- **Space** starts, pauses, or resumes, even when another app control has focus. **Escape** cancels the timer and alarm and clears both the original and remaining duration to zero.
- During the last ten seconds, a red glow pulses over the original digit color once per second. Pausing stops the pulse; reduced-motion preferences show a steady glow. At zero, the timer stays red, announces completion, and plays the selected sound once unless muted.

Keep the tab open and your device awake. The timer uses a deadline to account for background-tab delays; browser or operating-system suspension can postpone the alarm until the app wakes. Refreshing clears the countdown.

## Sound and theme

The sound menu defaults to **chicken orchestra**, using the bundled `public/sounds/screaming-chickens.mp3`. Choose **Choose file…** to select another audio file from your computer. Audio is decoded locally before the selection changes. Cancelling or choosing an unsupported file preserves the previous sound; choosing a valid file never starts an automatic preview. Sound changes during a run apply to its upcoming alarm. Browser playback failures leave completion visible and show a message in the dock.

The volume slider supports 0–100%, and mute is a separate control. Unmuting restores the last nonzero level. Muting silences any current alarm immediately. Theme, volume, and mute preferences are remembered when browser storage is available. Custom audio stays on your device and is never uploaded; select it again after refreshing. The app explains when an unavailable custom sound is replaced by chicken orchestra.

Dark and Light change the palette immediately without changing the timer or sound. The bottom dock stays compact and centered on wide screens and rearranges into rows on narrow screens. In full screen (F11), it fades after 2.5 seconds of inactivity, leaving a faint engraved-style keyboard hint. Moving the pointer or tabbing restores the controls. Hovering over the dock, focusing a control with the keyboard, or opening its sound menu keeps it visible.

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

The tests automatically use `/usr/bin/chromium` when available; set `CHROMIUM_PATH` for another installed Chromium executable. They cover masked input, Stop/Reset semantics, pointer and keyboard controls, actual MP3/custom-file playback, invalid-file handling, preferences, final-ten-second warnings, reduced motion, and responsive layouts. They block external requests. `SCREENSHOT_DIR=/tmp/countdown-screens npm run test:browser` also saves reference screenshots.

The app binds to `127.0.0.1` by default. `HOST` and `PORT` are optional. No credentials or external services are required. The self-hosted Barlow Condensed font is distributed under the SIL Open Font License; see `public/fonts/OFL.txt`.
