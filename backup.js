// Export and import of your data as a JSON file. No page code here except file handling.

const BACKUP_VERSION = 1;

async function exportBackup() {
  const [entries, goals] = await Promise.all([db.getEntries(), db.getGoals()]);
  entries.sort((a, b) => a.date.localeCompare(b.date));
  const backup = {
    app: "weight-tracker",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    goals: goals ? { startWeight: goals.startWeight, goalWeight: goals.goalWeight } : null,
    entries,
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
  return { entries, goals };
}

// Merge a backup into the current data. Same-date entries are replaced by the backup's version.
async function importBackup(file) {
  const { entries, goals } = parseBackup(await file.text());
  const existing = new Set((await db.getEntries()).map((e) => e.date));
  const replaced = entries.filter((e) => existing.has(e.date)).length;
  const message = `Import ${entries.length} entries?` +
    (replaced ? ` ${replaced} share a date with existing entries and will be replaced.` : "");
  if (!confirm(message)) return null;
  await db.saveEntries(entries);
  if (goals && !(await db.getGoals())) await db.saveGoals(goals); // keep your current goals if you have them
  return { count: entries.length, replaced };
}
