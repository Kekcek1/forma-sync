import { db, getMeta, setMeta, now } from "./db.js";
import { $, esc, toast, icon } from "./ui.js";

const ENTITIES = ["workouts", "sets", "recovery", "goals"];
const listeners = [];
let auth = null;
let status = { state: "idle", label: "Локально" };
let timer = null;
let running = false;

function emit(patch) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
}

export function onStatus(fn) {
  listeners.push(fn);
  fn(status);
}

export function getAuth() { return auth; }

export async function init() {
  auth = await getMeta("auth", null);
  const server = await getMeta("serverUrl", "");
  if (auth && auth.token) {
    emit({ state: navigator.onLine ? "idle" : "offline", label: navigator.onLine ? "Готово к синхронизации" : "Нет сети" });
    syncNow().catch(() => {});
    timer = setInterval(() => { if (navigator.onLine) syncNow().catch(() => {}); }, 60000);
  } else {
    emit({ state: "idle", label: server ? "Войди в аккаунт" : "Локально" });
  }
  window.addEventListener("online", () => { emit({ state: "idle", label: "Сеть появилась" }); if (auth) syncNow().catch(() => {}); });
  window.addEventListener("offline", () => emit({ state: "offline", label: "Нет сети" }));
  return { auth, server };
}

async function serverUrl() {
  return (await getMeta("serverUrl", "")).replace(/\/+$/, "");
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (auth?.token) h.Authorization = "Bearer " + auth.token;
  return h;
}

