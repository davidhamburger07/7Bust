// The online room server on Vercel, the game rejoins its seat when Vercel cuts the connection
// Rooms live in memory, one warm server holds every connection
import http from "node:http";
import { attachRoomServer } from "../roomServer.mjs";

const server = http.createServer();
attachRoomServer(server, { path: null }); // Only /api/ws traffic gets here

export default server;
