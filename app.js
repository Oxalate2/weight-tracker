// Phase 2: load data from IndexedDB, render, and handle the form.

const state = { entries: [], goals: null, editingDate: null, range: "90D", tab: "today" };
const $ = (id) => document.getElementById(id);

// ---------- Helpers ----------
const round1 = (n) => Math.round(n * 10) / 10;
const todayISO = () => new Date().toLocaleDateString("en-CA"); // local date as YYYY-MM-DD
const plural = (n, word) => `${n} ${n === 1 ? word : word + "s"}`; // plural(1, "meal") -> "1 meal"
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(round1(n)).toFixed(1) + " lb";

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// "Nov 17"
function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function progressPercent(start, current, goal) {
  if (start === goal) return 0;
  return Math.max(0, Math.min(100, ((start - current) / (start - goal)) * 100));
}

function setText(name, value) {
  document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => (el.textContent = value));
}

// Inline icons for list rows (the same line style as the tab bar's)
const ICON = {
  meal: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9a5 5 0 0 1 8 0"/><path d="M12 9l1.5-2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};
const svgIcon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

// One list row: icon, title, subtitle, and a value on the right. With `open`, the whole row is
// a button that opens it for editing. Text goes in with textContent, so user text stays safe.
function listRow({ icon, title, sub, meta, metaNote, metaNoteClass, open }) {
  const li = document.createElement("li");
  const row = document.createElement(open ? "button" : "div");
  row.className = "row";
  if (open) {
    row.type = "button";
    row.addEventListener("click", open);
  }
  row.innerHTML = `<span class="row-icon">${svgIcon(icon)}</span>
    <span class="row-text"><span class="row-title"></span><span class="row-sub"></span></span>
    <span class="row-meta"></span>`;
  row.querySelector(".row-title").textContent = title;
  const subEl = row.querySelector(".row-sub");
  if (sub) subEl.textContent = sub; else subEl.remove();
  const metaEl = row.querySelector(".row-meta");
  metaEl.textContent = meta ?? "";
  if (metaNote) {
    const small = document.createElement("small");
    small.textContent = metaNote;
    if (metaNoteClass) small.className = metaNoteClass;
    metaEl.append(small);
  }
  li.append(row);
  return li;
}

// Fill a ring (see .ring in styles.css) to a fraction from 0 to 1.
function setRing(el, fraction) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  el.style.setProperty("--p", pct.toFixed(2));
  el.toggleAttribute("data-empty", pct < 0.5);
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message || "";
  el.hidden = !message;
}

// ---------- Rendering ----------
function trendLabel(perWeek) {
  if (perWeek === null) return "--";
  if (Math.abs(perWeek) < 0.2) return "Steady";
  return signed(perWeek);
}

const sortedEntries = () => [...state.entries].sort((a, b) => a.date.localeCompare(b.date));

function render() {
  const entries = sortedEntries();
  const goals = state.goals;

  document.querySelectorAll("#ranges .chip").forEach((c) => c.classList.toggle("is-active", c.dataset.range === state.range));
  if (goals) {
    setText("start", goals.startWeight.toFixed(1));
    setText("goal", goals.goalWeight.toFixed(1));
  }
  renderEntries(entries);
  drawVisibleChart();
  if (entries.length === 0) {
    setText("sinceStart", "No weigh-ins yet");
    setText("remaining", "");
    return;
  }

  const today = dayNumber(todayISO());
  const latest = entries.at(-1);
  const daysAgo = today - dayNumber(latest.date);
  const week = changeOver(entries, 7, today);
  const month = changeOver(entries, 30, today);

  setText("current", latest.weight.toFixed(1));
  const avg = averageWeightOn(entries, todayISO());
  setText("todayWeightSub", (daysAgo === 0 ? "Logged today" : "Not logged today") +
    (avg === null ? "" : ` · avg ${avg.toFixed(1)}`));
  setText("weekChange", week === null ? "--" : signed(week));
  setText("monthChange", month === null ? "--" : signed(month));
  setText("trend", trendLabel(trendPerWeek(entries, today)));

  document.querySelectorAll('[data-bind="weekDelta"]').forEach((sub) => {
    sub.classList.remove("down", "up");
    if (daysAgo > 7) {
      sub.textContent = `Last weigh-in ${daysAgo} days ago`;
    } else if (week !== null) {
      sub.textContent = `${week <= 0 ? "▼" : "▲"} ${Math.abs(round1(week)).toFixed(1)} lb this week`;
      sub.classList.add(week < 0 ? "down" : "up");
    } else {
      sub.textContent = "Log more to see weekly change";
    }
  });

  if (goals) {
    const pct = progressPercent(goals.startWeight, latest.weight, goals.goalWeight);
    const since = round1(latest.weight - goals.startWeight);
    setText("sinceStart", since === 0 ? "Same as when you started"
      : `${since < 0 ? "Down" : "Up"} ${Math.abs(since).toFixed(1)} lb since you started`);
    const left = round1(Math.abs(latest.weight - goals.goalWeight));
    setText("remaining", pct >= 100 ? "Goal reached" : `${left.toFixed(1)} lb to go`);
    setText("percent", Math.round(pct) + "%");
    setRing($("goal-ring"), pct / 100);
    $("goal-ring").setAttribute("aria-valuenow", Math.round(pct));
  } else {
    setText("sinceStart", "Set a goal in Settings");
  }
}

