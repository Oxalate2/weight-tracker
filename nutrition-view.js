// Draws the Nutrition card and handles the meal dialog.
// This file loads before app.js but uses its helpers ($, showError, formatDate, todayISO).
// That works because nothing here runs until app.js calls setupNutrition() during startup,
// and by then every script has loaded.

const nutrition = { day: null, meals: [], editingId: null };

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
  $("n-date").textContent = longDate(nutrition.day);
  $("n-next").disabled = nutrition.day >= todayISO(); // no logging meals in the future
  renderTotals(dailyTotals(nutrition.meals), dayTargets());
  renderMeals(nutrition.meals);
}

// "Sunday, November 22"
function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// The shown day's targets, worked out from your weight up to that day, or null if there are
// no target settings or no weigh-in yet. targetSettings is in targets-view.js.
function dayTargets() {
  const note = $("n-targets-note");
  const weight = averageWeightOn(state.entries, nutrition.day);
  if (!targetSettings || weight === null) {
    note.textContent = state.entries.length ? "" : "Log a weigh-in to see your eating targets.";
    note.hidden = !note.textContent;
    return null;
  }
  const t = dailyTargets(targetSettings, weight);
  note.textContent = `Targets for ${weight.toFixed(1)} lb, your 7-day average` +
    (targetSettings.deficit ? ` · TDEE ${formatAmount(t.tdee, 0)} − ${formatAmount(targetSettings.deficit, 0)} deficit` : "");
  note.hidden = false;
  return t;
}

// The calorie ring, protein/carbs/fat beside it, and fiber, sodium and added sugar in their own tile.
function renderTotals(totals, targets) {
  renderCalorieRing(totals, targets);
  const macros = $("n-macros");
  const extras = $("n-extras");
  macros.innerHTML = "";
  extras.innerHTML = "";
  for (const n of NUTRIENTS) {
    if (n.key === "calories") continue;
    const mini = !["protein", "carbs", "fat"].includes(n.key); // the small tile puts the target on its own line
    (mini ? extras : macros).append(nutrientBar(n, totals, targets?.[n.key], mini));
  }
}

function renderCalorieRing(totals, targets) {
  const { total, missing } = totals.calories;
  const ring = $("cal-ring");
  const target = targets?.calories;
  ring.classList.remove("over");
  if (!target) {
    $("cal-num").textContent = formatAmount(total, 0);
    $("cal-unit").textContent = "kcal eaten";
    setRing(ring, 0);
  } else {
    const left = target.goal - total;
    ring.classList.toggle("over", targetStatus(total, target) === "over");
    $("cal-num").textContent = formatAmount(Math.abs(left), 0);
    $("cal-unit").textContent = left >= 0 ? "kcal left" : "kcal over";
    setRing(ring, total / target.goal);
  }
  const sub = target ? `${formatAmount(total, 0)} eaten of ${formatAmount(target.goal, 0)}`
    : totals.count ? plural(totals.count, "meal") : "Nothing logged yet";
  $("cal-sub").textContent = sub + (missing > 0 ? ` · ${missing} without calories` : "");
}

// "Protein   142 / 144–180 g" over a bar in the nutrient's color. Without a target, just the amount.
function nutrientBar(n, totals, target, mini = false) {
  const { total, missing } = totals[n.key];
  const recorded = totals.count - missing > 0; // at least one meal that day recorded it
  const el = document.createElement("div");
  el.className = "nbar";
  el.innerHTML = `<div class="nbar-top"><span></span><span class="nbar-val"></span></div>`;
  el.querySelector("span").textContent = n.label;
  const val = el.querySelector(".nbar-val");
  val.textContent = recorded ? formatAmount(total, n.decimals) : "--";
  const small = document.createElement("small");
  if (target) {
    const status = targetStatus(recorded ? total : 0, target);
    const text = (target.kind === "limit" ? LIMIT_TEXT : STATUS_TEXT)[status]; // see targets-view.js
    el.classList.add(status);
    el.title = text.title;
    const lead = target.kind === "limit" ? (mini ? "under " : " / under ") : mini ? "of " : " / ";
    small.textContent = lead + targetAmount(target) + " " + n.unit;
    small.className = "of";
    const track = document.createElement("span");
    track.className = "track";
    const fill = document.createElement("span");
    fill.className = `fill-${n.key}`;
    fill.style.width = Math.min(100, ((recorded ? total : 0) / target.goal) * 100) + "%";
    track.append(fill);
    val.append(small);
    el.append(track);
  } else {
    small.textContent = " " + n.unit;
    if (recorded) val.append(small);
  }
  if (recorded && missing > 0) {
    // Some meals skipped this nutrient, so the real total is higher than shown.
    const note = document.createElement("span");
    note.className = "partial";
    note.textContent = `${missing} ${missing === 1 ? "meal" : "meals"} untracked`;
    el.append(note);
  }
  return el;
}

// "P 42g · C 70g · F 18g", skipping any that weren't recorded
function macroSummary(meal) {
  return [["P", "protein"], ["C", "carbs"], ["F", "fat"]]
    .filter(([, key]) => meal[key] !== null)
    .map(([letter, key]) => `${letter} ${formatAmount(meal[key], 1)}g`)
    .join(" · ");
}

// "12:40 PM", from when you logged it; nothing for a meal added on a later day
function mealTime(meal) {
  const at = new Date(meal.createdAt);
  if (at.toLocaleDateString("en-CA") !== meal.date) return "";
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Tap a meal to edit or delete it.
function renderMeals(meals) {
  const list = $("meals");
  list.innerHTML = "";
  $("meals-empty").hidden = meals.length > 0;
  meals.forEach((meal) => {
    list.append(listRow({
      icon: "meal",
      title: meal.description,
      sub: [mealTime(meal), macroSummary(meal), meal.notes].filter(Boolean).join(" · "),
      meta: `${formatAmount(meal.calories, 0)} kcal`,
      open: () => openMealDialog(meal),
    }));
  });
}

// ---------- Meal dialog ----------
// Pass a meal to edit it, or nothing to add a new one.
function openMealDialog(meal) {
  nutrition.editingId = meal ? meal.id : null;
  $("meal-title").textContent = meal ? "Edit meal" : "Add meal";
  $("m-submit").textContent = meal ? "Update meal" : "Save meal";
  $("m-delete").hidden = !meal;
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

  // Delete, from inside the edit dialog.
  $("m-delete").addEventListener("click", async () => {
    const meal = nutrition.meals.find((m) => m.id === nutrition.editingId);
    if (!meal || !confirm(`Delete "${meal.description}"?`)) return;
    await db.deleteMeal(meal.id);
    $("meal-dialog").close();
    await loadMealDay(nutrition.day);
    await loadTrends();
    await refreshInsights();
  });
}
