import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ttf": "font/ttf",
};

export function createAppServer() {
  return http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const filename = path.resolve(
        publicRoot,
        `.${pathname === "/" ? "/index.html" : pathname}`,
      );
      if (!filename.startsWith(publicRoot)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const content = await readFile(filename);
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(filename)] || "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      const status = error instanceof URIError ? 400 : 404;
      response
        .writeHead(status)
        .end(status === 400 ? "Bad request" : "Not found");
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.on("error", (error) => {
    console.error(`Could not start the server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `Chicken Countdown is running at http://${host}:${server.address().port}`,
    ),
  );
}
