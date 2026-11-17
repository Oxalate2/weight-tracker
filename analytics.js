// Pure calculation functions: entries in, numbers out. No page or database code here.
// Every calculation is based on real calendar dates, not on "the last N entries",
// because weigh-ins are irregular (gaps are normal).

const DAY_MS = 86400000;
const RANGE_DAYS = { "7D": 7, "30D": 30, "90D": 90, "6M": 182, "1Y": 365, All: null };

// "2026-11-06" -> whole number of days since 1970 (timezone-safe for date math)
function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

// True only for a real calendar date in YYYY-MM-DD form ("2026-02-30" is rejected).
function isValidISODate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Move a YYYY-MM-DD date by whole days: shiftDay("2026-03-01", -1) -> "2026-02-28".
function shiftDay(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// For each entry, the average of all entries in the 7 days ending on that entry's date.
function rollingAverage(entries, windowDays = 7) {
  return entries.map((e) => {
    const day = dayNumber(e.date);
    const inWindow = entries.filter((o) => {
      const d = dayNumber(o.date);
      return d <= day && d > day - windowDays;
    });
    const avg = inWindow.reduce((sum, o) => sum + o.weight, 0) / inWindow.length;
    return { day, avg };
  });
}

// Your weight on `dayISO`, smoothed: the average of weigh-ins in the 7 days ending on your
// latest weigh-in on or before that day. A single weigh-in swings 2-3 lb with water and salt;
// the average doesn't. Later weigh-ins are ignored. Returns null when there's none yet.
function averageWeightOn(entries, dayISO) {
  const upTo = entries.filter((e) => e.date <= dayISO).sort((a, b) => a.date.localeCompare(b.date));
  if (upTo.length === 0) return null;
  return Math.round(rollingAverage(upTo).at(-1).avg * 10) / 10;
}

// Change from the entry closest to `days` before the latest one, to the latest.
// Returns null when there isn't an honest comparison available.
function changeOver(entries, days, today) {
  if (entries.length < 2) return null;
  const latest = entries[entries.length - 1];
  const latestDay = dayNumber(latest.date);
  if (today - latestDay > days) return null; // latest weigh-in is too old to call this "current"
  const target = latestDay - days;
  const tolerance = Math.ceil(days / 3);
  let best = null;
  for (const e of entries.slice(0, -1)) {
    const gap = Math.abs(dayNumber(e.date) - target);
    if (gap <= tolerance && (best === null || gap < best.gap)) best = { gap, weight: e.weight };
  }
  return best ? latest.weight - best.weight : null;
}

// Trend in lb per week: straight-line fit through the last 28 days of entries.
// Needs at least 3 entries spread over at least 7 days, otherwise null.
function trendPerWeek(entries, today) {
  const recent = entries.filter((e) => dayNumber(e.date) > today - 28);
  if (recent.length < 3) return null;
  const xs = recent.map((e) => dayNumber(e.date));
  if (Math.max(...xs) - Math.min(...xs) < 7) return null;
  return weightSlopePerDay(recent) * 7;
}

// Least-squares straight line through the weigh-ins: pounds per day (negative = losing).
// Uses every point, so one salty-dinner spike barely moves it.
function weightSlopePerDay(entries) {
  const xs = entries.map((e) => dayNumber(e.date));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = entries.reduce((a, e) => a + e.weight, 0) / n;
  let num = 0, den = 0;
  entries.forEach((e, i) => { num += (xs[i] - meanX) * (e.weight - meanY); den += (xs[i] - meanX) ** 2; });
  return num / den;
}
