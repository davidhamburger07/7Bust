// Says who the player is to the backend, from whichever platform has a token, or null for guests
// Only imports the platform adapters so the wallet and network code can both use it

import { cgUserToken } from "./crazygames.js";
import { discordWalletToken } from "./discord.js";
import { ngWalletToken } from "./newgrounds.js";

export async function walletCredential() {
  const d = discordWalletToken();
  if (d) return { platform: "discord", token: d };
  const n = ngWalletToken();
  if (n) return { platform: "newgrounds", token: n };
  const c = await cgUserToken();
  if (c) return { platform: "crazygames", token: c };
  return null;
}
