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

// Everything but your TDEE starts here. Your TDEE, the weight it was worked out at, and how much
// it changes per lb come from your stats instead (see startingTdee below), so they aren't set here.
// Fiber and sodium don't depend on weight: fiber aims for 30-38 g with 25 g as the floor,
// and sodium is a daily limit (2,000 mg for now; lower it in the dialog when that's easy).
// Added sugar is a daily limit too: the American Heart Association's 36 g for men and 25 g for
// women (see addedSugarLimitFor). Natural sugar in fruit and milk doesn't count toward it.
const TARGET_DEFAULTS = {
  deficit: 0, fatPerLb: 0.3, proteinLow: 0.8, proteinHigh: 1.0,
  fiberFloor: 25, fiberLow: 30, fiberHigh: 38, sodiumLimit: 2000, addedSugarLimit: 36,
};
const addedSugarLimitFor = (profile) => (profile?.sex === "female" ? 25 : 36);

// Before the setup from your stats existed, everyone started at this TDEE (the app's first
// user's calculator result) with 7 kcal/lb. Settings still exactly at it, with no stats saved,
// were never set for you, so the Settings tab suggests setting them up from your stats.
const OLD_DEFAULT_TDEE = 2810;
const OLD_DEFAULT_KCAL_PER_LB = 7;
const isOldDefault = (settings, profile) =>
  !profile && settings.tdee === OLD_DEFAULT_TDEE && settings.kcalPerLb === OLD_DEFAULT_KCAL_PER_LB;

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
  { key: "addedSugarLimit", label: "Added sugar limit", min: 0, max: 200, unit: "g" },
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
//   "limit": a maximum to stay under, not an amount to reach (sodium, added sugar).
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
    addedSugar: { kind: "limit", goal: settings.addedSugarLimit, range: [0, settings.addedSugarLimit] },
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

// Saved settings from before fiber, sodium or added sugar existed: fill in the new fields'
// defaults. The added sugar limit depends on your stats' sex, when you've entered them.
const withTargetDefaults = (saved, profile) =>
  ({ ...TARGET_DEFAULTS, addedSugarLimit: addedSugarLimitFor(profile), ...saved });

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

// ---------- Calibrating from measured maintenance ----------
// estimateMaintenance() (insights.js) measures what you really burn from your meals and weigh-ins.
// Gaps smaller than this are within that estimate's own error, so they aren't worth acting on.
const CALIBRATE_MIN_GAP = 100; // kcal

// Your settings vs. the measurement, both at the weight you averaged while it was measured.
// Returns { weight, predicted, measured, gap, worthIt }; gap is measured − predicted.
function compareMaintenance(settings, est) {
  const weight = Math.round(est.avgWeight * 10) / 10;
  const predicted = Math.round(tdeeAt(settings, weight) / 10) * 10;
  const gap = est.maintenance - predicted;
  return { weight, predicted, measured: est.maintenance, gap, worthIt: Math.abs(gap) >= CALIBRATE_MIN_GAP };
}

// Your settings with the measured maintenance as your TDEE, at the weight it was measured at.
// Everything else (deficit, protein, fat, fiber, sodium, added sugar) stays as you set it.
// Returns { settings } or { error }, through the same checks as the targets dialog.
function calibratedTargets(settings, est) {
  return validateTargets({ ...settings, tdee: est.maintenance, tdeeWeight: Math.round(est.avgWeight * 10) / 10 });
}

