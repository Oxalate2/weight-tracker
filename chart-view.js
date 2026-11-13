// Draws the history chart. Uses Chart.js (bundled in vendor/ so it works offline).

let weightChart = null;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const axisDate = (ms, withYear) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });

// Fewest decimals (0–2) that show every tick value exactly, so a 0.5 lb step reads
// 185.0, 185.5 instead of 185, 186, 186.
function tickDecimals(ticks) {
  for (let d = 0; d < 2; d++) {
    const f = 10 ** d;
    if (ticks.every((t) => Math.abs(t.value * f - Math.round(t.value * f)) < 1e-6)) return d;
  }
  return 2;
}

// Date ticks a fixed number of days apart, counted back from the right edge (today)
// so the latest date is always labeled. Picks the smallest step giving at most 5 labels.
const DAY_STEPS = [1, 2, 7, 14, 30, 45, 61, 91, 182, 365];
function evenDateTicks(minMs, maxMs) {
  const span = Math.round((maxMs - minMs) / DAY_MS);
  const step = DAY_STEPS.find((s) => Math.floor(span / s) + 1 <= 5) ?? 365 * Math.ceil(span / (365 * 4));
  const ticks = [];
  for (let d = Math.round(maxMs / DAY_MS); d * DAY_MS >= minMs; d -= step) ticks.unshift({ value: d * DAY_MS });
  return ticks;
}

function renderChart(entries, rangeKey) {
  const canvas = document.getElementById("chart-canvas");
  const emptyMsg = document.getElementById("chart-empty");
  if (typeof Chart === "undefined") {
    // The library file is missing: say so instead of breaking the rest of the app.
    emptyMsg.textContent = "Chart library didn't load. Check that vendor/chart.umd.js sits next to index.html.";
    emptyMsg.hidden = false;
    canvas.parentElement.hidden = true;
    return;
  }
  const today = dayNumber(new Date().toLocaleDateString("en-CA"));
  const days = RANGE_DAYS[rangeKey];
  const start = days === null ? (entries.length ? dayNumber(entries[0].date) : today) : today - days;

  const visible = entries.filter((e) => dayNumber(e.date) >= start);
  if (weightChart) { weightChart.destroy(); weightChart = null; }
  canvas.parentElement.hidden = visible.length === 0;
  emptyMsg.hidden = visible.length > 0;
  if (visible.length === 0) {
    const last = entries.length ? today - dayNumber(entries[entries.length - 1].date) : null;
    emptyMsg.textContent = last === null
      ? "No entries yet"
      : `No entries in this range. Your latest weigh-in was ${last} days ago, so try a longer range.`;
  }
  if (visible.length === 0) return;

  const daily = visible.map((e) => ({ x: dayNumber(e.date) * DAY_MS, y: e.weight }));
  const avg = rollingAverage(entries).filter((p) => p.day >= start).map((p) => ({ x: p.day * DAY_MS, y: p.avg }));
  const muted = cssVar("--muted");
  const accent = cssVar("--accent"); // must be #rrggbb: hex alpha suffixes are appended below

  weightChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        { label: "Daily", data: daily, showLine: false, order: 2,
          pointRadius: 3.5, pointHoverRadius: 5,
          pointBackgroundColor: accent + "66", pointBorderColor: accent + "99", pointBorderWidth: 1 },
        { label: "7-day average", data: avg, order: 1,
          borderColor: accent, borderWidth: 3, borderCapStyle: "round", borderJoinStyle: "round",
          pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: accent,
          pointHoverBorderColor: cssVar("--surface"), pointHoverBorderWidth: 2,
          tension: 0.35, fill: "start",
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            if (!chart.chartArea) return accent + "22";
            const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
            g.addColorStop(0, accent + "40");
            g.addColorStop(1, accent + "00");
            return g;
          } },
      ],
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
          min: start * DAY_MS,
          max: Math.max(today, start + 1) * DAY_MS,
          afterBuildTicks: (scale) => { scale.ticks = evenDateTicks(scale.min, scale.max); },
          ticks: { color: muted, maxRotation: 0, padding: 8, font: { size: 11 }, callback: (v) => axisDate(v) },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          grace: "8%",
          ticks: { color: muted, padding: 8, maxTicksLimit: 5, font: { size: 11 }, callback: (v, i, ticks) => v.toFixed(tickDecimals(ticks)) },
          grid: { color: cssVar("--border") + "99", tickLength: 0 },
          border: { display: false },
        },
      },
      plugins: {
        legend: {
          align: "end",
          labels: { color: muted, usePointStyle: true, pointStyle: "circle", boxWidth: 6, boxHeight: 6, padding: 14, font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: cssVar("--bg"),
          borderColor: cssVar("--border"),
          borderWidth: 1,
          titleColor: muted,
          bodyColor: cssVar("--text"),
          padding: 10,
          cornerRadius: 10,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            title: (items) => axisDate(items[0].parsed.x, true),
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(1)} lb`,
          },
        },
      },
    },
  });
}
