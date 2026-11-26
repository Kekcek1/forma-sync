const DB_NAME = "forma";
const DB_VER = 1;
const STORES = {
  workouts: "id",
  sets: "id",
  recovery: "id",
  goals: "id",
  profile: "id",
  meta: "key",
};

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const os = db.createObjectStore(name, { keyPath });
          if (name === "workouts") os.createIndex("date", "date");
          if (name === "recovery") os.createIndex("date", "date");
          if (name === "sets") os.createIndex("workout_id", "workout_id");
        }
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function run(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let out;
    try { out = fn(os); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const wrap = (req) => ({ __req: req });

export const db = {
  all(store) { return run(store, "readonly", (os) => wrap(os.getAll())); },
  get(store, key) { return run(store, "readonly", (os) => wrap(os.get(key))); },
  put(store, value) { return run(store, "readwrite", (os) => { os.put(value); }); },
  putMany(store, list) {
    return run(store, "readwrite", (os) => { list.forEach((v) => os.put(v)); });
  },
  remove(store, key) { return run(store, "readwrite", (os) => { os.delete(key); }); },
  clear(store) { return run(store, "readwrite", (os) => { os.clear(); }); },
};

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() :
    "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));

export const now = () => Date.now();

export const DEFAULT_PROFILE = {
  id: "main",
  name: "Олег",
  sex: "m",
  weight: 78,
  height: 182,
  birthYear: 2004,
  hrMax: 190,
  hrRest: 58,
  goalWorkouts: 4,
  goalMinutes: 240,
  onboarded: false,
};

export async function getProfile() {
  const p = await db.get("profile", "main");
  return p || { ...DEFAULT_PROFILE };
}

export async function saveProfile(patch) {
  const p = await getProfile();
  const next = { ...p, ...patch, id: "main", updated_at: now() };
  await db.put("profile", next);
  return next;
}

export async function getGoals() {
  return (await db.get("goals", "main")) || {
    id: "main", weeklyWorkouts: 4, weeklyMinutes: 240, updated_at: 0, deleted: 0,
  };
}

export async function saveGoals(patch) {
  const g = await getGoals();
  const next = { ...g, ...patch, id: "main", updated_at: now(), deleted: 0 };
  await db.put("goals", next);
  return next;
}

export async function getMeta(key, fallback = null) {
  const row = await db.get("meta", key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await db.put("meta", { key, value });
}

export async function allWorkouts() {
  const list = await db.all("workouts");
  return list.filter((w) => !w.deleted).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function workoutSets(workoutId) {
  const list = await db.all("sets");
  return list.filter((s) => s.workout_id === workoutId && !s.deleted);
}

export async function allRecovery() {
  const list = await db.all("recovery");
  return list.filter((r) => !r.deleted).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function saveWorkout(data, sets) {
  const ts = now();
  const w = {
    id: data.id || uid(),
    date: data.date,
    type: data.type,
    title: data.title || "",
    duration: Number(data.duration) || 0,
    intensity: Number(data.intensity) || 3,
    distance: Number(data.distance) || 0,
    avgHr: Number(data.avgHr) || 0,
    calories: Number(data.calories) || 0,
    note: data.note || "",
    updated_at: ts,
    deleted: 0,
  };
  await db.put("workouts", w);
  const old = await db.all("sets");
  for (const s of old.filter((x) => x.workout_id === w.id && !x.deleted)) {
    await db.put("sets", { ...s, deleted: 1, updated_at: ts });
  }
  if (Array.isArray(sets)) {
    for (const s of sets) {
      if (!s.name) continue;
      await db.put("sets", {
        id: s.id || uid(),
        workout_id: w.id,
        name: s.name,
        weight: Number(s.weight) || 0,
        reps: Number(s.reps) || 0,
        count: Number(s.count) || 1,
        rest: Number(s.rest) || 0,
        updated_at: ts,
        deleted: 0,
      });
    }
  }
  return w;
}

export async function deleteWorkout(id) {
  const ts = now();
  const w = await db.get("workouts", id);
  if (w) await db.put("workouts", { ...w, deleted: 1, updated_at: ts });
  const sets = await db.all("sets");
  for (const s of sets.filter((x) => x.workout_id === id)) {
    await db.put("sets", { ...s, deleted: 1, updated_at: ts });
  }
}

export async function saveRecovery(data) {
  const all = await db.all("recovery");
  const existing = all.find((r) => r.date === data.date && !r.deleted);
  const row = {
    id: existing ? existing.id : uid(),
    date: data.date,
    sleep: Number(data.sleep) || 0,
    quality: Number(data.quality) || 3,
    hr: Number(data.hr) || 0,
    fatigue: Number(data.fatigue) || 3,
    soreness: Number(data.soreness) || 3,
    mood: Number(data.mood) || 3,
    stress: Number(data.stress) || 3,
    note: data.note || "",
    updated_at: now(),
    deleted: 0,
  };
  await db.put("recovery", row);
  return row;
}

export async function deleteRecovery(id) {
  const r = await db.get("recovery", id);
  if (r) await db.put("recovery", { ...r, deleted: 1, updated_at: now() });
}

/* ---------- demo ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export async function seedDemo() {
  const r = rng(20261126);
  const today = new Date();
  const types = ["strength", "strength", "cardio", "mobility", "strength", "cardio"];
  const titles = {
    strength: ["Верх тела", "Низ тела", "Фулбоди", "Тяга и жим"],
    cardio: ["Бег в зоне 2", "Интервалы", "Велотренажёр"],
    mobility: ["Растяжка", "Мобильность таза"],
    sport: ["Волейбол"],
  };
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const date = iso(d);
    const dow = d.getDay();
    const isRest = (dow === 0 || dow === 3) && r() > 0.25;
    if (!isRest) {
      const type = types[Math.floor(r() * types.length)];
      const duration = type === "strength" ? 45 + Math.floor(r() * 30) : type === "cardio" ? 30 + Math.floor(r() * 35) : 20 + Math.floor(r() * 20);
      const intensity = 2 + Math.floor(r() * 3);
      const avgHr = type === "cardio" ? 130 + Math.floor(r() * 25) : 105 + Math.floor(r() * 20);
      const w = await saveWorkout({
        date, type,
        title: titles[type][Math.floor(r() * titles[type].length)],
        duration, intensity,
        distance: type === "cardio" ? +(3 + r() * 6).toFixed(1) : 0,
        avgHr,
        note: "",
      }, type === "strength" ? [
        { name: "Жим лёжа", weight: 60 + Math.floor(r() * 20), reps: 8, count: 4, rest: 90 },
        { name: "Тяга в наклоне", weight: 50 + Math.floor(r() * 15), reps: 10, count: 3, rest: 80 },
        { name: "Присед", weight: 80 + Math.floor(r() * 30), reps: 6, count: 4, rest: 120 },
      ] : []);
      w.calories = Math.round((type === "cardio" ? 9 : 6) * 3.5 * 78 / 200 * duration);
      await db.put("workouts", w);
    }
    const load = i < 10 ? r() : 0.5;
    await saveRecovery({
      date,
      sleep: +(6.2 + r() * 2.4).toFixed(1),
      quality: 2 + Math.floor(r() * 4),
      hr: 54 + Math.floor(r() * 12),
      fatigue: 2 + Math.floor(r() * 5),
      soreness: 1 + Math.floor(r() * 6),
      mood: 2 + Math.floor(r() * 4),
      stress: 1 + Math.floor(r() * 5),
      note: "",
    });
  }
  await saveGoals({ weeklyWorkouts: 4, weeklyMinutes: 240 });
  await saveProfile({ onboarded: true });
}
