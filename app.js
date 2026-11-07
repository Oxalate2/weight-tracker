// Phase 2: load data from IndexedDB, render, and handle the form.

const state = { entries: [], goals: null, editingDate: null, range: "90D" };
const $ = (id) => document.getElementById(id);

// ---------- Helpers ----------
const round1 = (n) => Math.round(n * 10) / 10;
const todayISO = () => new Date().toLocaleDateString("en-CA"); // local date as YYYY-MM-DD
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(round1(n)).toFixed(1) + " lb";

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function progressPercent(start, current, goal) {
  if (start === goal) return 0;
  return Math.max(0, Math.min(100, ((start - current) / (start - goal)) * 100));
}

function setText(name, value) {
  document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => (el.textContent = value));
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message || "";
  el.hidden = !message;
}

// ---------- Rendering ----------
function trendLabel(perWeek) {
  if (perWeek === null) return "Need more data";
  if (Math.abs(perWeek) < 0.2) return "Steady";
  return `${perWeek < 0 ? "Down" : "Up"} ${Math.abs(perWeek).toFixed(1)} lb/wk`;
}

function render() {
  const entries = [...state.entries].sort((a, b) => a.date.localeCompare(b.date));
  const goals = state.goals;

  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c.dataset.range === state.range));
  if (goals) {
    setText("start", goals.startWeight.toFixed(1));
    setText("goal", goals.goalWeight.toFixed(1));
  }
  renderEntries(entries);
  renderChart(entries, state.range);
  if (entries.length === 0) return;

  const today = dayNumber(todayISO());
  const latest = entries.at(-1);
  const daysAgo = today - dayNumber(latest.date);
  const week = changeOver(entries, 7, today);
  const month = changeOver(entries, 30, today);

  setText("current", latest.weight.toFixed(1));
  setText("lastDate", formatDate(latest.date));
  setText("weekChange", week === null ? "--" : signed(week));
  setText("monthChange", month === null ? "--" : signed(month));
  setText("trend", trendLabel(trendPerWeek(entries, today)));

  const sub = document.querySelector('[data-bind="weekDelta"]');
  sub.classList.remove("down", "up");
  if (daysAgo > 7) {
    sub.textContent = `Last weigh-in ${daysAgo} days ago`;
  } else if (week !== null) {
    sub.textContent = `${week <= 0 ? "▼" : "▲"} ${Math.abs(round1(week)).toFixed(1)} lb this week`;
    sub.classList.add(week < 0 ? "down" : "up");
  } else {
    sub.textContent = "Log more to see weekly change";
  }

  if (goals) {
    const pct = progressPercent(goals.startWeight, latest.weight, goals.goalWeight);
    setText("change", signed(latest.weight - goals.startWeight));
    setText("remaining", Math.abs(round1(latest.weight - goals.goalWeight)).toFixed(1) + " lb");
    setText("percent", Math.round(pct) + "% to goal");
    $("progress-fill").style.width = pct + "%";
    $("progress").setAttribute("aria-valuenow", Math.round(pct));
  }
}

function renderEntries(entries) {
  const list = $("entries");
  list.innerHTML = "";
  $("entries-empty").hidden = entries.length > 0;
  entries.slice(-10).reverse().forEach((e) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="entry-main"><span class="date"></span><span class="note"></span></div>
      <span class="entry-weight"></span>
      <div class="entry-actions">
        <button class="link" data-action="edit" type="button">Edit</button>
        <button class="link" data-action="delete" type="button">Delete</button>
      </div>`;
    li.dataset.date = e.date;
    li.querySelector(".date").textContent = formatDate(e.date); // textContent keeps user text safe
    li.querySelector(".note").textContent = e.notes || "";
    li.querySelector(".entry-weight").textContent = e.weight.toFixed(1) + " lb";
    list.appendChild(li);
  });
}

// ---------- Entry form ----------
function resetForm() {
  state.editingDate = null;
  $("f-date").value = todayISO();
  $("f-weight").value = "";
  $("f-notes").value = "";
  $("f-date").disabled = false;
  $("f-submit").textContent = "Save entry";
  $("f-cancel").hidden = true;
  $("form-title").textContent = "Log weight";
  showError("form-error", "");
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
  state.entries = await db.getEntries();
  resetForm();
  render();
});

$("f-cancel").addEventListener("click", resetForm);

// One listener on the list handles every Edit/Delete button (event delegation).
$("entries").addEventListener("click", async (event) => {
  const action = event.target.dataset.action;
  const date = event.target.closest("li")?.dataset.date;
  if (!action || !date) return;

  if (action === "delete") {
    if (!confirm(`Delete the entry for ${formatDate(date)}?`)) return;
    await db.deleteEntry(date);
    state.entries = await db.getEntries();
    render();
  } else {
    const entry = state.entries.find((e) => e.date === date);
    state.editingDate = date;
    $("f-date").value = entry.date;
    $("f-date").disabled = true; // changing the date would create a different entry
    $("f-weight").value = entry.weight;
    $("f-notes").value = entry.notes || "";
    $("f-submit").textContent = "Update entry";
    $("f-cancel").hidden = false;
    $("form-title").textContent = "Edit entry";
    $("f-weight").focus();
    $("entry-form").scrollIntoView({ behavior: "smooth", block: "center" });
  }
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
      state.entries = await db.getEntries();
      state.goals = (await db.getGoals()) || null;
      render();
      setBackupMsg(`Imported ${result.count} entries (${result.replaced} replaced).`, true);
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
    const start = today - RANGE_DAYS[key];
    if (entries.filter((e) => dayNumber(e.date) >= start).length >= 2) return key;
  }
  return "All";
}

async function init() {
  const [entries, goals] = await Promise.all([db.getEntries(), db.getGoals()]);
  state.entries = entries;
  state.goals = goals || null;
  state.range = pickDefaultRange(entries);
  resetForm();
  render();
  renderBackupStatus();
  if (!goals) openGoals(); // first run: ask for start and goal weight
}

init().catch((err) => {
  console.error(err);
  showError("form-error", err instanceof DOMException
    ? "Couldn't open local storage. Try a normal (non-private) browser window."
    : "Something went wrong while starting: " + err.message);
});

// Offline support (only works when served from localhost or https, not from a file)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
