// Page code for your eating targets: loading the settings, the Settings-tab summary and edit
// dialog, and the target wording (targetAmount, STATUS_TEXT) the Today tab's bars use.
// The maths is in targets.js. Like the other view files, this uses helpers from other files
// ($, showError, todayISO, formatAmount, state) only inside functions that run after startup.

let targetSettings = null; // your saved settings, or null until you set up your targets
let targetProfile = null; // your stats (sex, birth year, height, activity), or null if never entered

// ---------- Loading ----------
// Read your saved settings and stats. Run at startup and after a backup import.
async function loadTargets() {
  const [saved, profile] = await Promise.all([db.getMeta("targets"), db.getMeta("profile")]);
  targetSettings = saved ? withTargetDefaults(saved.value) : null;
  targetProfile = profile ? validateProfile(profile.value, thisYear()).profile ?? null : null;
  ensureTargets();
}

const thisYear = () => Number(todayISO().slice(0, 4));

// Redraw what shows your targets. Run after any weigh-in change (your targets follow your weight).
// Targets are never created for you: until you set them up from your stats, the Nutrition card
// shows a "Set up your targets" button instead.
function ensureTargets() {
  renderNutrition();
  renderTargetsSummary();
  renderSetupPrompt();
}

// The Nutrition card's button, once you have a weigh-in but no targets.
function renderSetupPrompt() {
  $("n-setup-btn").hidden = Boolean(targetSettings) || state.entries.length === 0;
}

// ---------- Showing a target ----------
// "144–180" for a range, "2,000" for a single number or a limit.
function targetAmount(target) {
  const [low, high] = target.range;
  return target.kind === "range" ? `${formatAmount(low, 0)}–${formatAmount(high, 0)}` : formatAmount(target.goal, 0);
}

// What the line says after the amount, and its hover text, for each status (see targetStatus).
const STATUS_TEXT = {
  under: { suffix: "", title: "Under target" },
  floor: { suffix: " · floor ✓", title: "Past the floor, under the goal" },
  in: { suffix: " ✓", title: "In target range" },
  over: { suffix: " · over", title: "Over target" },
};
// A limit is about staying under it, so being under gets no ✓.
const LIMIT_TEXT = {
  in: { suffix: "", title: "Under your daily limit" },
  over: { suffix: " · over", title: "Over your daily limit" },
};

// The Settings rows' summaries: your stats and what your targets are set to.
function renderTargetsSummary() {
  const t = targetSettings;
  $("targets-default-note").hidden = !t || !isOldDefault(t, targetProfile);
  $("targets-summary").textContent = !t ? "Not set up yet" :
    `TDEE ${formatAmount(t.tdee, 0)}` + (t.deficit ? ` − ${formatAmount(t.deficit, 0)}` : "") +
    ` · protein ${t.proteinLow}–${t.proteinHigh} g/lb · fat ${t.fatPerLb} g/lb`;
  const p = targetProfile;
  const activity = ACTIVITY_LEVELS.find((a) => a.key === p?.activity);
  $("stats-summary").textContent = !p ? "Not entered yet" : [
    p.sex === "male" ? "Male" : "Female",
    ageIn(p, thisYear()),
    `${Math.floor(p.heightIn / 12)}′${Math.round((p.heightIn % 12) * 10) / 10}″`,
    activity ? activity.label.split(":")[0] : "",
  ].filter(Boolean).join(" · ");
}

// ---------- Targets dialog ----------
function readTargetsForm() {
  const raw = {};
  for (const f of TARGET_FIELDS) {
    if ($(`tg-${f.key}`).validity.badInput) return { error: `${f.label} must be a number.` };
    raw[f.key] = $(`tg-${f.key}`).value;
  }
  return validateTargets(raw);
}

// Live preview of today's targets while you edit the numbers.
function renderTargetsPreview() {
  const preview = $("tg-preview");
  const { settings, error } = readTargetsForm();
  const weight = averageWeightOn(state.entries, todayISO());
  if (error || weight === null) {
    preview.textContent = weight === null ? "Log a weigh-in to see your targets." : "";
    return;
  }
  const t = dailyTargets(settings, weight);
  preview.textContent = `Today, at ${weight.toFixed(1)} lb: ${targetAmount(t.calories)} kcal · ` +
    `fat ${targetAmount(t.fat)} g · protein ${targetAmount(t.protein)} g · carbs ${targetAmount(t.carbs)} g · ` +
    `fiber ${targetAmount(t.fiber)} g (floor ${t.fiber.floor}) · sodium under ${targetAmount(t.sodium)} mg`;
}

// With no targets yet, Edit opens the setup from your stats instead.
function openTargetsDialog() {
  if (!targetSettings) return openSetupDialog();
  for (const f of TARGET_FIELDS) $(`tg-${f.key}`).value = targetSettings[f.key] ?? "";
  showError("targets-error", "");
  renderTargetsPreview();
  $("targets-dialog").showModal();
}

