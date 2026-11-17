// Pure body-measurement logic: validation and progress. No page or database code here.
// One record per date (like weigh-ins): { date, waist, hips, chest, thigh, arm, neck, notes },
// all in inches. A part you didn't measure is null ("not recorded"), never 0.
// The same validateMeasurement() checks the dialog and backup files, so the rules can't drift.

const MEASURE_SITES = [
  { key: "waist", label: "Waist" },
  { key: "hips", label: "Hips" },
  { key: "chest", label: "Chest" },
  { key: "thigh", label: "Thigh" },
  { key: "arm", label: "Upper arm" },
  { key: "neck", label: "Neck" },
];
const MEASURE_MIN = 4; // inches: smaller than any adult neck or arm
const MEASURE_MAX = 90;
const MEASURE_DUE_DAYS = 14; // measuring every 2 weeks; after this the card reminds you

// 36.25 -> "36.25", 36.5 -> "36.5", 36 -> "36". Tapes read to ¼", so up to 2 decimals.
const formatInches = (n) => String(Math.round(n * 100) / 100);

// Raw form strings or backup values in, { measurement } or { error } out.
// toNumberOrNull (nutrition.js) turns "" into null and junk into NaN.
function validateMeasurement(raw) {
  if (!raw || typeof raw !== "object") return { error: "That measurement is unreadable." };
  if (!isValidISODate(raw.date)) return { error: "Choose a date." };
  const measurement = { date: raw.date };
  for (const site of MEASURE_SITES) {
    const value = toNumberOrNull(raw[site.key]);
    if (Number.isNaN(value)) return { error: `${site.label} must be a number.` };
    if (value !== null && (value < MEASURE_MIN || value > MEASURE_MAX)) {
      return { error: `${site.label} should be between ${MEASURE_MIN} and ${MEASURE_MAX} inches.` };
    }
    measurement[site.key] = value === null ? null : Math.round(value * 100) / 100;
  }
  if (MEASURE_SITES.every((s) => measurement[s.key] === null)) return { error: "Enter at least one measurement." };
  measurement.notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, 200) : "";
  return { measurement };
}

// For each part you've measured at least once, oldest to newest records in:
//   { key, label, latest, latestDate, change }  (change = latest − your first value; 0 with one value)
// Parts never measured are left out.
function measurementProgress(records) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const result = [];
  for (const site of MEASURE_SITES) {
    const values = sorted.filter((r) => r[site.key] !== null && r[site.key] !== undefined);
    if (!values.length) continue;
    const first = values[0][site.key];
    const last = values.at(-1);
    result.push({ key: site.key, label: site.label, latest: last[site.key], latestDate: last.date, change: last[site.key] - first });
  }
  return result;
}

// Days since your latest measurement, or null with none.
function daysSinceMeasured(records, today) {
  if (!records.length) return null;
  const latest = records.reduce((a, b) => (a.date > b.date ? a : b)).date;
  return dayNumber(today) - dayNumber(latest);
}
