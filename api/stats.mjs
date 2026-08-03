// Shows the play stats at /api/stats
// Set a stats token to lock it, without one it's open
import { createStore } from "../store.mjs";

let store = null;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // Lets a dashboard on another site read this, it's only play money totals
  res.setHeader("Access-Control-Allow-Origin", "*");
  const token = process.env.STATS_TOKEN;
  if (token) {
    const url = new URL(req.url, "http://x");
    if (url.searchParams.get("key") !== token) return res.status(401).json({ ok: false, error: "bad key" });
  }
  try {
    if (!store) store = createStore();
    const url = new URL(req.url, "http://x");
    const day = url.searchParams.get("day") || new Date().toISOString().slice(0, 10);
    const { day: today, all, recent } = await store.readStats(day);
    const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
    const d = num(today);
    const a = num(all);
    res.status(200).json({
      ok: true,
      store: store.kind,
      namespace: store.ns,
      date: day,
      summary: {
        matchesToday: d.matches || 0,
        matchesAllTime: a.matches || 0,
        soloVsOnlineAllTime: { solo: a.matches_solo || 0, online: a.matches_online || 0 },
        avgMatchSeconds: a.matches ? Math.round(a.match_ms_total / a.matches / 1000) : 0,
        multiplayerGamesAllTime: a.mp_deals || 0,
        paidMatchesAllTime: a.mp_paid_matches || 0,
        houseRakeAllTime: a.mp_rake_total || 0,
        adsWatchedAllTime: a.ads_watched || 0,
        jackpotsAllTime: a.wheel_jackpots || 0,
        dailyClaimsAllTime: a.daily_claims || 0,
        freeChipsPaidAllTime: (a.wheel_chips || 0) + (a.daily_chips || 0),
        sessionsAllTime: a.sessions || 0,
        sessionsToday: d.sessions || 0,
        newVsReturningAllTime: { new: a.sessions_new || 0, returning: a.sessions_returning || 0 },
        lobbyFunnelAllTime: {
          house: a.from_lobby_to_house || 0,
          solo: a.from_lobby_to_solo_match || 0,
          online: a.from_lobby_to_online_menu || 0,
        },
        houseHandsAllTime: a.house_rounds || 0,
        houseSessionsAllTime: a.house_sessions || 0,
        houseHandsPerSession: a.house_sessions ? Number((a.house_rounds / a.house_sessions).toFixed(1)) : 0,
        avgHouseSessionSeconds: a.house_sessions ? Math.round(a.house_session_ms_total / a.house_sessions / 1000) : 0,
        // Visits that got past trying it out, the number this mode was made for
        houseStickySessionsAllTime: a.house_sessions_10plus || 0,
        // The real house edge, the simulator says about 4.6%
        houseRealisedRtpPct: a.house_wagered_total
          ? Number(((a.house_returned_total / a.house_wagered_total) * 100).toFixed(2))
          : 0,
        houseTopUpsAllTime: a.house_topups || 0,
        houseBustOutsAllTime: a.house_bustouts || 0,
      },
      today: d,
      allTime: a,
      recent,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
