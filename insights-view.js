// Draws the "Weight vs. nutrition" card. Uses helpers from app.js ($, state, todayISO,
// plural, signed) and nutrition-view.js (formatAmount) only at runtime, after startup.

// Reload the meals it needs and redraw. Safe to call after any weight or meal change:
// it catches its own errors, so a problem here can never break the rest of the page.
async function refreshInsights() {
  try {
    const today = todayISO();
    const meals = await db.getMealsBetween(shiftDay(today, -INSIGHT_DAYS), shiftDay(today, -1));
    renderInsights(estimateMaintenance(state.entries, meals, today), weeklySummary(state.entries, meals, today, 4));
  } catch (err) {
    console.error(err);
    $("i-detail").textContent = "Couldn't calculate this: " + err.message;
  }
}

function renderInsights(est, weeks) {
  const value = $("i-value");
  if (est.ready) {
    value.textContent = "≈ " + formatAmount(est.maintenance, 0);
    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = "kcal/day";
    value.append(unit);
    $("i-detail").textContent =
      `Last ${INSIGHT_DAYS} days: you ate ${formatAmount(Math.round(est.avgIntake), 0)} kcal a day ` +
      `(${plural(est.loggedDays, "day")} logged) and ${weightDirection(est.lbPerWeek)}.`;
  } else {
    value.textContent = "--";
    $("i-detail").textContent = "Not enough data yet. To see an estimate, " + missingSteps(est) + ".";
  }
  renderWeeks(weeks);
}

function weightDirection(lbPerWeek) {
  if (Math.abs(lbPerWeek) < 0.05) return "held steady";
  return `${lbPerWeek < 0 ? "lost" : "gained"} ${Math.abs(lbPerWeek).toFixed(1)} lb/week`;
}

// "log meals on 3 more days and weigh in 2 more times"
function missingSteps(est) {
  const steps = [];
  if (est.loggedDays < MIN_LOGGED_DAYS) steps.push(`log meals on ${plural(MIN_LOGGED_DAYS - est.loggedDays, "more day")}`);
  if (est.weighIns < MIN_WEIGH_INS) {
    const more = MIN_WEIGH_INS - est.weighIns;
    steps.push(`weigh in ${more} more ${more === 1 ? "time" : "times"}`);
  } else if (est.spanDays < MIN_WEIGH_SPAN) {
    steps.push(`keep weighing in so your weigh-ins cover ${MIN_WEIGH_SPAN} days (now ${est.spanDays})`);
  }
  return steps.join(" and ");
}

// "Nov 7–13", or "Oct 31–Nov 6" when the week crosses a month
function weekLabel(start, end) {
  const fmt = (iso, opts) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  };
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${fmt(start, { month: "short", day: "numeric" })}–${fmt(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
}

function renderWeeks(weeks) {
  const body = $("i-weeks");
  body.innerHTML = "";
  for (const w of weeks) {
    const row = document.createElement("tr");
    row.innerHTML = `<td></td><td class="num"></td><td class="num"></td>`;
    const [week, kcal, weight] = row.children;
    week.textContent = weekLabel(w.start, w.end);
    kcal.textContent = w.avgCalories === null ? "--" : formatAmount(Math.round(w.avgCalories), 0);
    const days = document.createElement("small");
    days.textContent = ` · ${w.loggedDays}d`;
    kcal.append(days);
    weight.textContent = w.change === null ? "--" : signed(w.change);
    body.append(row);
  }
}
