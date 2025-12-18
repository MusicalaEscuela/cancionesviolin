const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTU3F5BzPMQl8HlmVekRHQ4LI36mZUxHJixkQvA0JAj_PJt_Ne0Hqa3AEUgzk-jeHfnj2OT_9yRJSAC/pub?output=csv";

const IDX = {
  name: 0,
  artist: 1,
  genre: 2,
  level: 3,
  content: 4,
};

const GUIDE_COLS = {
  F: { idx: 5, label: "🔢 Números" },
  G: { idx: 6, label: "🎼 Notas" },
  H: { idx: 7, label: "📄 Partitura" },
};

const LS = {
  guide: "musicala_violin_guide",
  view: "musicala_violin_view",
  sort: "musicala_violin_sort",
  levelMin: "musicala_violin_level_min",
  progress: "musicala_violin_progress_v1"
};

let rows = [];      // csv completo
let groups = [];    // canciones agrupadas
let state = {
  guide: "F",
  view: "cards", // cards | table
  search: "",
  sort: "name-asc",
  levelMin: 0,
};

let progress = {}; // { songKey: "none" | "doing" | "done" }

const $ = (id) => document.getElementById(id);

function escapeHTML(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseStars(starText = "") {
  // cuenta ★ (no ☆)
  const s = String(starText);
  let count = 0;
  for (const ch of s) if (ch === "★") count++;
  return count; // 0..5
}

function normalizeKey(s = "") {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ");
}

function isLink(val = "") {
  return /^https?:\/\//i.test(String(val).trim());
}

// CSV parse robusto (comillas y comas)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out = [];

  for (const line of lines) {
    const row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        row.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    row.push(cur);
    out.push(row);
  }
  return out;
}

function loadState() {
  const g = localStorage.getItem(LS.guide);
  const v = localStorage.getItem(LS.view);
  const s = localStorage.getItem(LS.sort);
  const lm = localStorage.getItem(LS.levelMin);

  if (g && GUIDE_COLS[g]) state.guide = g;
  if (v === "cards" || v === "table") state.view = v;
  if (s) state.sort = s;
  if (lm && !Number.isNaN(Number(lm))) state.levelMin = Number(lm);

  const p = localStorage.getItem(LS.progress);
  if (p) {
    try { progress = JSON.parse(p) || {}; } catch { progress = {}; }
  }
}

function persistState() {
  localStorage.setItem(LS.guide, state.guide);
  localStorage.setItem(LS.view, state.view);
  localStorage.setItem(LS.sort, state.sort);
  localStorage.setItem(LS.levelMin, String(state.levelMin));
  localStorage.setItem(LS.progress, JSON.stringify(progress));
}

function setStatus(msg = "") {
  $("statusLabel").textContent = msg;
}

function setView(view) {
  state.view = view;
  $("cardsView").classList.toggle("hidden", view !== "cards");
  $("tableView").classList.toggle("hidden", view !== "table");

  $("viewCardsBtn").classList.toggle("active", view === "cards");
  $("viewTableBtn").classList.toggle("active", view === "table");

  persistState();
}

function groupSongs(dataRows) {
  const map = new Map();

  for (const r of dataRows) {
    const name = (r[IDX.name] || "").trim();
    if (!name) continue;

    const key = normalizeKey(name);
    if (!map.has(key)) {
      map.set(key, {
        key,
        name,
        artist: (r[IDX.artist] || "").trim(),
        genre: (r[IDX.genre] || "").trim(),
        levelStars: (r[IDX.level] || "").trim(),
        levelNum: parseStars(r[IDX.level] || ""),
        content: (r[IDX.content] || "").trim(),
        versions: { F: "", G: "", H: "" }, // puede ser link o texto
      });
    }

    const item = map.get(key);

    // mantener "mejor" metadata (si una fila está más completa)
    const lvl = parseStars(r[IDX.level] || "");
    if (lvl > item.levelNum) {
      item.levelNum = lvl;
      item.levelStars = (r[IDX.level] || "").trim();
    }
    if (!item.artist && r[IDX.artist]) item.artist = (r[IDX.artist] || "").trim();
    if (!item.genre && r[IDX.genre]) item.genre = (r[IDX.genre] || "").trim();
    if (!item.content && r[IDX.content]) item.content = (r[IDX.content] || "").trim();

    // versiones: toma la primera no vacía por cada guía
    for (const letter of Object.keys(GUIDE_COLS)) {
      const idx = GUIDE_COLS[letter].idx;
      const val = (r[idx] || "").trim();
      if (val && !item.versions[letter]) item.versions[letter] = val;
    }
  }

  return [...map.values()];
}

