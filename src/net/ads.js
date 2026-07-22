// One place to show ads, whichever network this build uses
// Off ad platforms they fail with no-ad and callers just carry on

import { cgRewardedAd, cgMidgameAd } from "./crazygames.js";
import { gdAvailable, gdRewardedAd, gdMidgameAd } from "./gamedistribution.js";

// Can any network here pay out a rewarded ad, used to show or hide the free chips button
export const adsAvailable = () => gdAvailable() || (typeof window !== "undefined" && !!(window.CrazyGames && window.CrazyGames.SDK));

export function rewardedAd(opts) {
  return gdAvailable() ? gdRewardedAd(opts) : cgRewardedAd(opts);
}

export function midgameAd(opts) {
  return gdAvailable() ? gdMidgameAd(opts) : cgMidgameAd(opts);
}
