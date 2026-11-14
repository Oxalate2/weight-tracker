// Pure nutrition logic: meal validation and daily totals. No page or database code here.
// The same validateMeal() checks both the meal form and meals coming from a backup file,
// so the rules can't drift apart.

// Every number a meal can have. Only calories is required; a missing value is stored as
// null ("not recorded"), never 0, because "0 g fiber" and "didn't track fiber" differ.
const NUTRIENTS = [
  { key: "calories", label: "Calories", unit: "kcal", max: 5000, decimals: 0, required: true },
  { key: "protein", label: "Protein", unit: "g", max: 500, decimals: 1 },
  { key: "carbs", label: "Carbs", unit: "g", max: 500, decimals: 1 },
  { key: "fat", label: "Fat", unit: "g", max: 500, decimals: 1 },
  { key: "fiber", label: "Fiber", unit: "g", max: 200, decimals: 1 },
  { key: "sodium", label: "Sodium", unit: "mg", max: 20000, decimals: 0 },
];

const roundTo = (n, decimals) => Math.round(n * 10 ** decimals) / 10 ** decimals;

// Form fields give strings ("" when empty); backup files give numbers or null.
// Returns a number, null for "empty", or NaN for anything that isn't a number.
function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value.trim() === "") return null; // Number("") would be 0, which is wrong here
    value = Number(value);
  }
  return typeof value === "number" ? value : NaN;
}

// Turns raw input into a clean meal object, or explains what's wrong.
// Returns { meal } on success or { error } on failure.
// Pass `today` (YYYY-MM-DD) to reject future dates; leave it out to skip that check.
function validateMeal(raw, today) {
  if (!raw || typeof raw !== "object") return { error: "Meal data is missing." };
  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 64) {
    return { error: "Meal has an invalid id." };
  }
  if (!isValidISODate(raw.date)) return { error: "Choose a valid date." };
  if (today && raw.date > today) return { error: "The date can't be in the future." };

  const description = typeof raw.description === "string" ? raw.description.trim().slice(0, 100) : "";
  if (!description) return { error: "Describe the meal (e.g. \"Chicken burrito bowl\")." };

  const meal = {
    id: raw.id,
    date: raw.date,
    description,
    notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 200) : "",
    createdAt: typeof raw.createdAt === "string" && !Number.isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt
      : new Date().toISOString(),
  };

  for (const n of NUTRIENTS) {
    const value = toNumberOrNull(raw[n.key]);
    if (value === null) {
      if (n.required) return { error: `Enter ${n.label.toLowerCase()}.` };
      meal[n.key] = null;
      continue;
    }
    if (!Number.isFinite(value)) return { error: `${n.label} must be a number.` };
    if (value < 0 || value > n.max) return { error: `${n.label} should be between 0 and ${n.max} ${n.unit}.` };
    meal[n.key] = roundTo(value, n.decimals);
  }
  return { meal };
}

// Sums one day's meals. For each nutrient: { total, missing }, where `missing` counts
// meals that didn't record it, so the page can show "partial" instead of a misleading sum.
function dailyTotals(meals) {
  const totals = { count: meals.length };
  for (const n of NUTRIENTS) {
    let total = 0, missing = 0;
    for (const meal of meals) {
      if (meal[n.key] === null || meal[n.key] === undefined) missing++;
      else total += meal[n.key];
    }
    totals[n.key] = { total: roundTo(total, n.decimals), missing };
  }
  return totals;
}

// ---------- Trends ----------
// One point per calendar day from startISO to endISO (both included) for one nutrient:
//   { date, logged, value, partial }
//   logged:  any meal at all that day. A day with no meals is "not logged", never 0 kcal.
//   value:   the day's total, or null if not logged / no meal recorded this nutrient.
//   partial: some meals that day left this nutrient blank, so the real total is higher.
function dailySeries(meals, startISO, endISO, key) {
  const byDate = new Map();
  for (const meal of meals) {
    if (!byDate.has(meal.date)) byDate.set(meal.date, []);
    byDate.get(meal.date).push(meal);
  }
  const series = [];
  for (let date = startISO; date <= endISO; date = shiftDay(date, 1)) {
    const dayMeals = byDate.get(date) ?? [];
    const { total, missing } = dailyTotals(dayMeals)[key];
    const recorded = dayMeals.length - missing;
    series.push({
      date,
      logged: dayMeals.length > 0,
      value: recorded > 0 ? total : null,
      partial: recorded > 0 && missing > 0,
    });
  }
  return series;
}

// Average per day, counting only complete days: logged, fully recorded, and not `today`
// (today isn't over yet). Returns { average, days }; average is null when days is 0.
function averageOf(series, today) {
  const complete = series.filter((p) => p.value !== null && !p.partial && p.date !== today);
  if (complete.length === 0) return { average: null, days: 0 };
  return { average: complete.reduce((sum, p) => sum + p.value, 0) / complete.length, days: complete.length };
}
