export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function icon(name, cls = "") {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function toast(message, kind = "") {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind ? "toast--" + kind : ""}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

export function openModal({ title, body, actions }) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__box">
        <div class="modal__head">
          <h3 class="modal__title">${esc(title)}</h3>
          <button class="icon-btn" data-close type="button" aria-label="Закрыть">${icon("close")}</button>
        </div>
        <div class="modal__body">${body}</div>
        <div class="modal__foot row" style="justify-content:flex-end;gap:10px;margin-top:20px">
          ${actions || `<button class="btn" data-close type="button">Закрыть</button>`}
        </div>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ""; };
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  root.querySelector(".modal").addEventListener("click", (e) => { if (e.target.classList.contains("modal")) close(); });
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
  });
  return { close, root };
}

export function confirmDialog(title, text, okLabel = "Удалить") {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: `<p class="muted" style="margin:0">${esc(text)}</p>`,
      actions: `<button class="btn" data-close type="button">Отмена</button>
                <button class="btn btn--danger" data-ok type="button">${esc(okLabel)}</button>`,
    });
    m.root.querySelector("[data-ok]").addEventListener("click", () => { m.close(); resolve(true); });
    m.root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => resolve(false)));
  });
}

export function gauge(value, tone = "good") {
  const r = 84, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  const colors = { good: "#D8FF3E", mid: "#F5B84C", low: "#FF6B6B" };
  const col = colors[tone] || colors.good;
  return `
  <div class="gauge">
    <svg viewBox="0 0 210 210" role="img" aria-label="Индекс восстановления ${value} из 100">
      <circle class="gauge__track" cx="105" cy="105" r="${r}"/>
      <circle class="gauge__fill" cx="105" cy="105" r="${r}" style="stroke:${col}"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <div class="gauge__body">
      <div class="gauge__value" style="color:#E7EDF3">${value}</div>
      <div class="gauge__label">из 100</div>
    </div>
  </div>`;
}

export function barChart(days) {
  const W = 640, H = 210, pad = 28, bottom = 34;
  const max = Math.max(60, ...days.map((d) => d.load));
  const bw = (W - pad * 2) / days.length;
  const bars = days.map((d, i) => {
    const h = Math.round((d.load / max) * (H - pad - bottom));
    const x = pad + i * bw + bw / 2;
    const y = H - bottom - h;
    const isMax = d.load === Math.max(...days.map((x) => x.load)) && d.load > 0;
    return `
      <rect class="bar ${isMax ? "bar--accent" : ""}" x="${x - 13}" y="${y}" width="26" height="${Math.max(2, h)}" rx="6"/>
      <text class="axis" x="${x}" y="${H - 12}" text-anchor="middle">${esc(d.weekday)}</text>
      ${d.load > 0 ? `<text class="axis" x="${x}" y="${y - 8}" text-anchor="middle" style="fill:#8B98A7">${d.load}</text>` : ""}`;
  }).join("");
  const lines = [0.25, 0.5, 0.75, 1].map((k) => {
    const y = H - bottom - (H - pad - bottom) * k;
    return `<line class="grid-line" x1="${pad}" x2="${W - pad}" y1="${y}" y2="${y}"/>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto">${lines}${bars}</svg>`;
}

export function lineChart(values, labels = []) {
  const W = 640, H = 220, pad = 30, bottom = 30;
  if (!values.length) return "";
  const max = 100, min = 0;
  const step = values.length > 1 ? (W - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = H - bottom - ((v - min) / (max - min)) * (H - pad - bottom);
    return [x, y];
  });
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${H - bottom} L ${pts[0][0].toFixed(1)} ${H - bottom} Z`;
  const dots = pts.map((p) => `<circle class="point" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5"/>`).join("");
  const gl = [0, 25, 50, 75, 100].map((v) => {
    const y = H - bottom - (v / 100) * (H - pad - bottom);
    return `<line class="grid-line" x1="${pad}" x2="${W - pad}" y1="${y}" y2="${y}"/>
            <text class="axis" x="${pad - 8}" y="${y + 3}" text-anchor="end">${v}</text>`;
  }).join("");
  const xl = labels.map((l, i) => {
    if (values.length > 8 && i % 2) return "";
    const x = pad + i * step;
    return `<text class="axis" x="${x}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto">
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#D8FF3E" stop-opacity=".22"/>
      <stop offset="100%" stop-color="#D8FF3E" stop-opacity="0"/>
    </linearGradient></defs>
    ${gl}<path class="area" d="${area}"/><path class="line" d="${line}"/>${dots}${xl}
  </svg>`;
}
