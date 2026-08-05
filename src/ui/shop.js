// Shop for card skins and avatars, bought with practice chips

import { shopSummary } from "../engine/cosmetics.js";

const money = (n) => Math.round(n).toLocaleString("en-US");

function priceBtn(kind, item) {
  return `<button class="btn btn--play shop-btn" data-action="shop-buy" data-kind="${kind}" data-id="${item.id}">
    <span class="shop-price"><span class="shop-chip"></span>${money(item.price)}</span></button>`;
}
function stateBtn(kind, item) {
  if (item.equipped) return `<span class="shop-tag on">EQUIPPED</span>`;
  if (item.owned) return `<button class="btn btn--online shop-btn" data-action="shop-equip" data-kind="${kind}" data-id="${item.id}">EQUIP</button>`;
  return priceBtn(kind, item);
}

function skinItem(s) {
  return `
  <div class="shop-item${s.equipped ? " is-on" : ""}${s.owned ? " owned" : ""}">
    <div class="shop-preview"><div class="card card--mini" data-skin="${s.id}"><span class="corner">7</span><span class="face">7</span></div></div>
    <div class="shop-name">${s.name}</div>
    <div class="shop-blurb">${s.blurb}</div>
    ${stateBtn("card", s)}
  </div>`;
}

function avatarItem(a) {
  return `
  <div class="shop-item${a.equipped ? " is-on" : ""}${a.owned ? " owned" : ""}">
    <div class="shop-preview"><span class="avatar avatar--lg" style="--av-bg:${a.bg}"><span class="avatar-emoji">${a.emoji}</span></span></div>
    <div class="shop-name">${a.name}</div>
    ${stateBtn("avatar", a)}
  </div>`;
}

export function renderShop(view) {
  const s = shopSummary();
  return `
  <div class="screen screen--shop">
    <div class="shop-wrap">
      <div class="shop-top">
        <button class="icon-btn" data-action="shop-close" aria-label="Back to the lobby">←</button>
        <div class="shop-titlebox">
          <h2 class="shop-title">THE SHOP</h2>
          <span class="shop-sub">Spend practice chips on the look of your table</span>
        </div>
        <span class="shop-bal"><span class="shop-chip"></span><b class="num">${money(s.chips)}</b></span>
      </div>

      <h3 class="shop-head">Card skins <span class="shop-headnote">the whole deck, every mode</span></h3>
      <div class="shop-grid">${s.cardSkins.map(skinItem).join("")}</div>

      <h3 class="shop-head">Avatars <span class="shop-headnote">shows on your seat &amp; the leaderboard</span></h3>
      <div class="shop-grid shop-grid--av">${s.avatars.map(avatarItem).join("")}</div>

      <p class="shop-foot">Cosmetics only, they change how the table looks, never how it plays or what a chip is worth. Bought with your single-player practice chips.</p>
    </div>
  </div>`;
}
