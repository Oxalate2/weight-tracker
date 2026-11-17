// Pure eating-target logic: your settings + your weight in, daily targets out.
// No page or database code here. The weight it's given is averageWeightOn() from analytics.js,
// so your targets don't jump around with day-to-day water weight.
//
// The rules (all per lb of body weight):
//   calories = TDEE − deficit, where TDEE follows your weight (see tdeeAt below)
//   fat      = weight × 0.3 g
//   protein  = weight × 0.8 to 1.0 g
//   carbs    = whatever calories are left, at 4 kcal per gram
// Protein is a range, so carbs are too: more protein leaves room for fewer carbs.

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

// Your starting settings. tdeeWeight is filled in with your 7-day average the first time.
// 2,810 is halfway between the calculator's 5'7" (2,799) and 5'8" (2,824) results.
// 7 kcal per lb: those two results differ by 25 kcal per inch, which fits the Mifflin-St Jeor
// formula with a "moderately active" multiplier (~1.55); in that formula each lb is worth
// 4.5 kcal of BMR, × 1.55 ≈ 7 kcal of TDEE.
// Fiber and sodium don't depend on weight: fiber aims for 30-38 g with 25 g as the floor,
// and sodium is a daily limit (2,000 mg for now; lower it in the dialog when that's easy).
const TARGET_DEFAULTS = {
  tdee: 2810, tdeeWeight: null, kcalPerLb: 7, deficit: 0, fatPerLb: 0.3, proteinLow: 0.8, proteinHigh: 1.0,
  fiberFloor: 25, fiberLow: 30, fiberHigh: 38, sodiumLimit: 2000,
};

// Allowed range for each setting, used by the dialog and by backup import.
const TARGET_FIELDS = [
  { key: "tdee", label: "TDEE", min: 1000, max: 6000, unit: "kcal" },
  { key: "tdeeWeight", label: "Weight for that TDEE", min: 50, max: 700, unit: "lb" },
  { key: "kcalPerLb", label: "TDEE change per lb", min: 0, max: 20, unit: "kcal" },
  { key: "deficit", label: "Daily deficit", min: 0, max: 1500, unit: "kcal" },
  { key: "fatPerLb", label: "Fat per lb", min: 0.1, max: 1, unit: "g" },
  { key: "proteinLow", label: "Protein per lb (low)", min: 0.3, max: 1.5, unit: "g" },
  { key: "proteinHigh", label: "Protein per lb (high)", min: 0.3, max: 1.5, unit: "g" },
  { key: "fiberFloor", label: "Fiber floor", min: 0, max: 100, unit: "g" },
  { key: "fiberLow", label: "Fiber goal (low)", min: 0, max: 100, unit: "g" },
  { key: "fiberHigh", label: "Fiber goal (high)", min: 0, max: 100, unit: "g" },
  { key: "sodiumLimit", label: "Sodium limit", min: 500, max: 6000, unit: "mg" },
];

// TDEE at `weight`: the TDEE you entered, moved by kcalPerLb for each lb you're above or
// below the weight it was calculated at. Lighter body, fewer calories burned.
function tdeeAt(settings, weight) {
  return settings.tdee + settings.kcalPerLb * (weight - settings.tdeeWeight);
}

// The day's targets at `weight`. Each is { kind, goal, range: [low, high] }, where kind is:
//   "goal":  one number to hit (calories, fat). range is a small band around it (±5% / ±10%)
//            since nobody hits a number exactly.
//   "range": the range itself is the target (protein, carbs, fiber), shown as "144–180".
//   "limit": a maximum to stay under, not an amount to reach (sodium).
// goal is what the progress bar fills toward (the low end for a range, the limit for a limit).
// Fiber also has a floor: the least you want. Under the range but at or above it still counts.
// carbs' low end goes with protein's high end (more protein leaves fewer carbs) and vice versa.
function dailyTargets(settings, weight) {
  const tdee = tdeeAt(settings, weight);
  const calories = Math.round((tdee - settings.deficit) / 10) * 10;
  const fat = Math.round(weight * settings.fatPerLb);
  const protein = [Math.round(weight * settings.proteinLow), Math.round(weight * settings.proteinHigh)];
  const carbsFor = (p) => Math.max(0, Math.round((calories - fat * KCAL_PER_G.fat - p * KCAL_PER_G.protein) / KCAL_PER_G.carbs));
  return {
    weight,
    tdee: Math.round(tdee / 10) * 10,
    calories: { kind: "goal", goal: calories, range: [Math.round(calories * 0.95), Math.round(calories * 1.05)] },
    fat: { kind: "goal", goal: fat, range: [Math.round(fat * 0.9), Math.round(fat * 1.1)] },
    protein: { kind: "range", goal: protein[0], range: protein },
    carbs: { kind: "range", goal: carbsFor(protein[1]), range: [carbsFor(protein[1]), carbsFor(protein[0])] },
    fiber: { kind: "range", goal: settings.fiberLow, range: [settings.fiberLow, settings.fiberHigh], floor: settings.fiberFloor },
    sodium: { kind: "limit", goal: settings.sodiumLimit, range: [0, settings.sodiumLimit] },
  };
}

// Where a day's total stands against a target: "under", "floor" (under the range but past
// fiber's floor), "in" or "over". A limit's range starts at 0, so a limit is never "under".
function targetStatus(total, target) {
  const [low, high] = target.range;
  if (total > high) return "over";
  if (total >= low) return "in";
  return total >= (target.floor ?? Infinity) ? "floor" : "under";
}

// Saved settings from before fiber and sodium existed: fill in the new fields' defaults.
const withTargetDefaults = (saved) => ({ ...TARGET_DEFAULTS, ...saved });

// Turns raw settings (dialog strings or backup numbers) into clean settings, or explains
// what's wrong. Returns { settings } or { error }.
function validateTargets(raw) {
  if (!raw || typeof raw !== "object") return { error: "Target settings are missing." };
  const settings = {};
  for (const f of TARGET_FIELDS) {
    const value = typeof raw[f.key] === "string" && raw[f.key].trim() !== "" ? Number(raw[f.key]) : raw[f.key];
    if (typeof value !== "number" || !Number.isFinite(value)) return { error: `Enter ${f.label.toLowerCase()}.` };
    if (value < f.min || value > f.max) return { error: `${f.label} should be between ${f.min} and ${f.max} ${f.unit}.` };
    settings[f.key] = Math.round(value * 100) / 100;
  }
  if (settings.proteinHigh < settings.proteinLow) return { error: "The high protein number can't be below the low one." };
  if (!(settings.fiberFloor <= settings.fiberLow && settings.fiberLow <= settings.fiberHigh)) {
    return { error: "Fiber needs floor ≤ goal low ≤ goal high." };
  }
  // Check at the weight the TDEE was set for that fat + protein still leave room for carbs.
  const t = dailyTargets(settings, settings.tdeeWeight);
  const used = t.fat.goal * KCAL_PER_G.fat + t.protein.range[1] * KCAL_PER_G.protein;
  if (used > t.calories.goal) return { error: "Fat and protein alone add up to more than your calories. Lower them or the deficit." };
  return { settings };
}