async function api(path, options = {}) {
  const base = await serverUrl();
  if (!base) throw new Error("Не указан адрес сервера");
  const res = await fetch(base + path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data;
}

export async function register(email, password, name) {
  const data = await api("/api/auth/register", {
    method: "POST", body: JSON.stringify({ email, password, name }),
  });
  auth = { token: data.token, email: data.user.email, name: data.user.name };
  await setMeta("auth", auth);
  await setMeta("lastSync", 0);
  emit({ state: "ok", label: "Аккаунт создан" });
  await syncNow();
  return auth;
}

export async function login(email, password) {
  const data = await api("/api/auth/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  });
  auth = { token: data.token, email: data.user.email, name: data.user.name };
  await setMeta("auth", auth);
  await setMeta("lastSync", 0);
  emit({ state: "ok", label: "Вход выполнен" });
  await syncNow();
  return auth;
}

export async function logout() {
  auth = null;
  await setMeta("auth", null);
  emit({ state: "idle", label: "Локально" });
}

export async function setServer(url) {
  await setMeta("serverUrl", url.trim());
  toast("Адрес сохранён", "ok");
}

async function collect(since) {
  const out = {};
  for (const e of ENTITIES) {
    const all = await db.all(e);
    out[e] = all.filter((r) => (r.updated_at || 0) > since);
  }
  return out;
}

async function apply(changes) {
  for (const e of ENTITIES) {
    const list = changes?.[e];
    if (!Array.isArray(list) || !list.length) continue;
    const local = new Map((await db.all(e)).map((r) => [r.id, r]));
    const toPut = [];
    for (const rec of list) {
      const cur = local.get(rec.id);
      if (!cur || (rec.updated_at || 0) >= (cur.updated_at || 0)) toPut.push(rec);
    }
    if (toPut.length) await db.putMany(e, toPut);
  }
}

export async function syncNow() {
  if (!auth?.token || running) return;
  if (!navigator.onLine) { emit({ state: "offline", label: "Нет сети" }); return; }
  running = true;
  emit({ state: "syncing", label: "Синхронизация…" });
  try {
    const since = (await getMeta("lastSync", 0)) || 0;
    const changes = await collect(since);
    const res = await api("/api/sync", { method: "POST", body: JSON.stringify({ since, changes }) });
    await apply(res.changes || {});
    await setMeta("lastSync", res.now || now());
    emit({ state: "ok", label: "Синхронизировано" });
    window.dispatchEvent(new CustomEvent("forma:synced"));
  } catch (e) {
    emit({ state: "error", label: e.message === "Failed to fetch" ? "Сервер недоступен" : "Ошибка синхронизации" });
  } finally {
    running = false;
  }
}

export async function mountSettings(box) {
  if (!box) return;
  const server = await getMeta("serverUrl", "");
  box.innerHTML = `
    <div class="form">
      <div class="field"><label for="srv">Адрес сервера</label>
        <input class="input" id="srv" placeholder="http://192.168.1.10:8000" value="${esc(server)}">
      </div>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <button class="btn" id="srv-save" type="button">Сохранить адрес</button>
        <button class="btn" id="srv-check" type="button">Проверить связь</button>
      </div>
      <div class="divider"></div>
      ${auth ? `
        <div class="row row--between">
          <div>
            <div style="font-weight:600">${esc(auth.name || auth.email)}</div>
            <div class="muted" style="font-size:12.5px">${esc(auth.email)}</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="logout" type="button">Выйти</button>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <button class="btn btn--accent" id="sync-now" type="button">${icon("sync")} Синхронизировать</button>
          <span class="muted" style="font-size:12px" id="sync-state">${esc(status.label)}</span>
        </div>` : `
        <p class="muted" style="font-size:13px;margin:0">Аккаунт нужен, чтобы данные совпадали на телефоне, ПК и в вебе. Регистрация — на этом сервере, без почтовых подтверждений.</p>
        <a class="btn btn--accent" href="#/account">Войти или создать аккаунт</a>`}
    </div>`;

  $("#srv-save")?.addEventListener("click", async () => {
    await setServer($("#srv").value);
  });
  $("#srv-check")?.addEventListener("click", async () => {
    try {
      const base = ($("#srv").value || "").replace(/\/+$/, "");
      const r = await fetch(base + "/api/health");
      toast(r.ok ? "Сервер отвечает" : "Сервер ответил ошибкой", r.ok ? "ok" : "err");
    } catch { toast("Нет связи с сервером", "err"); }
  });
  $("#logout")?.addEventListener("click", async () => { await logout(); toast("Вы вышли"); mountSettings(box); });
  $("#sync-now")?.addEventListener("click", () => syncNow());
  const st = $("#sync-state");
  if (st) onStatus((s) => { st.textContent = s.label; });
}

export async function mountAccount(box) {
  if (!box) return;
  if (auth) {
    box.innerHTML = `<div class="stack">
      <p class="muted" style="margin:0">Вы вошли как <b style="color:var(--text)">${esc(auth.email)}</b>.</p>
      <button class="btn" id="acc-logout" type="button">Выйти</button>
    </div>`;
    $("#acc-logout")?.addEventListener("click", async () => { await logout(); toast("Вы вышли"); mountAccount(box); });
    return;
  }
  box.innerHTML = `
    <div class="segment" style="margin-bottom:16px" id="acc-tabs">
      <button class="is-active" data-tab="login">Вход</button>
      <button data-tab="register">Регистрация</button>
    </div>
    <form class="form" id="acc-form">
      <div class="field" id="name-field" hidden><label>Имя</label><input class="input" name="name" autocomplete="name"></div>
      <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label>Пароль</label><input class="input" name="password" type="password" minlength="6" autocomplete="current-password" required></div>
      <button class="btn btn--accent" type="submit" id="acc-submit">Войти</button>
    </form>
    <p class="muted" style="font-size:12px;margin:12px 0 0">Если сервер ещё не запущен — подними его на ПК и укажи адрес в настройках.</p>`;

  let mode = "login";
  $("#acc-tabs")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    mode = b.dataset.tab;
    box.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("is-active", x === b));
    $("#name-field").hidden = mode !== "register";
    $("#acc-submit").textContent = mode === "register" ? "Создать аккаунт" : "Войти";
    const pw = box.querySelector('[name="password"]');
    pw.autocomplete = mode === "register" ? "new-password" : "current-password";
  });

  $("#acc-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    const btn = $("#acc-submit");
    btn.disabled = true;
    try {
      if (mode === "register") await register(d.email, d.password, d.name || d.email.split("@")[0]);
      else await login(d.email, d.password);
      toast("Готово", "ok");
      location.hash = "#/settings";
    } catch (err) {
      toast(err.message || "Не получилось", "err");
    } finally {
      btn.disabled = false;
    }
  });
}
