import {
  db, getProfile, saveProfile, getGoals, saveGoals, getMeta, setMeta,
  allWorkouts, allRecovery, workoutSets, saveWorkout, deleteWorkout,
  saveRecovery, deleteRecovery, seedDemo, uid,
} from "./db.js";
import {
  TYPES, typeLabel, typeColor, isoDate, parseDate, addDays, humanDate, WEEKDAYS, WEEKDAYS_FULL, MONTHS,
  recoveryScore, acwr, weekLoad, periodStats, streak, avg, fmtMin, plural, loadOf,
} from "./calc.js";
import { $, $$, esc, icon, toast, openModal, confirmDialog, gauge, barChart, lineChart } from "./ui.js";

const SYNC = window.APP_MODE === "sync";
const state = {
  workouts: [], recovery: [], profile: null, goals: null,
  route: "", param: "", filter: "all", statsDays: 7, editingSets: [],
  sync: { ready: false, email: "", online: navigator.onLine },
};

/* ---------------- utils ---------------- */
const monthName = (d) => MONTHS[d.getMonth()];
const longDate = (d) => `${d.getDate()} ${monthName(d)}, ${WEEKDAYS_FULL[d.getDay()]}`;
const todayKey = () => isoDate(new Date());

function nav(route, param = "") {
  location.hash = `#/${route}${param ? "/" + param : ""}`;
}

function setHeader(title, sub) {
  $("#page-title").textContent = title;
  $("#page-sub").textContent = sub || "";
  document.title = `${title} — Форма`;
}

function activeNav(route) {
  $$("[data-route]").forEach((a) => {
    a.classList.toggle("is-active", a.dataset.route === route);
  });
}

async function refresh() {
  state.profile = await getProfile();
  state.goals = await getGoals();
  state.workouts = await allWorkouts();
  state.recovery = await allRecovery();
}

