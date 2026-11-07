// All IndexedDB code lives here. The rest of the app only calls these functions.
// Two "object stores" (think: tables):
//   entries  -> one record per date, keyed by the date string ("2026-11-06")
//   settings -> one record, key "goals" ({ startWeight, goalWeight })

const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open("weight-tracker", 1);
  request.onupgradeneeded = () => {
    // Runs once, the first time the database is created
    request.result.createObjectStore("entries", { keyPath: "date" });
    request.result.createObjectStore("settings", { keyPath: "key" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// Run one operation inside a transaction and resolve with its result.
async function run(storeName, mode, operation) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

const db = {
  getEntries: () => run("entries", "readonly", (s) => s.getAll()),
  getEntry: (date) => run("entries", "readonly", (s) => s.get(date)),
  saveEntry: (entry) => run("entries", "readwrite", (s) => s.put(entry)), // add or replace
  deleteEntry: (date) => run("entries", "readwrite", (s) => s.delete(date)),
  getGoals: () => run("settings", "readonly", (s) => s.get("goals")),
  saveGoals: (g) => run("settings", "readwrite", (s) => s.put({ key: "goals", ...g })),
  getMeta: (key) => run("settings", "readonly", (s) => s.get(key)),
  saveMeta: (key, value) => run("settings", "readwrite", (s) => s.put({ key, value })),
  // Save many entries in one transaction: all succeed or none do
  saveEntries: async (list) => {
    const database = await dbReady;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("entries", "readwrite");
      list.forEach((entry) => transaction.objectStore("entries").put(entry));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },
};
