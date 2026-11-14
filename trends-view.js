// Draws the Nutrition trends card: a bar per day for one nutrient, plus average tiles.
// Like nutrition-view.js, it uses helpers from other files ($, todayISO, plural, cssVar,
// axisDate, evenDateTicks, tickDecimals) only inside functions that run after startup.

const trends = { key: "calories", range: "30D", meals: [], start: null, today: null };
let trendChart = null;

// Fetch the meals for the chosen range, then redraw. Call after any meal change.
async function loadTrends() {
  trends.today = todayISO();
  trends.start = shiftDay(trends.today, -(RANGE_DAYS[trends.range] - 1)); // e.g. 30D = today + 29 days back
  trends.meals = await db.getMealsBetween(trends.start, trends.today);
  renderTrends();
}

function renderTrends() {
  document.querySelectorAll("#t-ranges .chip").forEach((c) => c.classList.toggle("is-active", c.dataset.range === trends.range));
  const nutrient = NUTRIENTS.find((n) => n.key === trends.key);
  const series = dailySeries(trends.meals, trends.start, trends.today, trends.key);
  const { average, days } = averageOf(series, trends.today);
  renderTrendChart(series, nutrient, average);
  renderTrendNote(series, nutrient, average, days);
  renderTrendStats();
}

// A sentence under the chart that explains the colors actually on screen.
function renderTrendNote(series, nutrient, average, days) {
  const parts = [];
  if (average !== null) parts.push(`Dashed line: average of ${plural(days, "complete day")}.`);
  if (series.some((p) => p.date === trends.today && p.value !== null)) parts.push("Faded bar: today, still in progress.");
  if (series.some((p) => p.partial)) parts.push(`Orange: some meals that day didn't record ${nutrient.label.toLowerCase()}.`);
  $("trend-note").textContent = parts.join(" ");
  $("trend-note").hidden = parts.length === 0;
}

function renderTrendStats() {
  const grid = $("t-stats");
  grid.innerHTML = "";
  const addTile = (label, value, unit, sub) => {
    const tile = document.createElement("div");
    tile.className = "total";
    tile.innerHTML = `<p class="label"></p><p class="total-value"></p><span class="sub"></span>`;
    tile.querySelector(".label").textContent = label;
    tile.querySelector(".total-value").textContent = value;
    if (unit) {
      const small = document.createElement("small");
      small.textContent = unit;
      tile.querySelector(".total-value").append(small);
    }
    tile.querySelector(".sub").textContent = sub;
    grid.append(tile);
  };

  for (const key of ["calories", "protein", "carbs", "fat"]) {
    const n = NUTRIENTS.find((x) => x.key === key);
    const { average, days } = averageOf(dailySeries(trends.meals, trends.start, trends.today, key), trends.today);
    if (average === null) addTile(`Avg ${n.label.toLowerCase()}`, "--", "", "no complete days");
    else addTile(`Avg ${n.label.toLowerCase()}`, formatAmount(average, 0), n.unit, plural(days, "day"));
  }
  const logged = new Set(trends.meals.map((m) => m.date)).size;
  addTile("Logged", `${logged}/${RANGE_DAYS[trends.range]}`, "", "days with meals");
}

function renderTrendChart(series, nutrient, average) {
  const canvas = $("trend-canvas");
  const emptyMsg = $("trend-empty");
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  const hasData = series.some((p) => p.value !== null);
  canvas.parentElement.hidden = !hasData || typeof Chart === "undefined";
  emptyMsg.hidden = hasData && typeof Chart !== "undefined";
  if (typeof Chart === "undefined") { emptyMsg.textContent = "Chart library didn't load."; return; }
  if (!hasData) {
    emptyMsg.textContent = series.some((p) => p.logged)
      ? `No meals in this range recorded ${nutrient.label.toLowerCase()}.`
      : `No meals logged in the last ${RANGE_DAYS[trends.range]} days.`;
    return;
  }

  const startMs = dayNumber(trends.start) * DAY_MS;
  const todayMs = dayNumber(trends.today) * DAY_MS;
  const accent = cssVar("--accent"); // #rrggbb, so alpha suffixes can be appended
  const warn = cssVar("--warn");
  const muted = cssVar("--muted");
  const colorFor = (p) => (p.partial ? warn + "99" : p.date === trends.today ? accent + "55" : accent + "cc");
  const unitText = (v) => `${formatAmount(v, nutrient.decimals)} ${nutrient.unit}`;

  const datasets = [{
    type: "bar",
    label: nutrient.label,
    data: series.map((p) => ({ x: dayNumber(p.date) * DAY_MS, y: p.value, point: p })),
    backgroundColor: series.map(colorFor),
    borderRadius: 4,
    barPercentage: 0.8,
    categoryPercentage: 1,
    order: 2,
  }];
  if (average !== null) {
    datasets.push({
      type: "line",
      label: "Average",
      data: [{ x: startMs, y: average }, { x: todayMs, y: average }],
      borderColor: cssVar("--text") + "99",
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 0,
      order: 1,
    });
  }

  trendChart = new Chart(canvas, {
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      layout: { padding: { top: 4, right: 4 } },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: {
          type: "linear",
          // Half a day of padding on each side so the first and last bars aren't cut in half.
          min: startMs - DAY_MS / 2,
          max: todayMs + DAY_MS / 2,
          afterBuildTicks: (scale) => { scale.ticks = evenDateTicks(startMs, todayMs); },
          ticks: { color: muted, maxRotation: 0, padding: 8, font: { size: 11 }, callback: (v) => axisDate(v) },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          beginAtZero: true, // bars must start at 0 or their heights lie
          grace: "8%",
          ticks: { color: muted, padding: 8, maxTicksLimit: 5, font: { size: 11 }, callback: (v, i, ticks) => v.toFixed(tickDecimals(ticks)) },
          grid: { color: cssVar("--border") + "99", tickLength: 0 },
          border: { display: false },
        },
      },
      plugins: {
        legend: { display: false }, // the note under the chart explains the marks instead
        tooltip: {
          backgroundColor: cssVar("--bg"),
          borderColor: cssVar("--border"),
          borderWidth: 1,
          titleColor: muted,
          bodyColor: cssVar("--text"),
          padding: 10,
          cornerRadius: 10,
          // Only the bars get tooltips; the average already shows in the tiles below.
          filter: (item) => item.dataset.type === "bar" && item.parsed.y !== null,
          callbacks: {
            title: (items) => axisDate(items[0].parsed.x, true),
            label: (item) => `${nutrient.label}: ${unitText(item.parsed.y)}`,
            afterLabel: (item) => {
              const p = item.raw.point;
              if (p.partial) return "Some meals didn't record this, so the real total is higher.";
              if (p.date === trends.today) return "Today (still in progress)";
              return "";
            },
          },
        },
      },
    },
  });
}

// ---------- Event listeners (attached once, from app.js startup) ----------
function setupTrends() {
  const select = $("t-nutrient");
  for (const n of NUTRIENTS) select.add(new Option(n.label, n.key));
  select.value = trends.key;
  select.addEventListener("change", () => {
    trends.key = select.value;
    renderTrends(); // same meals, different nutrient: no need to ask the database again
  });
  $("t-ranges").addEventListener("click", (event) => {
    const range = event.target.dataset.range;
    if (!range || range === trends.range) return;
    trends.range = range;
    loadTrends();
  });
}
