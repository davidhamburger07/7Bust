# 7Bust

A press-your-luck casino card game for the browser. Flip cards to build a hand of
unique numbers, bank before a duplicate busts you, and have the highest total after
nine rounds. Play solo against the house AI, climb The Ladder, or play online with up
to 8 people.

> I stopped working on 7Bust in August 2026. It's playable and the code is here to
> read, but it isn't being developed any more.

## Run it locally

```bash
npm install
node serve.mjs
```

Open http://localhost:3000. Online rooms run in memory locally, so you can open two
browsers and play against yourself. Set `REDIS_URL` if you want rooms shared across
server instances like the deployed version.

## What's in the game

- **Solo**: a 9 round match against three AIs with different personalities. Rook is
  reckless, Nova counts cards, Pip takes one card and holds.
- **The Ladder**: single player rooms you buy into with Money. Nine rounds against
  house regulars, highest total takes the pot. 12 rooms from 50 to 20 million.
- **Online**: create or join a room with a 4 letter code, or browse public tables.
  Hosts set the table size, the buy-in and the round count. Chat, emotes, pause
  votes and a house AI that takes over if someone leaves.
- **Action cards**: Freeze, Flip Three, Second Chance and See the Future.
- Two currencies. Money for single player, Chips for online tables. A cosmetics
  shop for card faces, backs, avatars and felts.
- A voiced tutorial, with voice lines made using ElevenLabs, and 7BUST FM, a
  radio that plays while you play.
- Provably fair shuffles. The server seed is committed before the match and
  revealed after, so the card order can be checked.

## Platforms

The same game builds for five places. `npm run build:cg` makes the CrazyGames
upload, and there are matching scripts for Discord Activities, GameDistribution,
GamePix and Newgrounds. Each one swaps in that platform's ads or login and nothing
else. The multiplayer backend is a Vercel function with a Redis room store, shared
by every build.

## Layout

```
index.*.html       one entry per platform
src/engine/        game rules, AI, deck, provably fair RNG. No DOM in here
src/server/        the match orchestrator and token verification
src/net/           platform adapters and the WebSocket client
src/ui/            rendering, tutorial, radio, shop
api/               Vercel functions: rooms, wallet, analytics, auth
roomServer.mjs     the online room server
store.mjs          Redis or in-memory room store
build-*.mjs        the five platform builds
```

## Credits

Music by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By
Attribution 4.0. Voice lines made using ElevenLabs. Everything else is mine.

## Licence

The code is MIT licensed, see `LICENSE`. The art, audio and voice lines are part of
the game and not covered by it.
