// Daily login popup, shows on the first load of a new day
// Day 7 gives chips and a cosmetic you can't buy anywhere else

import { MONEY_REWARDS, DAY7_CHIPS } from "../engine/dailyStreak.js";
import { itemById } from "../engine/cosmeticsData.js";
import { chipsIcon } from "./icons.js";

const num = (n) => Math.round(n).toLocaleString("en-US");
const money = (n) => `<span class="cur cur--money">$</span>${num(n)}`;
const chips = (n) => `${chipsIcon()}${num(n)}`;

function tileReward(day) {
  if (day < 7) return `<span class="dl-amt">${money(MONEY_REWARDS[day - 1])}</span>`;
  return `
    <span class="dl-gift">🎁</span>
    <span class="dl-amt dl-amt--chips">${chips(DAY7_CHIPS)}</span>
    <span class="dl-extra">+ exclusive skin</span>`;
}

function dayTile(day, current, claimable) {
  const prize = day === 7;
  let state = "locked";
  if (day < current || (day === current && !claimable)) state = "claimed";
  else if (day === current) state = "today";
  const cls = `dl-day dl-day--${state}${prize ? " dl-day--prize" : ""}`;
  const badge = prize ? `<span class="dl-prizebadge">EXCLUSIVE</span>` : "";
  const check = state === "claimed" ? `<span class="dl-check" aria-hidden="true">✓</span>` : "";
  return `
    <div class="${cls}">
      ${badge}
      <div class="dl-daynum">Day ${day}</div>
      <div class="dl-tile-reward">${tileReward(day)}</div>
      ${check}
    </div>`;
}

function cosmeticReveal(id) {
  const it = itemById(id);
  if (!it) return "";
  if (it.kind === "avatar") {
    return `<span class="avatar avatar--xl" style="--av-bg:${it.bg}"><span class="avatar-emoji">${it.emoji}</span></span>`;
  }
  return `<span class="dl-emote-reveal">${(it.emojis || []).map((e) => `<span>${e}</span>`).join("")}</span>`;
}

function reveal(r) {
  if (r.day < 7) {
    return `
      <div class="dl-reveal">
        <div class="dl-reveal-kick">Day ${r.day} claimed</div>
        <div class="dl-reveal-big">${money(r.money)}</div>
        <p class="dl-reveal-sub">Added to your single-player Money. Come back tomorrow for Day ${r.day + 1}.</p>
        <button class="btn btn--play" data-action="daily-login-close">CONTINUE</button>
      </div>`;
  }
  // Day 7 gives chips instead once every exclusive is already owned
  if (r.backup) {
    return `
      <div class="dl-reveal dl-reveal--prize">
        <div class="dl-reveal-kick">Day 7 · Collection complete</div>
        <div class="dl-reveal-big">${chips(r.chips)}</div>
        <p class="dl-reveal-sub">You already own every exclusive, here's a big Chips payout instead. The streak loops back to Day 1 tomorrow.</p>
        <button class="btn btn--play" data-action="daily-login-close">COLLECT</button>
      </div>`;
  }
  const it = itemById(r.cosmetic);
  const kindWord = it && it.kind === "avatar" ? "avatar" : "emote pack";
  return `
    <div class="dl-reveal dl-reveal--prize">
      <div class="dl-reveal-kick">Day 7 · Exclusive unlocked</div>
      <div class="dl-reveal-prize">${cosmeticReveal(r.cosmetic)}</div>
      <div class="dl-reveal-name">${(it && it.name) || "Exclusive"} <span class="dl-reveal-tag">${kindWord}</span></div>
      <div class="dl-reveal-big dl-reveal-big--sm">${chips(r.chips)}</div>
      <p class="dl-reveal-sub">A login-only ${kindWord}, it can't be bought with Money or Chips anywhere. The streak loops back to Day 1 tomorrow.</p>
      <button class="btn btn--play" data-action="daily-login-close">AWESOME</button>
    </div>`;
}

export function renderDailyLogin(view) {
  const dl = view.dailyLogin;
  if (!dl) return "";
  const inner = dl.result
    ? reveal(dl.result)
    : `
      <div class="dl-track">
        ${[1, 2, 3, 4, 5, 6, 7].map((d) => dayTile(d, dl.day, dl.claimable)).join("")}
      </div>
      <p class="dl-note">
        <b>Day 7 is the only way to get the exclusive avatars &amp; emotes.</b>
        They're never sold in the shop, not for Money, not for Chips. Play seven days in a row to claim one.
      </p>
      <div class="dl-cta">
        ${
          dl.claimable
            ? `<button class="btn btn--play dl-claim" data-action="daily-login-claim">${
                dl.day === 7 ? "CLAIM YOUR EXCLUSIVE PRIZE" : `CLAIM DAY ${dl.day} · ${money(MONEY_REWARDS[dl.day - 1])}`
              }</button>`
            : `<div class="dl-done">Today's reward is claimed. Come back tomorrow for Day ${(dl.day % 7) + 1}.</div>
               <button class="btn btn--online" data-action="daily-login-close">CLOSE</button>`
        }
      </div>`;
  return `
  <div class="overlay dl-overlay">
    <div class="result dl-card" role="dialog" aria-label="Daily login reward">
      ${dl.result ? "" : `<button class="icon-btn dl-x" data-action="daily-login-close" aria-label="Close">×</button>`}
      <div class="dl-kick">Daily Login</div>
      <h2 class="dl-title">${dl.result ? "Nice!" : `Welcome back: Day ${dl.day}`}</h2>
      ${dl.result ? "" : `<p class="dl-sub">Log in seven days running. Each day pays more, and Day 7 drops an exclusive you can't buy anywhere.</p>`}
      ${inner}
    </div>
  </div>`;
}
