# Chicken Countdown

A simple web app that runs on your computer. Set a duration, start the countdown, and let the chicken announce the finish.

## Run locally

Install [Node.js](https://nodejs.org/) 20 or newer, then run these commands in this folder:

```sh
npm start
```

Open `http://127.0.0.1:3000` in your browser. No dependency installation is needed to run the app. Stop the server with Ctrl+C. Use `PORT=3001 npm start` on macOS/Linux to choose another port, or set `PORT` in your shell on Windows.

## Use it

- Pick 1, 5, 15, or 25 minutes, or enter hours, minutes, and seconds and click **Apply custom time**.
- Click **Test sound** before your first countdown and check your device volume.
- Start, pause, resume, or reset the countdown. The expand button shows the timer in fullscreen.
- At zero, the app displays **Time’s up!** and plays the alarm. Click **Stop sound** to silence it.

The default **Chicken alarm** plays the bundled `public/sounds/screaming-chickens.mp3` from the beginning when time is up. It works offline with no external services. Browser autoplay rules can block playback, so click **Test sound** before starting. An unlocked backup bell rings if the selected audio cannot play.

To use another sound, select **Custom sound** and click **Choose an audio file**. MP3, WAV, OGG, and other browser-supported audio files work. Click **Test sound** to check it, then start the countdown. The file stays on your device and is never uploaded. Select **Chicken alarm** to switch back to the built-in sound; the custom file stays selected until you refresh. Refreshing restores the chicken alarm, and you must select a custom file again. The app uses no external fonts or UI libraries and works offline once the local server is running.

Keep the tab open and the device awake. Pausing preserves the remaining time; background-tab delays are accounted for using a deadline rather than counting interval ticks. Browser or operating-system suspension may delay the alarm until the tab wakes up. Reloading the page resets the countdown.

## Development and checks

There is no build step. Edit files in `public/` and refresh the browser.

```sh
npm test
```

Timer and HTTP-server tests use Node's built-in test runner. Browser checks require the development dependency and Chromium:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

If Chromium is already installed, set `CHROMIUM_PATH` to its executable instead of downloading a browser. The tests automatically use `/usr/bin/chromium` when available. They exercise actual playback of the bundled MP3 and custom audio files, sound switching, pause/resume, completion, validation, backup bell behavior, and responsive layout. External requests are blocked during these checks to verify offline operation.

The server binds to `127.0.0.1` by default. `HOST` and `PORT` are optional runtime settings. No API keys or other credentials are needed.
