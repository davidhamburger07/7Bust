// Money items come from single player games and chips items from multiplayer
// Every item shows its currency icon so it's clear which wallet pays

import { shopSummary } from "../engine/cosmetics.js";
import { MONEY } from "../engine/cosmeticsData.js";

const num = (n) => Math.round(n).toLocaleString("en-US");
const curIcon = (cur) => (cur === MONEY ? `<span class="cur cur--money">$</span>` : `<span class="cur cur--chips" aria-hidden="true"></span>`);

function control(item) {
  if (item.kind === "emote") {
    return item.owned
      ? `<span class="shop-tag on">OWNED</span>`
      : `<button class="btn btn--play shop-btn" data-action="shop-buy" data-id="${item.id}"><span class="shop-price">${curIcon(item.cur)}${num(item.price)}</span></button>`;
  }
  if (item.equipped) return `<span class="shop-tag on">EQUIPPED</span>`;
  if (item.owned) return `<button class="btn btn--online shop-btn" data-action="shop-equip" data-id="${item.id}">EQUIP</button>`;
  return `<button class="btn btn--play shop-btn" data-action="shop-buy" data-id="${item.id}"><span class="shop-price">${curIcon(item.cur)}${num(item.price)}</span></button>`;
}

function item(preview, it, extraClass = "") {
  return `
  <div class="shop-item${it.equipped ? " is-on" : ""}${it.owned ? " owned" : ""} ${extraClass}">
    <div class="shop-preview">${preview}</div>
    <div class="shop-name">${it.name}${it.cur !== MONEY ? ' <span class="shop-prem">PREMIUM</span>' : ""}</div>
    ${it.blurb ? `<div class="shop-blurb">${it.blurb}</div>` : ""}
    ${control(it)}
  </div>`;
}

const faceItem = (f) => item(`<div class="card card--mini" data-skin="${f.id}"><span class="corner">7</span><span class="face">7</span></div>`, f);
const backItem = (b) => item(`<div class="card card--mini card--pending"><span class="card-back" data-back="${b.id}"></span></div>`, b);
const avatarItem = (a) => item(`<span class="avatar avatar--lg" style="--av-bg:${a.bg}"><span class="avatar-emoji">${a.emoji}</span></span>`, a);
const feltItem = (f) => item(`<span class="felt-swatch" style="background:${f.swatch}"></span>`, f);
const emoteItem = (p) => item(`<span class="emote-preview">${p.emojis.slice(0, 5).map((e) => `<span>${e}</span>`).join("")}</span>`, p, "shop-item--wide");

function section(title, note, items, render, gridClass = "") {
  return `
  <h3 class="shop-head">${title} <span class="shop-headnote">${note}</span></h3>
  <div class="shop-grid ${gridClass}">${items.map(render).join("")}</div>`;
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
          <span class="shop-sub">Deck skins, backs, avatars, felts &amp; emotes</span>
        </div>
        <div class="shop-wallets">
          <span class="shop-bal shop-bal--money" title="Money: earned in single-player"><span class="cur cur--money">$</span><b class="num">${num(s.money)}</b></span>
          <span class="shop-bal shop-bal--chips" title="Chips: earned in multiplayer"><span class="cur cur--chips" aria-hidden="true"></span><b class="num">${num(s.chips)}</b></span>
        </div>
      </div>

      ${section("Card faces", "spend Money · shows in every mode", s.faces, faceItem)}
      ${section("Card backs", "the face-down deck", s.backs, backItem)}
      ${section("Avatars", "your seat &amp; the leaderboard", s.avatars, avatarItem, "shop-grid--av")}
      ${section("Table felts", "Chips only · multiplayer tables", s.felts, feltItem, "shop-grid--av")}
      ${section("Emote packs", "extra emotes for your in-game strip", s.emotes, emoteItem)}

      <p class="shop-foot">
        <span class="cur cur--money">$</span> <b>Money</b> is earned in the single-player street games &nbsp;·&nbsp;
        <span class="cur cur--chips" aria-hidden="true"></span> <b>Chips</b> in official multiplayer.
        ${s.signedIn ? "" : "Sign in to buy Chips items on your account (guests spend their local Chips)."}
        Cosmetics change how the table looks, never how it plays.
      </p>
    </div>
  </div>`;
}
