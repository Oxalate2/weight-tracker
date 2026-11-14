// All IndexedDB code lives here. The rest of the app only calls these functions.
// Three "object stores" (think: tables):
//   entries  -> one weigh-in per date, keyed by the date string ("2026-11-06")
//   settings -> small records keyed by name: "goals", "lastBackup"
//   meals    -> one record per meal, keyed by a random id, with an index on "date"

const DB_VERSION = 2;

const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open("weight-tracker", DB_VERSION);

  // Runs when the database is new (oldVersion 0) or older than DB_VERSION.
  // Each step only runs if this device hasn't had it yet, so existing data is untouched.
  request.onupgradeneeded = (event) => {
    const database = request.result;
    if (event.oldVersion < 1) {
      database.createObjectStore("entries", { keyPath: "date" });
      database.createObjectStore("settings", { keyPath: "key" });
    }
    if (event.oldVersion < 2) {
      const meals = database.createObjectStore("meals", { keyPath: "id" });
      meals.createIndex("date", "date"); // lets us ask "all meals on this date" directly
    }
  };

  request.onsuccess = () => {
    const database = request.result;
    // Something else wants to upgrade or delete the database: a newer copy of the app in
    // another tab, or "Clear site data" in DevTools. We must close our connection so it can
    // proceed, and a closed connection can never be used again, so reload the page to
    // reopen it fresh (otherwise every later save fails with "connection is closing").
    database.onversionchange = () => {
      database.close();
      location.reload();
    };
    resolve(database);
  };
  request.onerror = () => reject(request.error);
  // An older copy of the app is still open somewhere and holding the old version.
  request.onblocked = () => alert("Please close other open tabs of Weight Tracker to finish updating.");
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

// Save many records in one transaction: all succeed or none do.
async function putMany(storeName, list) {
  const database = await dbReady;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    list.forEach((item) => store.put(item));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

const db = {
  getEntries: () => run("entries", "readonly", (s) => s.getAll()),
  getEntry: (date) => run("entries", "readonly", (s) => s.get(date)),
  saveEntry: (entry) => run("entries", "readwrite", (s) => s.put(entry)), // add or replace
  deleteEntry: (date) => run("entries", "readwrite", (s) => s.delete(date)),
  saveEntries: (list) => putMany("entries", list),
  getGoals: () => run("settings", "readonly", (s) => s.get("goals")),
  saveGoals: (g) => run("settings", "readwrite", (s) => s.put({ key: "goals", ...g })),
  getMeta: (key) => run("settings", "readonly", (s) => s.get(key)),
  saveMeta: (key, value) => run("settings", "readwrite", (s) => s.put({ key, value })),
  getAllMeals: () => run("meals", "readonly", (s) => s.getAll()),
  getMealsByDate: (date) => run("meals", "readonly", (s) => s.index("date").getAll(date)),
  // All meals from `from` to `to`, both included. Date strings sort like the dates they name,
  // so the index can jump straight to the range instead of reading every meal.
  getMealsBetween: (from, to) =>
    run("meals", "readonly", (s) => s.index("date").getAll(IDBKeyRange.bound(from, to))),
  saveMeal: (meal) => run("meals", "readwrite", (s) => s.put(meal)), // add or replace by id
  deleteMeal: (id) => run("meals", "readwrite", (s) => s.delete(id)),
  saveMeals: (list) => putMany("meals", list),
};