// ---------- Your starting TDEE, from your stats ----------
// The Mifflin-St Jeor formula, the one most TDEE calculators use:
//   BMR  = 10 × kg + 6.25 × cm − 5 × age, then +5 for men or −161 for women
//   TDEE = BMR × your activity level's multiplier
// It's a starting guess (usually within ~10%). After about 4 weeks of logging, the Trends tab
// measures your real maintenance and offers to replace it (see compareMaintenance above).
const ACTIVITY_LEVELS = [
  { key: "sedentary", label: "Sedentary: desk job, little exercise", multiplier: 1.2 },
  { key: "light", label: "Light: exercise 1–3 days a week", multiplier: 1.375 },
  { key: "moderate", label: "Moderate: exercise 3–5 days a week", multiplier: 1.55 },
  { key: "very", label: "Very active: hard exercise 6–7 days a week", multiplier: 1.725 },
  { key: "extra", label: "Extra active: physical job plus training", multiplier: 1.9 },
];
const KG_PER_LB = 0.45359237;
const PROFILE_AGE = [18, 100]; // the formula is for adults
const PROFILE_HEIGHT = [48, 90]; // inches: 4'0" to 7'6"

// Your stats: { sex: "male" | "female", birthYear, heightIn, activity }. Saved as a birth year,
// not an age, so your age stays right as years go by.
const ageIn = (profile, year) => year - profile.birthYear;

// Form values ({ sex, age, heightIn, activity }) or a saved/backup profile
// ({ sex, birthYear, heightIn, activity }) in, { profile } or { error } out. heightIn is your
// total height in inches (the dialog adds up feet and inches).
// `year` is this year, from the caller, so this stays free of clocks.
function validateProfile(raw, year) {
  if (!raw || typeof raw !== "object") return { error: "Your stats are unreadable." };
  if (raw.sex !== "male" && raw.sex !== "female") return { error: "Choose male or female for the formula." };
  const num = (v) => (typeof v === "string" ? (v.trim() === "" ? NaN : Number(v)) : typeof v === "number" ? v : NaN);
  let birthYear;
  if (raw.birthYear !== undefined) {
    birthYear = num(raw.birthYear);
    if (!Number.isInteger(birthYear)) return { error: "Your stats have an unreadable birth year." };
  } else {
    const age = num(raw.age);
    if (!Number.isFinite(age)) return { error: "Enter your age." };
    birthYear = year - Math.round(age);
  }
  const age = year - birthYear;
  if (age < PROFILE_AGE[0] || age > PROFILE_AGE[1]) return { error: `Age should be between ${PROFILE_AGE[0]} and ${PROFILE_AGE[1]}.` };
  const heightIn = Math.round(num(raw.heightIn) * 10) / 10;
  if (!Number.isFinite(heightIn)) return { error: "Enter your height." };
  if (heightIn < PROFILE_HEIGHT[0] || heightIn > PROFILE_HEIGHT[1]) return { error: "Height should be between 4'0\" and 7'6\"." };
  if (!ACTIVITY_LEVELS.some((a) => a.key === raw.activity)) return { error: "Choose an activity level." };
  return { profile: { sex: raw.sex, birthYear, heightIn, activity: raw.activity } };
}

// Your TDEE at `weight` (lb) and how much it changes per lb, from your stats.
// Per lb: the formula adds 10 kcal of BMR per kg, so 10 × 0.4536 ≈ 4.54 kcal per lb, times your
// activity multiplier (7.0 at "moderate"). Returns { tdee, kcalPerLb, bmr }.
function startingTdee(profile, weight, year) {
  const activity = ACTIVITY_LEVELS.find((a) => a.key === profile.activity);
  const bmr = 10 * weight * KG_PER_LB + 6.25 * profile.heightIn * 2.54 - 5 * ageIn(profile, year) +
    (profile.sex === "male" ? 5 : -161);
  return {
    bmr: Math.round(bmr),
    tdee: Math.round((bmr * activity.multiplier) / 10) * 10,
    kcalPerLb: Math.round(10 * KG_PER_LB * activity.multiplier * 10) / 10,
  };
}

// Your targets from your stats: the TDEE above at `weight`, with your other settings kept
// (or the defaults the first time). Returns { settings } or { error }, via validateTargets.
function targetsFromProfile(profile, weight, deficit, current, year) {
  const { tdee, kcalPerLb } = startingTdee(profile, weight, year);
  return validateTargets({ ...withTargetDefaults(current, profile), tdee, tdeeWeight: Math.round(weight * 10) / 10, kcalPerLb, deficit });
}
