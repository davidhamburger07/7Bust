// One place to show ads, whichever network this build uses
// Off ad platforms they fail with no-ad and callers just carry on

import { cgRewardedAd, cgMidgameAd } from "./crazygames.js";
import { gdAvailable, gdRewardedAd, gdMidgameAd } from "./gamedistribution.js";
import { gpAvailable, gpRewardedAd, gpMidgameAd } from "./gamepix.js";

// Can any network here pay out a rewarded ad, used to show or hide the free chips button
export const adsAvailable = () =>
  gpAvailable() || gdAvailable() || (typeof window !== "undefined" && !!(window.CrazyGames && window.CrazyGames.SDK));

// Only one ad SDK is ever in a build, so the order doesn't really matter
export function rewardedAd(opts) {
  if (gpAvailable()) return gpRewardedAd(opts);
  if (gdAvailable()) return gdRewardedAd(opts);
  return cgRewardedAd(opts);
}

export function midgameAd(opts) {
  if (gpAvailable()) return gpMidgameAd(opts);
  if (gdAvailable()) return gdMidgameAd(opts);
  return cgMidgameAd(opts);
}