// The last 10 weigh-ins, newest first. Tap one to edit or delete it.
function renderEntries(entries) {
  const list = $("entries");
  list.innerHTML = "";
  $("entries-empty").hidden = entries.length > 0;
  entries.slice(-10).reverse().forEach((e) => {
    list.append(listRow({
      icon: "scale", title: formatDate(e.date), sub: e.notes, meta: e.weight.toFixed(1) + " lb",
      open: () => openEntryDialog(e),
    }));
  });
}

// ---------- Log weight dialog ----------
// Pass an entry to edit it, or nothing to log a new one (like openMealDialog).
function openEntryDialog(entry = null) {
  state.editingDate = entry ? entry.date : null;
  $("form-title").textContent = entry ? "Edit entry" : "Log weight";
  $("f-submit").textContent = entry ? "Update entry" : "Save entry";
  $("f-date").value = entry ? entry.date : todayISO();
  $("f-date").disabled = Boolean(entry); // changing the date would create a different entry
  $("f-delete").hidden = !entry;
  $("f-weight").value = entry?.weight ?? "";
  $("f-notes").value = entry?.notes ?? "";
  showError("form-error", "");
  $("entry-dialog").showModal();
}

// Every "Log weight" button (Today and Weight tabs) opens the same dialog.
document.querySelectorAll('[data-action="log-weight"]').forEach((b) => b.addEventListener("click", () => openEntryDialog()));

// After any weigh-in is saved or deleted: reload, redraw, and update everything that
// follows your weight.
async function entriesChanged() {
  state.entries = await db.getEntries();
  render();
  await ensureTargets(); // your eating targets follow your weight (see targets-view.js)
  await refreshInsights();
}

function validateEntry(date, weight) {
  if (!date) return "Choose a date.";
  if (date > todayISO()) return "The date can't be in the future.";
  if (!Number.isFinite(weight)) return "Enter your weight as a number.";
  if (weight < 50 || weight > 700) return "Weight should be between 50 and 700 lb.";
  return "";
}

$("entry-form").addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the browser from reloading the page
  const date = $("f-date").value;
  const weight = parseFloat($("f-weight").value);
  const error = validateEntry(date, weight);
  if (error) return showError("form-error", error);

  // Duplicate guard: the date is the database key, so we check before overwriting.
  if (state.editingDate === null) {
    const existing = await db.getEntry(date);
    if (existing && !confirm(`You already logged ${existing.weight.toFixed(1)} lb on ${formatDate(date)}. Replace it?`)) return;
  }

  await db.saveEntry({ date, weight: round1(weight), notes: $("f-notes").value.trim() });
  $("entry-dialog").close();
  await entriesChanged();
});

$("f-cancel").addEventListener("click", () => $("entry-dialog").close());

// Delete, from inside the edit dialog.
$("f-delete").addEventListener("click", async () => {
  const date = state.editingDate;
  if (!date || !confirm(`Delete the entry for ${formatDate(date)}?`)) return;
  await db.deleteEntry(date);
  $("entry-dialog").close();
  await entriesChanged();
});

// ---------- Goals dialog ----------
function openGoals() {
  $("g-start").value = state.goals?.startWeight ?? "";
  $("g-goal").value = state.goals?.goalWeight ?? "";
  showError("goals-error", "");
  $("goals-dialog").showModal();
}

$("goals-btn").addEventListener("click", openGoals);
$("g-cancel").addEventListener("click", () => $("goals-dialog").close());

$("goals-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const startWeight = parseFloat($("g-start").value);
  const goalWeight = parseFloat($("g-goal").value);
  const valid = [startWeight, goalWeight].every((n) => Number.isFinite(n) && n >= 50 && n <= 700);
  if (!valid) return showError("goals-error", "Enter both weights between 50 and 700 lb.");
  if (startWeight === goalWeight) return showError("goals-error", "Start and goal weights must differ.");
  state.goals = { startWeight: round1(startWeight), goalWeight: round1(goalWeight) };
  await db.saveGoals(state.goals);
  $("goals-dialog").close();
  render();
});

