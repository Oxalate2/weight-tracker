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
  $("n-day").textContent = dayLabel(nutrition.day);
  $("n-next").disabled = nutrition.day >= todayISO(); // no logging meals in the future
  renderTotals(dailyTotals(nutrition.meals));
  renderMeals(nutrition.meals);
}

function renderTotals(totals) {
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
    grid.append(tile);
  }
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
  });
}
