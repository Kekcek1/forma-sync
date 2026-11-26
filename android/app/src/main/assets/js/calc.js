export const TYPES = {
  strength: { label: "Силовая", color: "#D8FF3E", met: 5.5 },
  cardio:   { label: "Кардио",   color: "#5AA9FF", met: 8.0 },
  mobility: { label: "Растяжка", color: "#3ED598", met: 2.5 },
  sport:    { label: "Спорт",    color: "#F5B84C", met: 7.0 },
};

export const typeLabel = (t) => (TYPES[t] || TYPES.strength).label;
export const typeColor = (t) => (TYPES[t] || TYPES.strength).color;

export const isoDate = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

export const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
export const WEEKDAYS_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const humanDate = (s) => {
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Нагрузка тренировки: минуты × коэффициент интенсивности. */
export function loadOf(w) {
  const f = 0.6 + 0.16 * clamp(w.intensity || 3, 1, 5);
  return (w.duration || 0) * f;
}

export function loadBetween(workouts, from, to) {
  return workouts
    .filter((w) => w.date >= from && w.date <= to)
    .reduce((s, w) => s + loadOf(w), 0);
}

/** ACWR: острая (7 дней) к средней недельной хронической (28 дней). */
export function acwr(workouts, today = isoDate()) {
  const d7 = isoDate(addDays(parseDate(today), -6));
  const d28 = isoDate(addDays(parseDate(today), -27));
  const acute = loadBetween(workouts, d7, today);
  const total28 = loadBetween(workouts, d28, today);
  const chronicWeek = total28 / 4;
  if (!chronicWeek) return acute > 0 ? 1 : 0;
  return acute / chronicWeek;
}

/**
 * Индекс восстановления 0–100.
 * S — сон, Q — качество сна, H — пульс покоя, F — усталость, M — настроение.
 */
export function recoveryScore(rec, ratio) {
  if (!rec) return null;
  const S = clamp((rec.sleep || 0) / 8, 0, 1);
  const Q = clamp((rec.quality || 0) / 5, 0, 1);
  const H = 1 - clamp(((rec.hr || 60) - 45) / 45, 0, 1);
  const F = 1 - clamp(((rec.fatigue || 5) - 1) / 9, 0, 1);
  const M = clamp(((rec.mood || 3) - 1) / 4, 0, 1);

  let value = 100 * (0.30 * S + 0.15 * Q + 0.20 * H + 0.25 * F + 0.10 * M);
  const penalty = ratio > 1.5 ? 10 : 0;
  value = Math.round(clamp(value - penalty, 0, 100));

  let verdict, tone, advice;
  if (value >= 80) {
    verdict = "Готов к нагрузке"; tone = "good";
    advice = "Можно работать интенсивно: тяжёлые подходы или интервалы.";
  } else if (value >= 60) {
    verdict = "Умеренно"; tone = "mid";
    advice = "Держи среднюю интенсивность, оставь запас в 1–2 повторения.";
  } else if (value >= 40) {
    verdict = "Лёгкая нагрузка"; tone = "mid";
    advice = "Техника, мобильность, спокойное кардио. Без рекордов.";
  } else {
    verdict = "Восстановление"; tone = "low";
    advice = "Сегодня отдых: сон, еда, прогулка. Тренировка не даст результата.";
  }
  return {
    value, verdict, tone, advice, penalty,
    parts: { S: Math.round(S * 100), Q: Math.round(Q * 100), H: Math.round(H * 100), F: Math.round(F * 100), M: Math.round(M * 100) },
  };
}

export function weekLoad(workouts, endDate = isoDate()) {
  const end = parseDate(endDate);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(end, -i);
    const key = isoDate(d);
    const list = workouts.filter((w) => w.date === key);
    days.push({
      date: key,
      weekday: WEEKDAYS[d.getDay()],
      num: d.getDate(),
      minutes: list.reduce((s, w) => s + (w.duration || 0), 0),
      load: Math.round(list.reduce((s, w) => s + loadOf(w), 0)),
      count: list.length,
    });
  }
  return days;
}

export function periodStats(workouts, from, to) {
  const list = workouts.filter((w) => w.date >= from && w.date <= to);
  return {
    count: list.length,
    minutes: list.reduce((s, w) => s + (w.duration || 0), 0),
    load: Math.round(list.reduce((s, w) => s + loadOf(w), 0)),
    calories: list.reduce((s, w) => s + (w.calories || 0), 0),
  };
}

export function streak(workouts, today = isoDate()) {
  const dates = new Set(workouts.map((w) => w.date));
  let n = 0;
  let d = parseDate(today);
  if (!dates.has(isoDate(d))) d = addDays(d, -1);
  while (dates.has(isoDate(d))) { n++; d = addDays(d, -1); }
  return n;
}

export function avg(list, key) {
  const vals = list.map((x) => Number(x[key]) || 0).filter((v) => v > 0);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function fmtMin(m) {
  if (!m) return "0 мин";
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h} ч ${r ? r + " мин" : ""}`.trim() : `${Math.round(m)} мин`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