// ---------- Tabs ----------
function showTab(name) {
  state.tab = name;
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  document.querySelectorAll("#tabbar .tab").forEach((t) => {
    if (t.dataset.tab === name) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  drawVisibleChart();
}

// A chart drawn while its tab is hidden comes out 0 px wide, so each chart is drawn only
// while its tab shows: when you switch to it, and on every redraw after that.
function drawVisibleChart() {
  if (state.tab === "weight") {
    renderChart(sortedEntries(), state.range);
    renderMeasureChart();
  }
  if (state.tab === "trends") renderTrends();
}

$("tabbar").addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) showTab(tab.dataset.tab);
});

// ---------- Range chips ----------
$("ranges").addEventListener("click", (event) => {
  const range = event.target.dataset.range;
  if (!range) return;
  state.range = range;
  render();
});

// ---------- Backup ----------
function setBackupMsg(text, ok = false) {
  const el = $("backup-msg");
  el.textContent = text || "";
  el.hidden = !text;
  el.classList.toggle("ok", ok);
}

async function renderBackupStatus() {
  const meta = await db.getMeta("lastBackup");
  const el = $("backup-status");
  if (!meta) {
    el.textContent = state.entries.length ? "No backup yet. Export one to keep your data safe." : "No backup yet.";
    return;
  }
  const localDay = new Date(meta.value).toLocaleDateString("en-CA");
  const age = dayNumber(todayISO()) - dayNumber(localDay);
  el.textContent = `Last backup: ${formatDate(localDay)}` + (age > 30 ? ". It's been a while. Export a new one." : "");
}

$("export-btn").addEventListener("click", async () => {
  try {
    if (await exportBackup()) setBackupMsg("Backup exported.", true);
  } catch (err) {
    setBackupMsg("Couldn't export: " + err.message);
  }
  renderBackupStatus();
});

$("import-btn").addEventListener("click", () => $("import-file").click());

$("import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const result = await importBackup(file);
    if (result) {
      state.goals = (await db.getGoals()) || null;
      await loadTargets(); // a backup can bring targets with it
      await entriesChanged();
      await loadMealDay(nutrition.day);
      await loadTrends();
      await loadMeasurements();
      const parts = [plural(result.count, "weigh-in"), plural(result.mealCount, "meal")];
      if (result.measurementCount) parts.push(measurementSets(result.measurementCount));
      setBackupMsg(`Imported ${listText(parts)} (${result.replaced} replaced).`, true);
    }
  } catch (err) {
    setBackupMsg(err.message);
  } finally {
    event.target.value = ""; // lets you pick the same file again
  }
});

// ---------- Startup ----------
// Start on the shortest range that has at least 2 entries, so the chart isn't empty on first view.
function pickDefaultRange(entries) {
  const today = dayNumber(todayISO());
  for (const key of ["30D", "90D", "6M", "1Y"]) {
    const start = today - (RANGE_DAYS[key] - 1); // same range the chart shows
    if (entries.filter((e) => dayNumber(e.date) >= start).length >= 2) return key;
  }
  return "All";
}

async function init() {
  // Weights first, so a problem in the nutrition cards can never hide your weigh-ins.
  const [entries, goals] = await Promise.all([db.getEntries(), db.getGoals()]);
  state.entries = entries;
  state.goals = goals || null;
  state.range = pickDefaultRange(entries);
  showTab("today"); // the app always opens on Today
  render();
  renderBackupStatus();
  if (!goals) openGoals(); // first run: ask for start and goal weight

  try {
    setupNutrition(); // attach the Nutrition card's listeners (see nutrition-view.js)
    setupTrends(); // and the Nutrition trends card's (see trends-view.js)
    setupTargets(); // and the eating targets dialog's (see targets-view.js)
    setupInsights(); // and the "Use measured maintenance" button's (see insights-view.js)
    await loadMealDay(todayISO());
    await loadTargets();
    await loadTrends();
    await refreshInsights(); // catches its own errors
  } catch (err) {
    console.error(err);
    $("meals-empty").textContent = "Nutrition couldn't load: " + err.message + ". Close and reopen the app to finish updating.";
    $("meals-empty").hidden = false;
  }
}

// Measurements load on their own, so a problem with them can't hide anything else.
async function initMeasurements() {
  try {
    setupMeasurements(); // see measurements-view.js
    await loadMeasurements();
  } catch (err) {
    console.error(err);
    $("measure-empty").textContent = "Measurements couldn't load: " + err.message + ". Close and reopen the app to finish updating.";
    $("measure-empty").hidden = false;
  }
}

init().then(initMeasurements).catch((err) => {
  console.error(err);
  showError("app-error", err instanceof DOMException
    ? "Couldn't open local storage. Try a normal (non-private) browser window."
    : "Something went wrong while starting: " + err.message);
});

// Offline support (only works when served from localhost or https, not from a file)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
