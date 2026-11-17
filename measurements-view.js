// Page code for the Measurements card on the Weight tab: latest values, a chart for one body
// part, recent entries, and the log/edit dialog. The rules are in measurements.js.
// Like the other view files, this uses helpers from other files ($, showError, todayISO,
// formatDate, plural, state, and the chart helpers in chart-view.js) only after startup.

let measurements = []; // every record, any order
let measureChart = null;
let measureSite = null; // key of the body part the chart shows
let editingMeasureDate = null;

// ---------- Loading ----------
async function loadMeasurements() {
  measurements = await db.getMeasurements();
  renderMeasurements();
}

const sortedMeasurements = () => [...measurements].sort((a, b) => a.date.localeCompare(b.date));

// ---------- Card ----------
function renderMeasurements() {
  const progress = measurementProgress(measurements);
  $("measure-empty").hidden = measurements.length > 0;
  renderMeasureDue();
  renderMeasureLatest(progress);
  renderMeasureSites(progress);
  renderMeasureList();
  if (state.tab === "weight") renderMeasureChart(); // a hidden canvas would draw 0 px wide
}

// "Last measured 16 days ago" once it's been longer than every 2 weeks.
function renderMeasureDue() {
  const days = daysSinceMeasured(measurements, todayISO());
  const el = $("measure-due");
  el.hidden = days === null || days <= MEASURE_DUE_DAYS;
  el.textContent = `Last measured ${plural(days ?? 0, "day")} ago. Time for a new set.`;
}

// "−1.5″" / "+0.25″" / "no change"
function inchChange(n) {
  if (Math.abs(n) < 0.005) return "no change";
  return (n > 0 ? "+" : "−") + formatInches(Math.abs(n)) + "″";
}

function renderMeasureLatest(progress) {
  const box = $("measure-latest");
  box.innerHTML = "";
  box.hidden = progress.length === 0;
  for (const p of progress) {
    const cell = document.createElement("div");
    cell.className = "total";
    cell.innerHTML = `<p class="label"></p><p class="total-value"></p><span class="measure-change"></span>`;
    cell.querySelector(".label").textContent = p.label;
    cell.querySelector(".total-value").textContent = formatInches(p.latest) + "″";
    const change = cell.querySelector(".measure-change");
    change.textContent = inchChange(p.change) + " since first";
    change.title = `Latest: ${formatDate(p.latestDate)}`;
    box.append(cell);
  }
}

// The chart's dropdown lists only parts you've measured. Waist first if you have it.
function renderMeasureSites(progress) {
  const select = $("measure-site");
  $("measure-chart-area").hidden = progress.length === 0;
  if (!progress.some((p) => p.key === measureSite)) measureSite = progress[0]?.key ?? null;
  select.innerHTML = "";
  for (const p of progress) select.add(new Option(p.label, p.key, false, p.key === measureSite));
}

function measureSummary(m) {
  return MEASURE_SITES.filter((s) => m[s.key] !== null).map((s) => `${s.label} ${formatInches(m[s.key])}″`).join(" · ");
}

