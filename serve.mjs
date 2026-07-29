// Small file server for testing at localhost:3000
// Streams files and supports ranges, so the music can skip ahead without loading it all

import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRoomServer } from "./roomServer.mjs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    // Runs the Vercel functions locally so stats and wallets work the same
    const API = { "/api/track": "./api/track.mjs", "/api/stats": "./api/stats.mjs", "/api/wallet": "./api/wallet.mjs", "/api/clienterror": "./api/clienterror.mjs" };
    if (API[pathname]) {
      const mod = await import(API[pathname]);
      const shim = {
        setHeader: (k, v) => res.setHeader(k, v),
        status(code) {
          res.statusCode = code;
          return shim;
        },
        json(obj) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(obj));
          return shim;
        },
        end: () => res.end(),
      };
      await mod.default(req, shim);
      return;
    }

    // Stop paths from reaching outside the project folder
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not Found");
      return;
    }

    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    const total = info.size;
    const range = req.headers.range;

    if (range) {
      // Like "bytes=1000-" or "bytes=1000-2000"
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` }).end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Cache-Control": "no-store",
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": total,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("500 Server Error");
    console.error(err);
  }
});

// Websockets share this server, and Node's timeouts can drop them in the middle of a match
// Turned off here, they only guard against slow clients which don't matter locally
server.headersTimeout = 0;
server.requestTimeout = 0;

attachRoomServer(server, { path: "/api/ws" }); // Same path the live server uses

server.listen(PORT, () => {
  console.log(`7Bust dev server running at http://localhost:${PORT}`);
});