/* ---------------- router ---------------- */
function routeInfo() {
  const raw = location.hash.replace(/^#\/?/, "") || "today";
  const [route, param] = raw.split("/");
  return { route, param: param || "" };
}

async function render() {
  const { route, param } = routeInfo();
  state.route = route; state.param = param;
  activeNav(route);
  const view = $("#view");
  view.innerHTML = `<div class="empty"><div class="empty__title">Загрузка</div><p>Читаю локальную базу…</p></div>`;
  await refresh();

  let html = "";
  switch (route) {
    case "today": setHeader("Сегодня", longDate(new Date())); html = viewToday(); break;
    case "workouts": setHeader("Тренировки", `${state.workouts.length} ${plural(state.workouts.length, "запись", "записи", "записей")} в дневнике`); html = viewWorkouts(); break;
    case "workout": setHeader(param ? "Тренировка" : "Новая тренировка", param ? "Редактирование записи" : longDate(new Date())); html = await viewWorkoutEditor(param); break;
    case "recovery": setHeader("Восстановление", "Сон, пульс и самочувствие"); html = viewRecovery(); break;
    case "stats": setHeader("Статистика", "Нагрузка и динамика восстановления"); html = viewStats(); break;
    case "settings": setHeader("Настройки", "Профиль, цели и данные"); html = viewSettings(); break;
    case "account": setHeader("Аккаунт", "Синхронизация между устройствами"); html = viewAccount(); break;
    default: setHeader("Сегодня", longDate(new Date())); html = viewToday();
  }
  view.innerHTML = html;
  mount(route);
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ---------------- today ---------------- */
function viewToday() {
  const today = todayKey();
  const rec = state.recovery.find((r) => r.date === today);
  const ratio = acwr(state.workouts, today);
  const score = recoveryScore(rec, ratio);
  const days = weekLoad(state.workouts, today);
  const weekMin = days.reduce((s, d) => s + d.minutes, 0);
  const last = state.workouts.slice(0, 3);
  const goal = state.goals.weeklyWorkouts || 4;
  const done = days.filter((d) => d.count > 0).length;

  return `
  <div class="hero">
    <div class="card">
      <div class="card__head">
        <h2 class="card__title">Индекс восстановления</h2>
        <span class="micro">${rec ? "по отметке за сегодня" : "нет отметки"}</span>
      </div>
      ${score ? `
        <div class="row" style="gap:24px;align-items:center">
          <div>${gauge(score.value, score.tone)}</div>
          <div style="flex:1">
            <div class="verdict verdict--${score.tone}">${esc(score.verdict)}</div>
            <p style="margin:14px 0 0;font-size:14px;color:var(--muted);max-width:34ch">${esc(score.advice)}</p>
            <div class="row" style="margin-top:18px;flex-wrap:wrap;gap:8px">
              <span class="chip">сон ${rec.sleep} ч</span>
              <span class="chip">пульс ${rec.hr}</span>
              <span class="chip ${ratio > 1.5 ? "chip--accent" : ""}">ACWR ${ratio.toFixed(2)}</span>
            </div>
          </div>
        </div>` : `
        <div class="empty" style="padding:28px 0">
          <div class="empty__title">Оценим день?</div>
          <p>Заполни дневник восстановления — это минута. Индекс покажет, можно ли сегодня грузиться.</p>
          <div style="margin-top:16px"><a class="btn btn--accent" href="#/recovery">Отметить состояние</a></div>
        </div>`}
    </div>

    <div class="card">
      <div class="card__head">
        <h2 class="card__title">Неделя</h2>
        <span class="micro">${done} ${plural(done, "тренировка", "тренировки", "тренировок")} · цель ${goal}</span>
      </div>
      <div class="week">
        ${days.map((d) => `
          <div class="week__d ${d.date === today ? "is-today" : ""}">
            <span class="week__n">${d.weekday}</span>
            <div class="week__bar"><i style="height:${Math.max(4, Math.min(52, d.load * 0.55))}px;${d.load ? "" : "opacity:.15"}"></i></div>
            <span class="week__v">${d.minutes || "—"}</span>
          </div>`).join("")}
      </div>
      <div class="divider" style="margin:16px 0"></div>
      <div class="grid grid--3">
        <div class="stat"><span class="stat__label">Минут</span><span class="stat__value mono">${weekMin}</span><span class="stat__hint">за 7 дней</span></div>
        <div class="stat"><span class="stat__label">Серия</span><span class="stat__value mono">${streak(state.workouts, today)}</span><span class="stat__hint">${plural(streak(state.workouts, today), "день", "дня", "дней")} подряд</span></div>
        <div class="stat"><span class="stat__label">Нагрузка</span><span class="stat__value mono">${days.reduce((s, d) => s + d.load, 0)}</span><span class="stat__hint">условных единиц</span></div>
      </div>
    </div>
  </div>

  <div class="grid grid--2" style="margin-top:16px">
    <div class="card">
      <div class="card__head">
        <h2 class="card__title">Последние тренировки</h2>
        <a class="link" href="#/workouts">все</a>
      </div>
      ${last.length ? `<div class="list">${last.map(itemWorkout).join("")}</div>` : emptyBlock("Пока пусто", "Первая тренировка — самое сложное. Добавь её, и дальше пойдёт по инерции.", "Добавить тренировку", "#/workout")}
    </div>
    <div class="card">
      <div class="card__head"><h2 class="card__title">Что влияет на индекс</h2></div>
      <ul class="hint-list">
        <li><span class="dot"></span><span><b>Сон 30%.</b> Восемь часов — база. Меньше шести — минус к готовности.</span></li>
        <li><span class="dot dot--blue"></span><span><b>Пульс покоя 20%.</b> Рост на 5 ударов — признак усталости.</span></li>
        <li><span class="dot"></span><span><b>Усталость 25%.</b> Субъективная оценка честнее любых часов.</span></li>
        <li><span class="dot dot--red"></span><span><b>Резкий рост нагрузки.</b> ACWR выше 1,5 снимает 10 баллов.</span></li>
      </ul>
      <div class="divider" style="margin:14px 0"></div>
      <p class="muted" style="font-size:12.5px;margin:0">Индекс — ориентир, а не диагноз. Плохое самочувствие важнее любой цифры.</p>
    </div>
  </div>`;
}

function emptyBlock(title, text, btn, href) {
  return `<div class="empty"><div class="empty__title">${esc(title)}</div><p>${esc(text)}</p>
    ${btn ? `<div style="margin-top:16px"><a class="btn" href="${href}">${esc(btn)}</a></div>` : ""}</div>`;
}

function itemWorkout(w) {
  const d = parseDate(w.date);
  const sets = "";
  return `<div class="item" data-open="workout/${w.id}">
    <div class="item__date"><div class="item__day">${d.getDate()}</div><div class="item__wd">${WEEKDAYS[d.getDay()]}</div></div>
    <div class="item__body">
      <div class="item__title">${esc(w.title || typeLabel(w.type))}</div>
      <div class="item__meta">${esc(typeLabel(w.type))} · ${fmtMin(w.duration)} · интенсивность ${w.intensity}/5${w.distance ? " · " + w.distance + " км" : ""}</div>
    </div>
    <div class="item__right">
      <span class="item__num">${w.calories ? w.calories + " ккал" : ""}</span>
      <div class="item__actions">
        <button class="icon-btn" data-open="workout/${w.id}" title="Изменить">${icon("edit")}</button>
        <button class="icon-btn icon-btn--danger" data-del-workout="${w.id}" title="Удалить">${icon("trash")}</button>
      </div>
    </div>
  </div>`;
}

/* ---------------- workouts ---------------- */
function viewWorkouts() {
  const filters = [["all", "Все"], ...Object.entries(TYPES).map(([k, v]) => [k, v.label])];
  const list = state.workouts.filter((w) => state.filter === "all" || w.type === state.filter);
  let content;
  if (!list.length) {
    content = emptyBlock("Ничего нет", "В этом фильтре пусто. Добавь тренировку или смени фильтр.", "Добавить", "#/workout");
  } else {
    const groups = {};
    list.forEach((w) => { const d = parseDate(w.date); const k = `${d.getFullYear()}-${d.getMonth()}`; (groups[k] = groups[k] || []).push(w); });
    content = Object.entries(groups).map(([k, items]) => {
      const d = parseDate(items[0].date);
      const total = items.reduce((s, w) => s + w.duration, 0);
      return `<div class="card" style="margin-bottom:16px">
        <div class="card__head">
          <h2 class="card__title">${monthName(d)} ${d.getFullYear()}</h2>
          <span class="micro">${items.length} ${plural(items.length, "тренировка", "тренировки", "тренировок")} · ${fmtMin(total)}</span>
        </div>
        <div class="list">${items.map(itemWorkout).join("")}</div>
      </div>`;
    }).join("");
  }
  return `
    <div class="page-head">
      <div class="segment" id="filter">
        ${filters.map(([k, l]) => `<button data-filter="${k}" class="${state.filter === k ? "is-active" : ""}">${l}</button>`).join("")}
      </div>
      <a class="btn btn--accent" href="#/workout">${icon("plus")} Добавить</a>
    </div>
    ${content}`;
}

/* ---------------- editor ---------------- */
async function viewWorkoutEditor(id) {
  const existing = id ? state.workouts.find((w) => w.id === id) : null;
  const sets = existing ? await workoutSets(existing.id) : [];
  state.editingSets = sets.length ? sets.map((s) => ({ ...s })) : [{ name: "", weight: "", reps: "", count: 3, rest: 90 }];
  const w = existing || {
    date: todayKey(), type: "strength", title: "", duration: 60, intensity: 3,
    distance: 0, avgHr: 0, calories: 0, note: "",
  };
  return `
    <form id="workout-form" class="stack" style="max-width:820px">
      <div class="card">
        <div class="card__head"><h2 class="card__title">Основа</h2><span class="micro">${existing ? "изменение" : "новая запись"}</span></div>
        <div class="form">
          <div class="field--inline" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="w-date">Дата</label><input class="input" id="w-date" name="date" type="date" value="${w.date}" required></div>
            <div class="field"><label for="w-type">Тип</label>
              <select class="select" id="w-type" name="type">
                ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${w.type === k ? "selected" : ""}>${v.label}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="field"><label for="w-title">Название</label>
            <input class="input" id="w-title" name="title" placeholder="Например, верх тела" value="${esc(w.title)}">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="w-duration">Длительность, мин</label><input class="input" id="w-duration" name="duration" type="number" min="1" max="600" value="${w.duration}" required></div>
            <div class="field"><label for="w-intensity">Интенсивность: <b id="int-val">${w.intensity}</b>/5</label>
              <input class="range" id="w-intensity" name="intensity" type="range" min="1" max="5" step="1" value="${w.intensity}">
              <div class="range-scale"><span>лёгкая</span><span>средняя</span><span>тяжёлая</span></div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px" id="cardio-extra">
            <div class="field"><label for="w-distance">Дистанция, км</label><input class="input" id="w-distance" name="distance" type="number" step="0.1" min="0" value="${w.distance || ""}"></div>
            <div class="field"><label for="w-hr">Средний пульс</label><input class="input" id="w-hr" name="avgHr" type="number" min="0" max="230" value="${w.avgHr || ""}"></div>
            <div class="field"><label for="w-cal">Калории</label><input class="input" id="w-cal" name="calories" type="number" min="0" value="${w.calories || ""}" placeholder="авто"></div>
          </div>
          <div class="field"><label for="w-note">Заметка</label><textarea class="textarea" id="w-note" name="note" placeholder="Как прошло, что менять в следующий раз">${esc(w.note)}</textarea></div>
        </div>
      </div>

      <div class="card" id="sets-card">
        <div class="card__head">
          <h2 class="card__title">Упражнения</h2>
          <button class="btn btn--sm" type="button" id="add-set">${icon("plus")} Подход</button>
        </div>
        <div id="sets"></div>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">Тоннаж считается по весу, повторениям и подходам. Для кардио блок можно оставить пустым.</p>
      </div>

      <div class="row" style="justify-content:space-between">
        <div>${existing ? `<button class="btn btn--danger" type="button" id="del-w">${icon("trash")} Удалить</button>` : ""}</div>
        <div class="row">
          <a class="btn btn--ghost" href="#/workouts">Отмена</a>
          <button class="btn btn--accent" type="submit">${icon("check")} Сохранить</button>
        </div>
      </div>
    </form>`;
}

function renderSets() {
  const box = $("#sets");
  if (!box) return;
  box.innerHTML = state.editingSets.map((s, i) => `
    <div class="set-row" style="display:grid;grid-template-columns:1.6fr .7fr .7fr .7fr .8fr 34px;gap:8px;align-items:end;margin-bottom:8px">
      <div class="field" style="gap:4px"><label style="font-size:11px">Упражнение</label><input class="input" data-set="name" data-i="${i}" value="${esc(s.name)}" placeholder="Жим лёжа"></div>
      <div class="field" style="gap:4px"><label style="font-size:11px">Вес</label><input class="input" data-set="weight" data-i="${i}" type="number" step="0.5" value="${s.weight || ""}"></div>
      <div class="field" style="gap:4px"><label style="font-size:11px">Повт.</label><input class="input" data-set="reps" data-i="${i}" type="number" value="${s.reps || ""}"></div>
      <div class="field" style="gap:4px"><label style="font-size:11px">Подх.</label><input class="input" data-set="count" data-i="${i}" type="number" value="${s.count || ""}"></div>
      <div class="field" style="gap:4px"><label style="font-size:11px">Отдых, с</label><input class="input" data-set="rest" data-i="${i}" type="number" value="${s.rest || ""}"></div>
      <button class="icon-btn icon-btn--danger" type="button" data-rm-set="${i}" title="Убрать">${icon("close")}</button>
    </div>`).join("");
}

/* ---------------- recovery ---------------- */
function viewRecovery() {
  const today = todayKey();
  const rec = state.recovery.find((r) => r.date === today) || {
    date: today, sleep: 7, quality: 4, hr: state.profile.hrRest, fatigue: 3, soreness: 2, mood: 4, stress: 2, note: "",
  };
  const ratio = acwr(state.workouts, today);
  const score = recoveryScore(rec, ratio);
  const history = state.recovery.slice(0, 14);
  return `
    <div class="grid grid--2">
      <form class="card" id="recovery-form">
        <div class="card__head"><h2 class="card__title">Отметка за сегодня</h2><span class="micro">${longDate(new Date())}</span></div>
        <div class="form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="r-sleep">Сон, часов</label><input class="input" id="r-sleep" name="sleep" type="number" step="0.1" min="0" max="16" value="${rec.sleep}" required></div>
            <div class="field"><label for="r-quality">Качество сна: <b id="q-val">${rec.quality}</b>/5</label><input class="range" id="r-quality" name="quality" type="range" min="1" max="5" value="${rec.quality}"></div>
          </div>
          <div class="field"><label for="r-hr">Пульс покоя, уд/мин</label><input class="input" id="r-hr" name="hr" type="number" min="30" max="120" value="${rec.hr}" required></div>

          ${["fatigue", "soreness", "mood", "stress"].map((k) => {
            const labels = { fatigue: "Усталость", soreness: "Болят мышцы", mood: "Настроение", stress: "Стресс" };
            return `<div class="field"><label for="r-${k}">${labels[k]}: <b id="${k}-val">${rec[k]}</b>/10</label>
              <input class="range" id="r-${k}" name="${k}" type="range" min="1" max="10" value="${rec[k]}"></div>`;
          }).join("")}

          <div class="field"><label for="r-note">Заметка</label><textarea class="textarea" id="r-note" name="note" placeholder="Например: забились ноги после приседа">${esc(rec.note)}</textarea></div>
          <button class="btn btn--accent" type="submit">${icon("check")} Сохранить отметку</button>
        </div>
      </form>

      <div class="card">
        <div class="card__head"><h2 class="card__title">Что получается</h2></div>
        ${score ? `<div class="row" style="gap:18px;align-items:center">
            <div style="transform:scale(.82);transform-origin:center">${gauge(score.value, score.tone)}</div>
            <div>
              <div class="verdict verdict--${score.tone}">${esc(score.verdict)}</div>
              <p class="muted" style="font-size:13px;margin:12px 0 0">${esc(score.advice)}</p>
            </div>
          </div>
          <div class="divider" style="margin:16px 0"></div>
          <div class="grid grid--3" style="gap:10px">
            <div class="kpi"><span class="kpi__v">${score.parts.S}%</span><span class="kpi__l">сон</span></div>
            <div class="kpi"><span class="kpi__v">${score.parts.H}%</span><span class="kpi__l">пульс</span></div>
            <div class="kpi"><span class="kpi__v">${score.parts.F}%</span><span class="kpi__l">усталость</span></div>
          </div>` : `<p class="muted">Заполни форму слева — покажу расчёт.</p>`}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card__head"><h2 class="card__title">История</h2><span class="micro">14 дней</span></div>
      <div class="list">
        ${history.map((r) => {
          const s = recoveryScore(r, acwr(state.workouts, r.date));
          return `<div class="item" style="cursor:default">
            <div class="item__date"><div class="item__day">${parseDate(r.date).getDate()}</div><div class="item__wd">${WEEKDAYS[parseDate(r.date).getDay()]}</div></div>
            <div class="item__body">
              <div class="item__title">Сон ${r.sleep} ч · пульс ${r.hr} · усталость ${r.fatigue}/10</div>
              <div class="item__meta">${r.note ? esc(r.note) : "без заметки"}</div>
            </div>
            <div class="item__right">
              <span class="chip ${s.value >= 60 ? "chip--accent" : ""}">${s.value}</span>
              <button class="icon-btn icon-btn--danger" data-del-recovery="${r.id}" title="Удалить">${icon("trash")}</button>
            </div>
          </div>`;
        }).join("") || `<p class="muted">Пока нет записей.</p>`}
      </div>
    </div>`;
}

/* ---------------- stats ---------------- */
function viewStats() {
  const days = state.statsDays;
  const today = todayKey();
  const from = isoDate(addDays(new Date(), -(days - 1)));
  const period = periodStats(state.workouts, from, today);
  const recs = state.recovery.filter((r) => r.date >= from).slice().reverse();
  const values = recs.map((r, i) => recoveryScore(r, acwr(state.workouts, r.date)).value);
  const labels = recs.map((r) => parseDate(r.date).getDate());
  const wk = weekLoad(state.workouts, today);
  const byType = Object.keys(TYPES).map((t) => ({ t, n: state.workouts.filter((w) => w.type === t && w.date >= from).length, min: state.workouts.filter((w) => w.type === t && w.date >= from).reduce((s, w) => s + w.duration, 0) }));
  const maxType = Math.max(1, ...byType.map((x) => x.min));

  return `
    <div class="page-head">
      <div class="segment" id="stats-period">
        <button data-days="7" class="${days === 7 ? "is-active" : ""}">7 дней</button>
        <button data-days="30" class="${days === 30 ? "is-active" : ""}">30 дней</button>
        <button data-days="90" class="${days === 90 ? "is-active" : ""}">90 дней</button>
      </div>
      <span class="micro">${humanDate(from)} — ${humanDate(today)}</span>
    </div>

    <div class="grid grid--4">
      <div class="kpi"><span class="kpi__v">${period.count}</span><span class="kpi__l">тренировок</span></div>
      <div class="kpi"><span class="kpi__v">${fmtMin(period.minutes)}</span><span class="kpi__l">времени</span></div>
      <div class="kpi"><span class="kpi__v">${period.load}</span><span class="kpi__l">нагрузка</span></div>
      <div class="kpi"><span class="kpi__v">${streak(state.workouts, today)}</span><span class="kpi__l">дней подряд</span></div>
    </div>

    <div class="grid grid--2" style="margin-top:16px">
      <div class="card">
        <div class="card__head"><h2 class="card__title">Нагрузка по дням</h2><span class="micro">7 дней</span></div>
        ${barChart(wk)}
      </div>
      <div class="card">
        <div class="card__head"><h2 class="card__title">Индекс восстановления</h2><span class="micro">${values.length} отметок</span></div>
        ${values.length ? lineChart(values, labels) : `<div class="empty">Нет данных за период</div>`}
      </div>
    </div>

    <div class="grid grid--2" style="margin-top:16px">
      <div class="card">
        <div class="card__head"><h2 class="card__title">Структура тренировок</h2></div>
        <div class="stack" style="gap:12px">
          ${byType.map((x) => `
            <div>
              <div class="row row--between" style="font-size:13px;margin-bottom:6px">
                <span>${typeLabel(x.t)}</span><span class="muted mono">${x.n} · ${fmtMin(x.min)}</span>
              </div>
              <div style="height:8px;background:#20272F;border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${Math.round((x.min / maxType) * 100)}%;background:${typeColor(x.t)};opacity:.85"></div>
              </div>
            </div>`).join("")}
        </div>
      </div>
      <div class="card">
        <div class="card__head"><h2 class="card__title">Восстановление</h2></div>
        <div class="grid grid--2" style="gap:12px">
          <div class="stat"><span class="stat__label">Средний сон</span><span class="stat__value mono">${avg(recs, "sleep").toFixed(1)} ч</span></div>
          <div class="stat"><span class="stat__label">Средний пульс</span><span class="stat__value mono">${Math.round(avg(recs, "hr"))}</span></div>
          <div class="stat"><span class="stat__label">Средний индекс</span><span class="stat__value mono">${values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : "—"}</span></div>
          <div class="stat"><span class="stat__label">Отметок</span><span class="stat__value mono">${recs.length}</span></div>
        </div>
        <div class="divider" style="margin:16px 0"></div>
        <p class="muted" style="font-size:12.5px;margin:0">Цель: ${state.goals.weeklyWorkouts} тренировки и ${fmtMin(state.goals.weeklyMinutes)} в неделю.</p>
      </div>
    </div>`;
}

/* ---------------- settings ---------------- */
function viewSettings() {
  const p = state.profile;
  return `
    <div class="grid grid--2">
      <form class="card" id="profile-form">
        <div class="card__head"><h2 class="card__title">Профиль</h2></div>
        <div class="form">
          <div class="field"><label for="p-name">Имя</label><input class="input" id="p-name" name="name" value="${esc(p.name)}"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="p-weight">Вес, кг</label><input class="input" id="p-weight" name="weight" type="number" step="0.1" value="${p.weight}"></div>
            <div class="field"><label for="p-height">Рост, см</label><input class="input" id="p-height" name="height" type="number" value="${p.height}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="p-hrmax">Макс. пульс</label><input class="input" id="p-hrmax" name="hrMax" type="number" value="${p.hrMax}"></div>
            <div class="field"><label for="p-hrrest">Пульс покоя (норма)</label><input class="input" id="p-hrrest" name="hrRest" type="number" value="${p.hrRest}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label for="p-gw">Цель: тренировок в неделю</label><input class="input" id="p-gw" name="goalWorkouts" type="number" min="1" max="14" value="${state.goals.weeklyWorkouts}"></div>
            <div class="field"><label for="p-gm">Цель: минут в неделю</label><input class="input" id="p-gm" name="goalMinutes" type="number" min="30" max="2000" value="${state.goals.weeklyMinutes}"></div>
          </div>
          <button class="btn btn--accent" type="submit">${icon("check")} Сохранить</button>
        </div>
      </form>

      <div class="stack">
        <div class="card">
          <div class="card__head"><h2 class="card__title">Данные</h2><span class="micro">локально</span></div>
          <p class="muted" style="font-size:13px;margin:0 0 14px">Всё хранится в браузере на этом устройстве. Никакой регистрации и облака.</p>
          <div class="row" style="flex-wrap:wrap;gap:10px">
            <button class="btn" id="export-json">${icon("download")} Экспорт JSON</button>
            <button class="btn" id="export-csv">${icon("download")} Экспорт CSV</button>
            <label class="btn btn--ghost" style="cursor:pointer">${icon("upload")} Импорт<input type="file" id="import-file" accept="application/json" hidden></label>
          </div>
          <div class="divider" style="margin:16px 0"></div>
          <div class="row" style="flex-wrap:wrap;gap:10px">
            <button class="btn btn--ghost" id="seed-demo">Заполнить демо-данными</button>
            <button class="btn btn--danger" id="clear-all">${icon("trash")} Очистить всё</button>
          </div>
        </div>

        ${SYNC ? `
        <div class="card">
          <div class="card__head"><h2 class="card__title">Синхронизация</h2></div>
          <div id="sync-settings"></div>
        </div>` : `
        <div class="card">
          <div class="card__head"><h2 class="card__title">Версия</h2><span class="chip chip--accent">PWA</span></div>
          <p class="muted" style="font-size:13px;margin:0">Офлайн-версия: данные живут только на этом устройстве, синхронизации нет. Перенос — через экспорт и импорт JSON.</p>
        </div>`}

        <div class="card">
          <div class="card__head"><h2 class="card__title">О приложении</h2></div>
          <p class="muted" style="font-size:12.5px;margin:0 0 8px">Форма · дневник тренировок и восстановления. Курсовой проект, МДК 01.03.</p>
          <p class="dim" style="font-size:11.5px;margin:0">Версия ${window.APP_VERSION || "1.0.0"} · ${SYNC ? "sync" : "standalone"}</p>
        </div>
      </div>
    </div>`;
}

function viewAccount() {
  if (!SYNC) return emptyBlock("Только в версии с синхронизацией", "Эта сборка работает офлайн.", "", "");
  return `<div class="card" style="max-width:520px">
    <div class="card__head"><h2 class="card__title">Вход</h2></div>
    <div id="account-box"><div class="empty">Загрузка…</div></div>
  </div>`;
}

/* ---------------- mount / events ---------------- */
function mount(route) {
  if (route === "workout") {
    renderSets();
    const form = $("#workout-form");
    const int = $("#w-intensity");
    int && int.addEventListener("input", () => { $("#int-val").textContent = int.value; });
    $("#add-set")?.addEventListener("click", () => {
      state.editingSets.push({ name: "", weight: "", reps: "", count: 3, rest: 90 });
      renderSets();
    });
    $("#sets")?.addEventListener("input", (e) => {
      const t = e.target.closest("[data-set]");
      if (!t) return;
      state.editingSets[+t.dataset.i][t.dataset.set] = t.value;
    });
    $("#sets")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-rm-set]");
      if (!b) return;
      state.editingSets.splice(+b.dataset.rmSet, 1);
      renderSets();
    });
    form?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      const payload = {
        id: state.param || undefined,
        date: data.date, type: data.type, title: data.title,
        duration: data.duration, intensity: data.intensity,
        distance: data.distance, avgHr: data.avgHr, calories: data.calories, note: data.note,
      };
      if (!payload.calories) {
        const met = (TYPES[payload.type] || TYPES.strength).met;
        payload.calories = Math.round(met * 3.5 * (state.profile.weight || 78) / 200 * payload.duration);
      }
      await saveWorkout(payload, data.type === "strength" ? state.editingSets : []);
      toast("Тренировка сохранена", "ok");
      if (SYNC && state.sync.ready) import("./sync.js").then((m) => m.syncNow().catch(() => {}));
      nav("workouts");
    });
    $("#del-w")?.addEventListener("click", async () => {
      if (!(await confirmDialog("Удалить тренировку?", "Запись и все подходы исчезнут. Действие необратимо."))) return;
      await deleteWorkout(state.param);
      toast("Удалено");
      nav("workouts");
    });
  }

  if (route === "workouts") {
    $("#filter")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      state.filter = b.dataset.filter;
      render();
    });
  }

  if (route === "recovery") {
    const form = $("#recovery-form");
    const pairs = [["quality", "q-val"], ["fatigue", "fatigue-val"], ["soreness", "soreness-val"], ["mood", "mood-val"], ["stress", "stress-val"]];
    pairs.forEach(([k, id]) => {
      const el = form?.querySelector(`#r-${k}`);
      el?.addEventListener("input", () => { const t = document.getElementById(id); if (t) t.textContent = el.value; });
    });
    form?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      await saveRecovery({ ...data, date: todayKey() });
      toast("Отметка сохранена", "ok");
      if (SYNC && state.sync.ready) import("./sync.js").then((m) => m.syncNow().catch(() => {}));
      render();
    });
  }

  if (route === "stats") {
    $("#stats-period")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-days]");
      if (!b) return;
      state.statsDays = +b.dataset.days;
      render();
    });
  }

  if (route === "settings") {
    $("#profile-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target).entries());
      await saveProfile({
        name: d.name, weight: +d.weight, height: +d.height,
        hrMax: +d.hrMax, hrRest: +d.hrRest, onboarded: true,
      });
      await saveGoals({ weeklyWorkouts: +d.goalWorkouts, weeklyMinutes: +d.goalMinutes });
      toast("Сохранено", "ok");
      render();
    });
    $("#export-json")?.addEventListener("click", exportJSON);
    $("#export-csv")?.addEventListener("click", exportCSV);
    $("#import-file")?.addEventListener("change", importJSON);
    $("#seed-demo")?.addEventListener("click", async () => {
      if (!(await confirmDialog("Добавить демо-данные?", "Появятся записи за последние 4 недели. Твои данные не удаляются.", "Добавить"))) return;
      await seedDemo();
      toast("Демо-данные добавлены", "ok");
      render();
    });
    $("#clear-all")?.addEventListener("click", async () => {
      if (!(await confirmDialog("Очистить всё?", "Тренировки, восстановление и настройки будут удалены безвозвратно."))) return;
      for (const s of ["workouts", "sets", "recovery", "goals"]) await db.clear(s);
      toast("Данные удалены");
      render();
    });
    if (SYNC) import("./sync.js").then((m) => m.mountSettings($("#sync-settings")));
  }

  if (route === "account" && SYNC) {
    import("./sync.js").then((m) => m.mountAccount($("#account-box")));
  }
}

