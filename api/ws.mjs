// The online room server on Vercel, the game rejoins its seat when Vercel cuts the connection
// Rooms live in Redis since players land on different servers
import http from "node:http";
import { attachRoomServer } from "../roomServer.mjs";

const server = http.createServer();
const info = attachRoomServer(server, { path: null }); // Only /api/ws traffic gets here

// A plain GET says which room store this runs on and which settings are set
// It only shows names and whether each is set, never the values
const CONFIG_VARS = ["WALLET_SECRET", "NG_APP_ID", "CG_GAME_ID", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"];
server.on("request", (req, res) => {
  const envNames = Object.keys(process.env).filter((k) => /REDIS|^KV_|UPSTASH|^ROOM_NS$/i.test(k));
  const config = Object.fromEntries(CONFIG_VARS.map((k) => [k, !!process.env[k]]));
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true, store: info.store(), ns: info.ns(), env: envNames, config }));
});

export default server;
