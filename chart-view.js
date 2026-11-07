// Draws the history chart. Uses Chart.js (bundled in vendor/ so it works offline).

let weightChart = null;

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const axisDate = (ms, withYear) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });

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

  weightChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        { label: "Daily", data: daily, borderColor: cssVar("--border"), borderWidth: 1,
          pointRadius: 3, pointBackgroundColor: muted, pointBorderWidth: 0 },
        { label: "7-day average", data: avg, borderColor: cssVar("--accent"), borderWidth: 2.5,
          pointRadius: 0, tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: start * DAY_MS,
          max: Math.max(today, start + 1) * DAY_MS,
          ticks: { color: muted, maxTicksLimit: 5, maxRotation: 0, callback: (v) => axisDate(v) },
          grid: { display: false },
          border: { color: cssVar("--border") },
        },
        y: {
          ticks: { color: muted, callback: (v) => v.toFixed(0) },
          grid: { color: cssVar("--border") },
          border: { display: false },
        },
      },
      plugins: {
        legend: { labels: { color: muted, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            title: (items) => axisDate(items[0].parsed.x, true),
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(1)} lb`,
          },
        },
      },
    },
  });
}
