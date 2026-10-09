import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = path.resolve(process.argv[2] || path.join(root, "dist"));
// Windows checkouts can use CRLF; normalize before matching source markup/imports.
const read = async (name) => (await readFile(path.join(root, "public", name), "utf8"))
  .replace(/\r\n?/g, "\n");
const icon = await read("chicken.svg");
const licenses = await Promise.all([read("fonts/OFL.txt"), read("fonts/VT323-OFL.txt")]);
let css = await read("styles.css");
for (const filename of ["BarlowCondensed-ExtraBold.ttf", "VT323-Regular.ttf"]) {
  const font = await readFile(path.join(root, "public/fonts", filename));
  css = css.replace(`fonts/${filename}`, `data:font/ttf;base64,${font.toString("base64")}`);
}
const timer = (await read("timer.js")).replace(/^export /gm, "");
const agenda = (await read("agenda.js")).replace(/^export /gm, "");
const audio = (await read("audio.js"))
  .replace(/export const DEFAULT_SOUND_URL = new URL\([\s\S]*?\)\.href;/,
    'const DEFAULT_SOUND_URL = new URL("./screaming-chickens.mp3", document.baseURI).href;')
  .replace(/^export /gm, "");
const app = (await read("app.js")).replace(/^import .*;\n/gm, "");
const script = `(() => {\n${timer}\n${agenda}\n${audio}\n${app}\n})();`;
let html = await read("index.html");
html = html
  .replace('href="chicken.svg"', `href="data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}"`)
  .replace(/    <link\s+rel="preload"[\s\S]*?\/>\n/, "")
  .replace('    <link rel="stylesheet" href="styles.css" />', () => `<style>\n${css}\n</style>`)
  .replace('    <script type="module" src="app.js"></script>\n', "")
  .replace("  </body>", () => `<script>\n${script.replace(/<\/script/gi, "<\\/script")}\n</script>\n  </body>`)
  .replace("</html>", () => `</html>\n<!-- Embedded font licenses:\n${licenses.join("\n\n").replace(/--/g, "—")}\n-->\n`);
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, "chicken-countdown.html"), html);
await copyFile(path.join(root, "public/sounds/screaming-chickens.mp3"), path.join(destination, "screaming-chickens.mp3"));
console.log(`Exported HTML and MP3 to ${destination}`);
