// Pure calculations that combine weight and nutrition. No page or database code here.
// Everything looks at complete days only (up to yesterday), because today isn't over.

const KCAL_PER_LB = 3500; // rule of thumb: ~3,500 kcal of surplus or deficit ≈ 1 lb
const INSIGHT_DAYS = 28; // the estimate looks at the last 4 weeks
const MIN_LOGGED_DAYS = 14; // at least half the days need meals logged
const MIN_WEIGH_INS = 4;
const MIN_WEIGH_SPAN = 14; // first to last weigh-in, in days

// { "2026-11-06": 1950, ... } for every day with at least one meal.
function caloriesByDay(meals) {
  const totals = new Map();
  for (const m of meals) totals.set(m.date, (totals.get(m.date) ?? 0) + m.calories);
  return totals;
}

const inRange = (date, start, end) => date >= start && date <= end; // YYYY-MM-DD sorts like dates
const mean = (nums) => nums.reduce((a, b) => a + b, 0) / nums.length;

// Estimated maintenance calories over the last 28 complete days:
//   maintenance ≈ average daily intake − (weight change per day × 3,500)
// Losing 1 lb/week while eating 2,000/day gives 2,000 + 500 = 2,500.
// Always returns the counts, so the page can say what's missing when `ready` is false.
function estimateMaintenance(entries, meals, today) {
  const end = shiftDay(today, -1);
  const start = shiftDay(today, -INSIGHT_DAYS);
  const kcal = [...caloriesByDay(meals)].filter(([date]) => inRange(date, start, end));
  const weighIns = entries.filter((e) => inRange(e.date, start, end)).sort((a, b) => a.date.localeCompare(b.date));
  const result = {
    start, end,
    loggedDays: kcal.length,
    weighIns: weighIns.length,
    spanDays: weighIns.length ? dayNumber(weighIns.at(-1).date) - dayNumber(weighIns[0].date) : 0,
  };
  result.ready = result.loggedDays >= MIN_LOGGED_DAYS && result.weighIns >= MIN_WEIGH_INS &&
    result.spanDays >= MIN_WEIGH_SPAN;
  if (!result.ready) return result;

  result.avgIntake = mean(kcal.map(([, total]) => total));
  // The weight this maintenance belongs to: lighter bodies burn less, so it's only right
  // to compare it with your targets at the weight you were during these 28 days.
  result.avgWeight = mean(weighIns.map((e) => e.weight));
  const lbPerDay = weightSlopePerDay(weighIns);
  result.lbPerWeek = lbPerDay * 7;
  const raw = result.avgIntake - lbPerDay * KCAL_PER_LB;
  result.maintenance = Math.round(raw / 50) * 50; // more precision than this would be fake
  return result;
}

// The last `weeks` complete 7-day blocks, newest first. Each block:
//   { start, end, avgCalories, loggedDays, avgWeight, change }
// avgCalories is null with no meals logged; avgWeight is null with fewer than 2 weigh-ins;
// change compares this block's average weight with the block before it (null if either is missing).
function weeklySummary(entries, meals, today, weeks = 4) {
  const kcal = caloriesByDay(meals);
  const blocks = [];
  for (let i = 0; i <= weeks; i++) { // one extra, older block so the oldest row has a change
    const end = shiftDay(today, -1 - 7 * i);
    const start = shiftDay(end, -6);
    const days = [...kcal].filter(([date]) => inRange(date, start, end)).map(([, total]) => total);
    const weights = entries.filter((e) => inRange(e.date, start, end)).map((e) => e.weight);
    blocks.push({
      start, end,
      loggedDays: days.length,
      avgCalories: days.length ? mean(days) : null,
      avgWeight: weights.length >= 2 ? mean(weights) : null,
    });
  }
  return blocks.slice(0, weeks).map((b, i) => {
    const prev = blocks[i + 1].avgWeight;
    return { ...b, change: b.avgWeight !== null && prev !== null ? b.avgWeight - prev : null };
  });
}
