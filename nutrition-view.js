// Draws the Nutrition card and handles the meal dialog.
// This file loads before app.js but uses its helpers ($, showError, formatDate, todayISO).
// That works because nothing here runs until app.js calls setupNutrition() during startup,
// and by then every script has loaded.

const nutrition = { day: null, meals: [], editingId: null, targets: null }; // targets: your saved settings

const formatAmount = (value, decimals) => value.toLocaleString(undefined, { maximumFractionDigits: decimals });

function dayLabel(iso) {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === shiftDay(today, -1)) return "Yesterday";
  return formatDate(iso);
}

// Load one day's meals from the database, then redraw the card.
async function loadMealDay(day) {
  nutrition.day = day;
  nutrition.meals = await db.getMealsByDate(day);
  nutrition.meals.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // order you logged them
  renderNutrition();
}

// ---------- Rendering ----------
function renderNutrition() {
  if (!nutrition.day) return; // nutrition hasn't started yet (see setupNutrition)
  $("n-day").textContent = dayLabel(nutrition.day);
  $("n-next").disabled = nutrition.day >= todayISO(); // no logging meals in the future
  renderTotals(dailyTotals(nutrition.meals), dayTargets());
  renderMeals(nutrition.meals);
}

// The shown day's targets, worked out from your weight up to that day, or null if there are
// no target settings or no weigh-in yet. state.entries lives in app.js.
function dayTargets() {
  const note = $("n-targets-note");
  const weight = targetWeight(state.entries, nutrition.day);
  if (!nutrition.targets || weight === null) {
    note.textContent = state.entries.length ? "" : "Log a weigh-in to see your eating targets.";
    note.hidden = !note.textContent;
    return null;
  }
  const t = dailyTargets(nutrition.targets, weight);
  note.textContent = `Targets for ${weight.toFixed(1)} lb (7-day average)` +
    (nutrition.targets.deficit ? ` · TDEE ${formatAmount(t.tdee, 0)} − ${formatAmount(nutrition.targets.deficit, 0)} deficit` : "");
  note.hidden = false;
  return t;
}

function renderTotals(totals, targets) {
  const grid = $("n-totals");
  grid.innerHTML = "";
  for (const n of NUTRIENTS) {
    const { total, missing } = totals[n.key];
    const tile = document.createElement("div");
    tile.className = "total";
    tile.innerHTML = `<p class="label"></p><p class="total-value"></p>`;
    tile.querySelector(".label").textContent = n.label;
    const value = tile.querySelector(".total-value");
    if (totals.count - missing === 0) {
      value.textContent = "--"; // no meal that day recorded this nutrient
    } else {
      value.textContent = formatAmount(total, n.decimals);
      const unit = document.createElement("small");
      unit.textContent = n.unit;
      value.append(unit);
      if (missing > 0) {
        // Some meals skipped this nutrient, so the real total is higher than shown.
        const note = document.createElement("span");
        note.className = "partial";
        note.textContent = `${missing} untracked`;
        tile.append(note);
      }
    }
    const target = targets?.[n.key];
    if (target) tile.append(...targetLine(n.key, target, totals.count - missing === 0 ? 0 : total));
    grid.append(tile);
  }
}

// "of 144–180" plus a thin bar in the nutrient's own color (see styles.css).
// The text says where you stand: "✓" once in range, "over" (in amber) past the top.
// Sodium is a limit: "limit 2,000", with no ✓ (staying under is the point, not reaching it).
// Fiber has a floor: under the goal but past the floor says "floor ✓".
function targetLine(key, target, total) {
  const line = document.createElement("p");
  const range = target.range;
  let status = targetStatus(total, range);
  const amount = target.span ? `${formatAmount(range[0], 0)}–${formatAmount(range[1], 0)}` : formatAmount(target.goal, 0);
  let suffix = { under: "", in: " ✓", over: " · over" }[status];
  if (target.limit && status === "in") suffix = "";
  if (target.floor !== undefined && status === "under" && total >= target.floor) {
    status = "floor";
    suffix = " · floor ✓";
  }
  line.className = "target " + status;
  line.textContent = (target.limit ? "limit " : "of ") + amount + suffix;
  const bar = document.createElement("div");
  bar.className = "tbar";
  const fill = document.createElement("div");
  fill.className = `tbar-fill fill-${key}`;
  fill.style.width = Math.min(100, (total / target.goal) * 100) + "%";
  bar.append(fill);
  line.title = target.limit
    ? (status === "over" ? "Over your daily limit" : "Under your daily limit")
    : { under: "Under target", floor: "Past the floor, under the goal", in: "In target range", over: "Over target" }[status];
  return [line, bar];
}

// "P 42g · C 70g · F 18g", skipping any that weren't recorded
function macroSummary(meal) {
  return [["P", "protein"], ["C", "carbs"], ["F", "fat"]]
    .filter(([, key]) => meal[key] !== null)
    .map(([letter, key]) => `${letter} ${formatAmount(meal[key], 1)}g`)
    .join(" · ");
}

