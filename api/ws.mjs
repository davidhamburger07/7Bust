// The online room server on Vercel, the game rejoins its seat when Vercel cuts the connection
// Rooms live in Redis since players land on different servers
import http from "node:http";
import { attachRoomServer } from "../roomServer.mjs";

const server = http.createServer();
const info = attachRoomServer(server, { path: null }); // Only /api/ws traffic gets here

// A plain GET says which room store this runs on
// Redis shares rooms between servers, memory means Redis isn't set up
server.on("request", (req, res) => {
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true, store: info.store() }));
});

export default server;