/* ---------------- export / import ---------------- */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportJSON() {
  const payload = {
    app: "forma", version: 1, exported_at: new Date().toISOString(),
    workouts: await db.all("workouts"), sets: await db.all("sets"),
    recovery: await db.all("recovery"), goals: await getGoals(), profile: await getProfile(),
  };
  download(`forma-${todayKey()}.json`, JSON.stringify(payload, null, 2), "application/json");
  toast("Файл сохранён", "ok");
}

async function exportCSV() {
  const rows = [["date", "type", "title", "duration_min", "intensity", "distance_km", "avg_hr", "calories", "note"]];
  for (const w of state.workouts) rows.push([w.date, w.type, w.title, w.duration, w.intensity, w.distance, w.avgHr, w.calories, (w.note || "").replaceAll("\n", " ")]);
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
  download(`forma-${todayKey()}.csv`, csv, "text/csv;charset=utf-8");
  toast("CSV сохранён", "ok");
}

async function importJSON(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    for (const s of ["workouts", "sets", "recovery"]) {
      if (Array.isArray(data[s])) await db.putMany(s, data[s]);
    }
    if (data.goals) await db.put("goals", data.goals);
    if (data.profile) await db.put("profile", { ...data.profile, id: "main" });
    toast("Импорт завершён", "ok");
    render();
  } catch (e) {
    toast("Не получилось прочитать файл", "err");
  } finally {
    ev.target.value = "";
  }
}