function renderMeals(meals) {
  const list = $("meals");
  list.innerHTML = "";
  $("meals-empty").hidden = meals.length > 0;
  meals.forEach((meal) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="entry-main"><span class="meal-name"></span><span class="note"></span></div>
      <span class="entry-value"></span>
      <div class="entry-actions">
        <button class="link" data-action="edit" type="button">Edit</button>
        <button class="link" data-action="delete" type="button">Delete</button>
      </div>`;
    li.dataset.id = meal.id;
    li.querySelector(".meal-name").textContent = meal.description; // textContent keeps user text safe
    li.querySelector(".note").textContent = [macroSummary(meal), meal.notes].filter(Boolean).join(" — ");
    li.querySelector(".entry-value").textContent = `${formatAmount(meal.calories, 0)} kcal`;
    list.append(li);
  });
}

// ---------- Meal dialog ----------
// Pass a meal to edit it, or nothing to add a new one.
function openMealDialog(meal) {
  nutrition.editingId = meal ? meal.id : null;
  $("meal-title").textContent = meal ? "Edit meal" : "Add meal";
  $("m-submit").textContent = meal ? "Update meal" : "Save meal";
  $("m-date").value = meal ? meal.date : nutrition.day;
  $("m-date").max = todayISO();
  $("m-description").value = meal?.description ?? "";
  for (const n of NUTRIENTS) $(`m-${n.key}`).value = meal?.[n.key] ?? ""; // null shows as empty
  $("m-notes").value = meal?.notes ?? "";
  showError("meal-error", "");
  $("meal-dialog").showModal();
}

// Collect the form into a raw object and run it through the shared validator.
function readMealForm() {
  // A number field holding text like "12abc" reports value "" (looks empty!), so check first.
  const bad = NUTRIENTS.find((n) => $(`m-${n.key}`).validity.badInput);
  if (bad) return { error: `${bad.label} must be a number.` };

  const existing = nutrition.meals.find((m) => m.id === nutrition.editingId);
  const raw = {
    id: existing ? existing.id : crypto.randomUUID(),
    createdAt: existing?.createdAt, // keep the original order when editing
    date: $("m-date").value,
    description: $("m-description").value,
    notes: $("m-notes").value,
  };
  for (const n of NUTRIENTS) raw[n.key] = $(`m-${n.key}`).value;
  return validateMeal(raw, todayISO());
}

// ---------- Event listeners (attached once, from app.js startup) ----------
function setupNutrition() {
  nutrition.day = todayISO();

  $("n-prev").addEventListener("click", () => loadMealDay(shiftDay(nutrition.day, -1)));
  $("n-next").addEventListener("click", () => loadMealDay(shiftDay(nutrition.day, 1)));
  $("add-meal-btn").addEventListener("click", () => openMealDialog(null));
  setupTargets();
  $("m-cancel").addEventListener("click", () => $("meal-dialog").close());

  $("meal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { meal, error } = readMealForm();
    if (error) return showError("meal-error", error);
    try {
      await db.saveMeal(meal);
    } catch (err) {
      return showError("meal-error", "Couldn't save: " + err.message);
    }
    $("meal-dialog").close();
    await loadMealDay(meal.date); // jump to the meal's day, in case you changed the date
    await loadTrends();
    await refreshInsights();
  });

  // One listener for every Edit/Delete button in the list (event delegation).
  $("meals").addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    const meal = nutrition.meals.find((m) => m.id === event.target.closest("li")?.dataset.id);
    if (!action || !meal) return;
    if (action === "edit") return openMealDialog(meal);
    if (!confirm(`Delete "${meal.description}"?`)) return;
    await db.deleteMeal(meal.id);
    await loadMealDay(nutrition.day);
    await loadTrends();
    await refreshInsights();
  });
}

// ---------- Eating targets ----------
// Load your target settings. The first time there's a weigh-in, start from the defaults in
// targets.js, with "calculated at" set to today's 7-day average, and save them.
async function loadTargets() {
  const saved = await db.getMeta("targets");
  nutrition.targets = saved ? withTargetDefaults(saved.value) : null;
  if (!nutrition.targets) {
    const weight = targetWeight(state.entries, todayISO());
    if (weight !== null) {
      nutrition.targets = { ...TARGET_DEFAULTS, tdeeWeight: weight };
      await db.saveMeta("targets", nutrition.targets);
    }
  }
  renderNutrition();
}

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
  const weight = targetWeight(state.entries, todayISO());
  if (error || weight === null) {
    preview.textContent = weight === null ? "Log a weigh-in to see your targets." : "";
    return;
  }
  const t = dailyTargets(settings, weight);
  const span = (x) => `${formatAmount(x.range[0], 0)}–${formatAmount(x.range[1], 0)}`;
  preview.textContent = `Today, at ${weight.toFixed(1)} lb: ${formatAmount(t.calories.goal, 0)} kcal · ` +
    `fat ${t.fat.goal} g · protein ${span(t.protein)} g · carbs ${span(t.carbs)} g · ` +
    `fiber ${span(t.fiber)} g (floor ${t.fiber.floor}) · sodium under ${formatAmount(t.sodium.goal, 0)} mg`;
}

function openTargetsDialog() {
  const current = nutrition.targets ?? withTargetDefaults({ tdeeWeight: targetWeight(state.entries, todayISO()) });
  for (const f of TARGET_FIELDS) $(`tg-${f.key}`).value = current[f.key] ?? "";
  showError("targets-error", "");
  renderTargetsPreview();
  $("targets-dialog").showModal();
}

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
      await db.saveMeta("targets", settings);
    } catch (err) {
      return showError("targets-error", "Couldn't save: " + err.message);
    }
    nutrition.targets = settings;
    $("targets-dialog").close();
    renderNutrition();
  });
}