function matchesSearch(item, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  const hay = `${item.name} ${item.artist} ${item.genre}`.toLowerCase();
  return hay.includes(t);
}

function sortItems(items) {
  const by = state.sort;

  const copy = [...items];
  copy.sort((a, b) => {
    if (by === "name-asc") return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    if (by === "name-desc") return b.name.localeCompare(a.name, "es", { sensitivity: "base" });
    if (by === "level-asc") return (a.levelNum - b.levelNum) || a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    if (by === "level-desc") return (b.levelNum - a.levelNum) || a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    if (by === "genre-asc") return (a.genre || "").localeCompare(b.genre || "", "es", { sensitivity: "base" });
    return 0;
  });

  return copy;
}

function updateMeta(visible, total) {
  $("countPill").textContent = `Mostrando ${visible} de ${total}`;
  const done = Object.values(progress).filter(v => v === "done").length;
  $("progressPill").textContent = `Progreso: ${done} / ${total}`;
}

function setEmptyCards(show) {
  $("emptyCards").classList.toggle("hidden", !show);
}
function setEmptyTable(show) {
  $("emptyTable").classList.toggle("hidden", !show);
}

// MODAL
function openModal(item, guideLetter) {
  const guide = GUIDE_COLS[guideLetter];
  const val = (item.versions[guideLetter] || "").trim();

  $("modalTitle").textContent = item.name;
  $("modalMeta").textContent = `${item.artist || "—"} · ${item.genre || "—"} · ${item.levelStars || "—"}`;

  // contenido principal
  if (!val) {
    $("modalContent").textContent = "Esta versión aún no está disponible.";
    $("modalAction").innerHTML = "";
  } else if (isLink(val)) {
    $("modalContent").textContent = `Tipo de guía: ${guide.label.replace(/^[^ ]+\s/, "")}\n\nRecurso externo listo para abrir.`;
    $("modalAction").innerHTML = `<a class="btnLink" href="${escapeHTML(val)}" target="_blank" rel="noopener noreferrer">Abrir ${escapeHTML(guide.label)}</a>`;
  } else {
    $("modalContent").textContent = val;
    $("modalAction").innerHTML = "";
  }

  $("modalOverlay").classList.remove("hidden");
}

function closeModal() {
  $("modalOverlay").classList.add("hidden");
}

// RENDER CARDS
function renderCards() {
  const grid = $("cardsGrid");
  grid.innerHTML = "";

  const term = state.search.trim();
  let items = groups
    .filter(it => it.levelNum >= state.levelMin)
    .filter(it => matchesSearch(it, term));

  items = sortItems(items);

  updateMeta(items.length, groups.length);
  setEmptyCards(items.length === 0);

  for (const it of items) {
    const card = document.createElement("div");
    card.className = "card";

    const p = progress[it.key] || "none";

    // botones de versiones (solo si existe esa versión)
    const vBtns = Object.keys(GUIDE_COLS).map(letter => {
      const has = !!(it.versions[letter] || "").trim();
      const label = GUIDE_COLS[letter].label;
      const on = (letter === state.guide) ? "on" : "";
      return `<button class="vbtn ${on}" data-song="${escapeHTML(it.key)}" data-guide="${letter}" ${has ? "" : "disabled"} title="${has ? "Abrir" : "No disponible"}">${label}</button>`;
    }).join("");

    // progreso
    const doingActive = p === "doing" ? "active" : "";
    const doneActive  = p === "done"  ? "active" : "";

    card.innerHTML = `
      <div class="card__title">${escapeHTML(it.name)}</div>

      <div class="card__meta">
        <span class="badge">👤 ${escapeHTML(it.artist || "—")}</span>
        <span class="badge">🏷️ ${escapeHTML(it.genre || "—")}</span>
        <span class="badge">⭐ ${escapeHTML(it.levelStars || "—")}</span>
      </div>

      <div class="versions">${vBtns}</div>

      <div class="progressRow">
        <button class="pbtn ${doingActive}" data-prog="doing" data-song="${escapeHTML(it.key)}">⭐ En proceso</button>
        <button class="pbtn ${doneActive}" data-prog="done" data-song="${escapeHTML(it.key)}">✅ Lograda</button>
      </div>
    `;

    grid.appendChild(card);
  }

  // eventos (delegación)
  grid.onclick = (e) => {
    const v = e.target.closest(".vbtn");
    if (v && !v.disabled) {
      const key = v.dataset.song;
      const guide = v.dataset.guide;
      const item = groups.find(x => x.key === key);
      if (item) openModal(item, guide);
      return;
    }

    const pb = e.target.closest(".pbtn");
    if (pb) {
      const key = pb.dataset.song;
      const next = pb.dataset.prog;

      // toggle: si ya estaba, lo quita
      if (progress[key] === next) delete progress[key];
      else progress[key] = next;

      persistState();
      renderCards();
      return;
    }
  };
}

