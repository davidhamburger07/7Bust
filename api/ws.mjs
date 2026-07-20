// The online room server on Vercel, the game rejoins its seat when Vercel cuts the connection
// Rooms live in Redis since players land on different servers
import http from "node:http";
import { attachRoomServer } from "../roomServer.mjs";

const server = http.createServer();
const info = attachRoomServer(server, { path: null }); // Only /api/ws traffic gets here

// A plain GET says which room store this runs on, and the names of any Redis settings
// Only the names are shown, never the values
server.on("request", (req, res) => {
  const envNames = Object.keys(process.env).filter((k) => /REDIS|^KV_|UPSTASH|^ROOM_NS$/i.test(k));
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true, store: info.store(), ns: info.ns(), env: envNames }));
});

export default server;
