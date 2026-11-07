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
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = recent.reduce((a, e) => a + e.weight, 0) / n;
  let num = 0, den = 0;
  recent.forEach((e, i) => { num += (xs[i] - meanX) * (e.weight - meanY); den += (xs[i] - meanX) ** 2; });
  return (num / den) * 7;
}