// RENDER TABLE (sigue existiendo, pero con filtro de nivel + búsqueda)
function renderTable() {
  const headerRow = $("headerRow");
  const tbody = $("tableBody");
  headerRow.innerHTML = "";
  tbody.innerHTML = "";

  const headers = rows[0] || [];
  const guideIdx = GUIDE_COLS[state.guide].idx;

  // headers: 0..4 + extra guía seleccionada
  const fixed = [IDX.name, IDX.artist, IDX.genre, IDX.level, IDX.content];

  for (const i of fixed) {
    const th = document.createElement("th");
    th.textContent = headers[i] || "";
    headerRow.appendChild(th);
  }
  const thx = document.createElement("th");
  thx.textContent = headers[guideIdx] || "Guía";
  headerRow.appendChild(thx);

  const term = state.search.trim().toLowerCase();

  const dataRows = rows.slice(1).filter(r => {
    const lvl = parseStars(r[IDX.level] || "");
    if (lvl < state.levelMin) return false;
    if (!term) return true;
    const hay = `${r[IDX.name] || ""} ${r[IDX.artist] || ""} ${r[IDX.genre] || ""}`.toLowerCase();
    return hay.includes(term);
  });

  // ordenar por lo mismo que cards (nombre / nivel / género)
  dataRows.sort((a, b) => {
    const an = (a[IDX.name] || "");
    const bn = (b[IDX.name] || "");
    const al = parseStars(a[IDX.level] || "");
    const bl = parseStars(b[IDX.level] || "");
    const ag = (a[IDX.genre] || "");
    const bg = (b[IDX.genre] || "");

    if (state.sort === "name-asc") return an.localeCompare(bn, "es", { sensitivity: "base" });
    if (state.sort === "name-desc") return bn.localeCompare(an, "es", { sensitivity: "base" });
    if (state.sort === "level-asc") return (al - bl) || an.localeCompare(bn, "es", { sensitivity: "base" });
    if (state.sort === "level-desc") return (bl - al) || an.localeCompare(bn, "es", { sensitivity: "base" });
    if (state.sort === "genre-asc") return ag.localeCompare(bg, "es", { sensitivity: "base" });
    return 0;
  });

  $("countPill").textContent = `Mostrando ${dataRows.length} filas`;
  setEmptyTable(dataRows.length === 0);

  for (const r of dataRows) {
    const tr = document.createElement("tr");

    for (const i of fixed) {
      const td = document.createElement("td");
      td.textContent = (r[i] || "").trim();
      tr.appendChild(td);
    }

    const tdExtra = document.createElement("td");
    const val = (r[guideIdx] || "").trim();
    if (val && isLink(val)) {
      tdExtra.innerHTML = `<a href="${escapeHTML(val)}" target="_blank" rel="noopener noreferrer">Abrir</a>`;
    } else {
      tdExtra.textContent = val || "";
    }
    tr.appendChild(tdExtra);

    tbody.appendChild(tr);
  }
}

function rerender() {
  persistState();
  if (state.view === "cards") {
    renderCards();
  } else {
    renderTable();
  }
}

async function init() {
  loadState();

  // set UI initial values
  $("guideSelect").value = state.guide;
  $("sortSelect").value = state.sort;
  $("levelMin").value = String(state.levelMin);
  setView(state.view);

  setStatus("Cargando repertorio…");

  try {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    const text = await res.text();
    rows = parseCSV(text);
    if (!rows.length) throw new Error("CSV vacío");

    // agrupar canciones
    groups = groupSongs(rows.slice(1));

    setStatus("");
    rerender();
  } catch (e) {
    console.error(e);
    setStatus("No se pudo cargar el repertorio 😵");
  }

  // events
  $("viewCardsBtn").onclick = () => { setView("cards"); rerender(); };
  $("viewTableBtn").onclick = () => { setView("table"); rerender(); };

  $("guideSelect").onchange = (e) => { state.guide = e.target.value; rerender(); };
  $("sortSelect").onchange = (e) => { state.sort = e.target.value; rerender(); };
  $("levelMin").onchange = (e) => { state.levelMin = Number(e.target.value || 0); rerender(); };

  // búsqueda con debounce
  let t = null;
  $("searchInput").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.search = e.target.value;
      rerender();
    }, 130);
  });

  $("clearBtn").onclick = () => {
    $("searchInput").value = "";
    state.search = "";
    rerender();
    $("searchInput").focus();
  };

  // modal
  $("modalClose").onclick = closeModal;
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

init();