function renderMeasureList() {
  const list = $("measure-list");
  list.innerHTML = "";
  sortedMeasurements().slice(-10).reverse().forEach((m) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="entry-main"><span class="date"></span><span class="measure-values"></span><span class="note"></span></div>
      <div class="entry-actions">
        <button class="link" data-action="edit" type="button">Edit</button>
        <button class="link" data-action="delete" type="button">Delete</button>
      </div>`;
    li.dataset.date = m.date;
    li.querySelector(".date").textContent = formatDate(m.date); // textContent keeps user text safe
    li.querySelector(".measure-values").textContent = measureSummary(m);
    li.querySelector(".note").textContent = m.notes || "";
    list.append(li);
  });
}

// ---------- Chart ----------
// Every value you've recorded for one part, all time. Measurements are every week or two,
// so there's no range picker and no rolling average: each dot is a real measurement.
function renderMeasureChart() {
  if (measureChart) { measureChart.destroy(); measureChart = null; }
  if (!measureSite || typeof Chart === "undefined") return;
  const site = MEASURE_SITES.find((s) => s.key === measureSite);
  const points = sortedMeasurements()
    .filter((m) => m[measureSite] !== null)
    .map((m) => ({ x: dayNumber(m.date) * DAY_MS, y: m[measureSite] }));
  const empty = $("measure-chart-empty");
  const canvas = $("measure-canvas");
  canvas.parentElement.hidden = points.length < 2;
  empty.hidden = points.length >= 2;
  if (points.length < 2) {
    empty.textContent = `Your second ${site.label.toLowerCase()} measurement starts the chart.`;
    return;
  }

  const muted = cssVar("--muted");
  const accent = cssVar("--good"); // weight uses --accent; a different color says "not weight"
  const startMs = points[0].x;
  const endMs = Math.max(dayNumber(todayISO()) * DAY_MS, startMs + DAY_MS);
  const edgePad = Math.max((endMs - startMs) * 0.03, DAY_MS / 2);
  measureChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: site.label, data: points,
        borderColor: accent, borderWidth: 2.5, borderCapStyle: "round", tension: 0.25,
        pointRadius: 3.5, pointHoverRadius: 5, pointBackgroundColor: accent, pointBorderColor: accent,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      layout: { padding: { top: 4, right: 4 } },
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: startMs - edgePad,
          max: endMs + edgePad,
          afterBuildTicks: (scale) => { scale.ticks = evenDateTicks(startMs, endMs); },
          ticks: { color: muted, maxRotation: 0, padding: 8, font: { size: 11 }, callback: (v) => axisDate(v) },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          grace: "10%",
          ticks: { color: muted, padding: 8, maxTicksLimit: 5, font: { size: 11 }, callback: (v, i, ticks) => v.toFixed(tickDecimals(ticks)) },
          grid: { color: cssVar("--border") + "99", tickLength: 0 },
          border: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar("--bg"),
          borderColor: cssVar("--border"),
          borderWidth: 1,
          titleColor: muted,
          bodyColor: cssVar("--text"),
          padding: 10,
          cornerRadius: 10,
          displayColors: false,
          callbacks: {
            title: (items) => axisDate(items[0].parsed.x, true),
            label: (item) => `${site.label}: ${formatInches(item.parsed.y)}″`,
          },
        },
      },
    },
  });
}

// ---------- Dialog ----------
// Pass a record to edit it, or nothing to log a new one (like openEntryDialog).
function openMeasureDialog(record = null) {
  editingMeasureDate = record ? record.date : null;
  $("measure-form-title").textContent = record ? "Edit measurements" : "Log measurements";
  $("ms-date").value = record ? record.date : todayISO();
  $("ms-date").disabled = Boolean(record); // changing the date would make a different record
  for (const s of MEASURE_SITES) $(`ms-${s.key}`).value = record?.[s.key] ?? "";
  $("ms-notes").value = record?.notes ?? "";
  showError("measure-error", "");
  $("measure-dialog").showModal();
}

function readMeasureForm() {
  const raw = { date: $("ms-date").value, notes: $("ms-notes").value };
  for (const s of MEASURE_SITES) {
    // A half-typed number ("36.") reads as "" in the browser; catch it instead of saving null.
    if ($(`ms-${s.key}`).validity.badInput) return { error: `${s.label} must be a number.` };
    raw[s.key] = $(`ms-${s.key}`).value;
  }
  if (raw.date > todayISO()) return { error: "The date can't be in the future." };
  return validateMeasurement(raw);
}

async function measurementsChanged() {
  measurements = await db.getMeasurements();
  renderMeasurements();
}

// ---------- Event listeners (attached once, from app.js startup) ----------
function setupMeasurements() {
  $("measure-btn").addEventListener("click", () => openMeasureDialog());
  $("ms-cancel").addEventListener("click", () => $("measure-dialog").close());
  $("measure-form").addEventListener("input", () => showError("measure-error", ""));
  $("measure-site").addEventListener("change", (event) => {
    measureSite = event.target.value;
    renderMeasureChart();
  });

  $("measure-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { measurement, error } = readMeasureForm();
    if (error) return showError("measure-error", error);
    if (editingMeasureDate === null) {
      const existing = await db.getMeasurement(measurement.date);
      if (existing && !confirm(`You already have measurements for ${formatDate(measurement.date)} (${measureSummary(existing)}). Replace them?`)) return;
    }
    try {
      await db.saveMeasurement(measurement);
    } catch (err) {
      return showError("measure-error", "Couldn't save: " + err.message);
    }
    $("measure-dialog").close();
    await measurementsChanged();
  });

  $("measure-list").addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    const date = event.target.closest("li")?.dataset.date;
    if (!action || !date) return;
    if (action === "delete") {
      if (!confirm(`Delete the measurements for ${formatDate(date)}?`)) return;
      await db.deleteMeasurement(date);
      await measurementsChanged();
    } else {
      openMeasureDialog(measurements.find((m) => m.date === date));
    }
  });
}
