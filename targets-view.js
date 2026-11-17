// Page code for your eating targets: loading the settings, the Settings-tab summary and edit
// dialog, and targetLine(), which the Nutrition card uses under each nutrient.
// The maths is in targets.js. Like the other view files, this uses helpers from other files
// ($, showError, todayISO, formatAmount, state) only inside functions that run after startup.

let targetSettings = null; // your saved settings, or null before your first weigh-in

// ---------- Loading ----------
// Read your saved settings. Run at startup and after a backup import.
async function loadTargets() {
  const saved = await db.getMeta("targets");
  targetSettings = saved ? withTargetDefaults(saved.value) : null;
  await ensureTargets();
}

// Your first weigh-in starts your targets: the defaults from targets.js, "calculated at"
// today's 7-day average. Then redraw what shows them. Run after any weigh-in change.
async function ensureTargets() {
  if (!targetSettings) {
    const weight = averageWeightOn(state.entries, todayISO());
    if (weight !== null) {
      const settings = { ...TARGET_DEFAULTS, tdeeWeight: weight };
      await db.saveMeta("targets", settings); // saved first, so the page never shows unsaved targets
      targetSettings = settings;
    }
  }
  renderNutrition();
  renderTargetsSummary();
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

// "of 144–180 ✓" or "limit 2,000", plus a thin bar in the nutrient's own color (styles.css).
function targetLine(key, target, total) {
  const status = targetStatus(total, target);
  const text = (target.kind === "limit" ? LIMIT_TEXT : STATUS_TEXT)[status];
  const line = document.createElement("p");
  line.className = "target " + status;
  line.textContent = (target.kind === "limit" ? "limit " : "of ") + targetAmount(target) + text.suffix;
  line.title = text.title;
  const bar = document.createElement("div");
  bar.className = "tbar";
  const fill = document.createElement("div");
  fill.className = `tbar-fill fill-${key}`;
  fill.style.width = Math.min(100, (total / target.goal) * 100) + "%";
  bar.append(fill);
  return [line, bar];
}

// One line on the Settings tab: what your targets are set to.
function renderTargetsSummary() {
  const t = targetSettings;
  $("targets-summary").textContent = !t ? "Set after your first weigh-in" :
    `TDEE ${formatAmount(t.tdee, 0)} kcal` + (t.deficit ? ` − ${formatAmount(t.deficit, 0)}` : "") +
    ` · fat ${t.fatPerLb} g/lb · protein ${t.proteinLow}–${t.proteinHigh} g/lb` +
    ` · fiber ${t.fiberLow}–${t.fiberHigh} g · sodium ≤ ${formatAmount(t.sodiumLimit, 0)} mg`;
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

function openTargetsDialog() {
  const current = targetSettings ?? withTargetDefaults({ tdeeWeight: averageWeightOn(state.entries, todayISO()) });
  for (const f of TARGET_FIELDS) $(`tg-${f.key}`).value = current[f.key] ?? "";
  showError("targets-error", "");
  renderTargetsPreview();
  $("targets-dialog").showModal();
}

// ---------- Event listeners (attached once, from app.js startup) ----------
function setupTargets() {
  $("targets-btn").addEventListener("click", openTargetsDialog);
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
  renderNutrition();
  renderTargetsSummary();
  await refreshInsights(); // the calibration line compares against your settings
}