// ---------- Setup from your stats ----------
// First time: your targets from your stats. Later ("Recalculate from my stats" in the targets
// dialog): a new TDEE and per-lb change from your stats, with your other settings kept.
function openSetupDialog() {
  const p = targetProfile;
  $("su-sex").value = p?.sex ?? "";
  $("su-age").value = p ? ageIn(p, thisYear()) : "";
  $("su-ft").value = p ? Math.floor(p.heightIn / 12) : "";
  $("su-in").value = p ? Math.round((p.heightIn % 12) * 10) / 10 : "";
  $("su-activity").value = p?.activity ?? "";
  const weight = averageWeightOn(state.entries, todayISO());
  $("su-weight").value = weight === null ? "" : weight.toFixed(1);
  $("su-deficit").value = targetSettings?.deficit ?? 0;
  $("setup-title").textContent = targetSettings ? "Recalculate your TDEE" : "Set up your targets";
  showError("setup-error", "");
  renderSetupPreview();
  $("setup-dialog").showModal();
}

// { profile, settings, tdee } or { error }, from the form.
function readSetupForm() {
  for (const id of ["su-age", "su-ft", "su-in", "su-weight", "su-deficit"]) {
    if ($(id).validity.badInput) return { error: "Use numbers only." };
  }
  const ft = $("su-ft").value, inches = $("su-in").value;
  const heightIn = ft === "" && inches === "" ? "" : Number(ft || 0) * 12 + Number(inches || 0);
  const { profile, error } = validateProfile({
    sex: $("su-sex").value, age: $("su-age").value, heightIn, activity: $("su-activity").value,
  }, thisYear());
  if (error) return { error };
  const weight = Number($("su-weight").value);
  if ($("su-weight").value === "" || !(weight >= 50 && weight <= 700)) return { error: "Enter your weight (50–700 lb)." };
  const result = targetsFromProfile(profile, weight, $("su-deficit").value, targetSettings ?? {}, thisYear());
  if (result.error) return { error: result.error };
  return { profile, settings: result.settings };
}

function renderSetupPreview() {
  const preview = $("su-preview");
  const { settings, error } = readSetupForm();
  if (error) { preview.textContent = ""; return; }
  const t = dailyTargets(settings, settings.tdeeWeight);
  preview.textContent = `Estimated TDEE ≈ ${formatAmount(settings.tdee, 0)} kcal at ${settings.tdeeWeight.toFixed(1)} lb, ` +
    `changing ${settings.kcalPerLb} kcal per lb. Today: ${targetAmount(t.calories)} kcal · fat ${targetAmount(t.fat)} g · ` +
    `protein ${targetAmount(t.protein)} g · carbs ${targetAmount(t.carbs)} g.`;
}

// ---------- Event listeners (attached once, from app.js startup) ----------
function setupTargets() {
  $("targets-btn").addEventListener("click", openTargetsDialog);
  for (const a of ACTIVITY_LEVELS) $("su-activity").add(new Option(a.label, a.key));
  $("n-setup-btn").addEventListener("click", openSetupDialog);
  $("stats-btn").addEventListener("click", openSetupDialog);
  $("tg-recalc").addEventListener("click", () => {
    $("targets-dialog").close();
    openSetupDialog();
  });
  $("su-cancel").addEventListener("click", () => $("setup-dialog").close());
  $("setup-form").addEventListener("input", () => {
    showError("setup-error", "");
    renderSetupPreview();
  });
  $("setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { profile, settings, error } = readSetupForm();
    if (error) return showError("setup-error", error);
    try {
      await db.saveMeta("profile", profile);
      targetProfile = profile;
      await saveTargetSettings(settings);
    } catch (err) {
      return showError("setup-error", "Couldn't save: " + err.message);
    }
    $("setup-dialog").close();
  });
  $("tg-cancel").addEventListener("click", () => $("targets-dialog").close());
  $("targets-form").addEventListener("input", () => {
    showError("targets-error", "");
    renderTargetsPreview();
  });
  $("targets-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { settings, error } = readTargetsForm();
    if (error) return showError("targets-error", error);
    try {
      await saveTargetSettings(settings);
    } catch (err) {
      return showError("targets-error", "Couldn't save: " + err.message);
    }
    $("targets-dialog").close();
  });
}

// Save new settings (already checked by validateTargets) and redraw everything that shows them.
// Used by the dialog and by "Use measured maintenance" on the Trends tab.
async function saveTargetSettings(settings) {
  await db.saveMeta("targets", settings);
  targetSettings = settings;
  ensureTargets();
  await refreshInsights(); // the calibration line compares against your settings
}
