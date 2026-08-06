// The 7 day login streak. Day 7 chips are paid by the server so faking the streak gets nothing
// Day means the reward step you claim, not a calendar date

import * as storage from "../net/storage.js";
import { STREAK_DAY7_CHIPS, STREAK_DAY7_BACKUP } from "./cosmeticsData.js";

const KEY = "7bust:dailystreak:v1"; // Last day claimed and the date it was claimed

// Days 1 to 6 pay money, day 7 pays an exclusive cosmetic and some chips
export const MONEY_REWARDS = [500, 1000, 2000, 3500, 6000, 10000];
export const DAY7_CHIPS = STREAK_DAY7_CHIPS;
export const DAY7_BACKUP = STREAK_DAY7_BACKUP;

const todayStr = () => new Date().toISOString().slice(0, 10);
const dayIndex = (str) => Math.floor(new Date(str + "T00:00:00Z").getTime() / 86400000);

function read() {
  try {
    return JSON.parse(storage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function streakStatus() {
  const s = read();
  const today = todayStr();
  if (s.last === today) return { claimable: false, day: s.day || 1, claimedToday: true };
  let day;
  if (s.last && dayIndex(today) - dayIndex(s.last) === 1) {
    day = ((s.day || 0) % 7) + 1; // Came back the next day, so move up and loop after the last day
  } else {
    day = 1; // First time, or a day was missed, so start again
  }
  return { claimable: true, day, claimedToday: false };
}

export function recordClaim(day) {
  try {
    storage.setItem(KEY, JSON.stringify({ day, last: todayStr() }));
  } catch {
    // Saving failed, the reward still counts until the page closes
  }
}

export function tierReward(day) {
  return day < 7 ? { kind: "money", amount: MONEY_REWARDS[day - 1] } : { kind: "day7", chips: DAY7_CHIPS };
}
