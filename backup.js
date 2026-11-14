// Export and import of your data as a JSON file. No page code here except file handling.

// Version 1: entries + goals. Version 2 adds meals. Version 1 files still import fine.
const BACKUP_VERSION = 2;

async function exportBackup() {
  const [entries, goals, meals] = await Promise.all([db.getEntries(), db.getGoals(), db.getAllMeals()]);
  entries.sort((a, b) => a.date.localeCompare(b.date));
  meals.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const backup = {
    app: "weight-tracker",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    goals: goals ? { startWeight: goals.startWeight, goalWeight: goals.goalWeight } : null,
    entries,
    meals,
  };
  const name = `weight-backup-${todayISO()}.json`;
  const file = new File([JSON.stringify(backup, null, 2)], name, { type: "application/json" });

  // On iPhone the share sheet lets you save to Files/iCloud. Elsewhere, download the file.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (err) {
      if (err.name === "AbortError") return false; // you closed the share sheet
      downloadFile(file);
    }
  } else {
    downloadFile(file);
  }
  await db.saveMeta("lastBackup", new Date().toISOString());
  return true;
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Turn untrusted file text into clean data, or throw an error that says what's wrong.
function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("That file isn't valid JSON."); }
  if (!data || data.app !== "weight-tracker" || !Array.isArray(data.entries)) {
    throw new Error("That doesn't look like a Weight Tracker backup.");
  }
  if (typeof data.version === "number" && data.version > BACKUP_VERSION) {
    throw new Error("This backup was made by a newer version of the app. Update the app, then try again.");
  }
  const entries = data.entries.map((e, i) => {
    const validDate = typeof e?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
      !Number.isNaN(Date.parse(e.date));
    if (!validDate) throw new Error(`Entry ${i + 1} has an invalid date.`);
    if (!Number.isFinite(e.weight) || e.weight < 50 || e.weight > 700) {
      throw new Error(`Entry ${e.date} has an invalid weight.`);
    }
    return { date: e.date, weight: e.weight, notes: typeof e.notes === "string" ? e.notes.slice(0, 200) : "" };
  });
  let goals = null;
  const g = data.goals;
  if (g && Number.isFinite(g.startWeight) && Number.isFinite(g.goalWeight)) {
    goals = { startWeight: g.startWeight, goalWeight: g.goalWeight };
  }
  // Version 1 backups have no meals at all; that's fine, there's just nothing to add.
  const rawMeals = data.meals ?? [];
  if (!Array.isArray(rawMeals)) throw new Error("The meals in that backup are unreadable.");
  const meals = rawMeals.map((m, i) => {
    const { meal, error } = validateMeal(m); // same rules as the meal form (no future-date check)
    if (error) throw new Error(`Meal ${i + 1}: ${error}`);
    return meal;
  });
  return { entries, goals, meals };
}

// Merge a backup into the current data. Weigh-ins are matched by date, meals by id;
// a match is replaced by the backup's version, everything else is added.
async function importBackup(file) {
  const { entries, goals, meals } = parseBackup(await file.text());
  const existingDates = new Set((await db.getEntries()).map((e) => e.date));
  const existingMeals = new Set((await db.getAllMeals()).map((m) => m.id));
  const replaced = entries.filter((e) => existingDates.has(e.date)).length +
    meals.filter((m) => existingMeals.has(m.id)).length;
  // plural() lives in app.js; it exists by the time anyone clicks Import.
  const message = `Import ${plural(entries.length, "weigh-in")} and ${plural(meals.length, "meal")}?` +
    (replaced ? ` ${replaced} already ${replaced === 1 ? "exists" : "exist"} here and will be replaced by the backup's version.` : "");
  if (!confirm(message)) return null;
  await db.saveEntries(entries);
  await db.saveMeals(meals);
  if (goals && !(await db.getGoals())) await db.saveGoals(goals); // keep your current goals if you have them
  return { count: entries.length, mealCount: meals.length, replaced };
}