/* ---------------- global listeners ---------------- */
document.addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open]");
  if (open) { nav(open.dataset.open); return; }
  const del = e.target.closest("[data-del-workout]");
  if (del) {
    e.stopPropagation();
    if (await confirmDialog("Удалить тренировку?", "Запись и подходы исчезнут.")) {
      await deleteWorkout(del.dataset.delWorkout);
      toast("Удалено");
      render();
    }
    return;
  }
  const delR = e.target.closest("[data-del-recovery]");
  if (delR) {
    if (await confirmDialog("Удалить отметку?", "День исчезнет из истории.")) {
      await deleteRecovery(delR.dataset.delRecovery);
      toast("Удалено");
      render();
    }
  }
});

$("#quick-add")?.addEventListener("click", () => nav("workout"));
window.addEventListener("hashchange", render);

/* ---------------- boot ---------------- */
(async function boot() {
  await refresh();
  if (new URLSearchParams(location.search).get("demo") === "1" && !state.workouts.length) {
    await seedDemo();
    await refresh();
  }
  if (SYNC) {
    const m = await import("./sync.js");
    await m.init();
    m.onStatus((s) => {
      state.sync = { ...state.sync, ...s };
      const pill = $("#sync-pill");
      if (!pill) return;
      pill.hidden = false;
      pill.className = "pill " + (s.state === "ok" ? "pill--ok" : s.state === "error" ? "pill--err" : s.state === "syncing" ? "pill--wait" : "");
      pill.querySelector("span").textContent = s.label || "Синхронизация";
    });
  }
  await render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
