const OUTPUT_BASE_URL = "output/";
const RUNS_INDEX_URL = `${OUTPUT_BASE_URL}index.json`;
const PAGE_SIZE = 30;
const MAX_RUN_COLORS = 6;
const THEMES = ["auto", "light", "dark"];

const state = {
  runs: [],
  selectedRunIds: [],
  loadedRuns: [],
  stories: [],
  filtered: [],
  search: "",
  type: "all",
  visibleCount: PAGE_SIZE,
  theme: "auto",
  tab: "results",
};

const els = {
  emptyState: document.getElementById("empty-state"),
  emptyMessage: document.getElementById("empty-message"),
  runPicker: document.getElementById("run-picker"),
  runPickerToggle: document.getElementById("run-picker-toggle"),
  runPickerMenu: document.getElementById("run-picker-menu"),
  runPickerList: document.getElementById("run-picker-list"),
  runPickerNote: document.getElementById("run-picker-note"),
  themeToggle: document.getElementById("theme-toggle"),
  dashboard: document.getElementById("dashboard"),
  summary: document.getElementById("summary"),
  search: document.getElementById("search"),
  typeFilter: document.getElementById("type-filter"),
  tabs: document.querySelectorAll(".tabs [role='tab']"),
  resultsBadge: document.getElementById("results-badge"),
  panelResults: document.getElementById("panel-results"),
  panelAnalytics: document.getElementById("panel-analytics"),
  analyzeButton: document.getElementById("analyze-button"),
  analysisStatus: document.getElementById("analysis-status"),
  analysisOutput: document.getElementById("analysis-output"),
  charts: document.getElementById("charts"),
  resultCount: document.getElementById("result-count"),
  stories: document.getElementById("stories"),
  pager: document.getElementById("pager"),
  showMore: document.getElementById("show-more"),
  showAll: document.getElementById("show-all"),
  tooltip: document.getElementById("tooltip"),
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeHref(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {}
  return null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function formatDayTime(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function setEmptyMessage(nodes) {
  els.emptyMessage.textContent = "";
  for (const node of nodes) els.emptyMessage.appendChild(node);
}

function runById(id) {
  return state.runs.find((run) => run.run_id === id) || null;
}

function runShortLabel(run) {
  const date = run.started_at_iso ? new Date(run.started_at_iso) : null;
  if (date && !Number.isNaN(date.getTime())) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return run.run_id;
}

function runLabel(run) {
  const keyword = run.root_keyword ? ` - ${run.root_keyword}` : "";
  return `${runShortLabel(run)}${keyword}`;
}

const runColorSlots = new Map();

function assignRunSlot(id) {
  if (runColorSlots.has(id)) return;
  const used = new Set(runColorSlots.values());
  for (let slot = 1; slot <= MAX_RUN_COLORS; slot += 1) {
    if (!used.has(slot)) {
      runColorSlots.set(id, slot);
      return;
    }
  }
  runColorSlots.set(id, 0);
}

function runColorVar(id) {
  const slot = runColorSlots.get(id);
  return slot ? `var(--series-${slot})` : "var(--series-muted)";
}

function cssVarValue(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function runColorValue(id) {
  const slot = runColorSlots.get(id);
  return cssVarValue(slot ? `--series-${slot}` : "--series-muted");
}

function buildRunPicker(runs) {
  els.runPickerList.textContent = "";

  for (const run of runs) {
    const row = el("label", "run-option");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = run.run_id;
    checkbox.addEventListener("change", () =>
      setRunSelected(run.run_id, checkbox.checked),
    );
    row.appendChild(checkbox);
    row.appendChild(el("span", "run-dot"));

    const info = el("span", "run-option-info");
    info.appendChild(el("span", "run-option-title", runLabel(run)));
    row.appendChild(info);
    els.runPickerList.appendChild(row);
  }

  els.runPicker.hidden = false;
}

function updateRunPickerUI() {
  const selected = new Set(state.selectedRunIds);
  for (const row of els.runPickerList.querySelectorAll(".run-option")) {
    const checkbox = row.querySelector("input");
    const dot = row.querySelector(".run-dot");
    const isSelected = selected.has(checkbox.value);
    checkbox.checked = isSelected;
    dot.style.background = isSelected ? runColorVar(checkbox.value) : "";
  }

  let label;
  if (!selected.size) {
    label = "Choose runs…";
  } else if (selected.size === 1) {
    const run = runById(state.selectedRunIds[0]);
    label = run ? runShortLabel(run) : "1 run selected";
  } else {
    label = `${selected.size} runs selected`;
  }
  els.runPickerToggle.textContent = label;
}

function setRunMenuOpen(open) {
  els.runPickerMenu.hidden = !open;
  els.runPickerToggle.setAttribute("aria-expanded", String(open));
}

function setPickerNote(message) {
  els.runPickerNote.textContent = message;
  els.runPickerNote.hidden = !message;
}

function setRunSelected(id, selected) {
  if (selected && state.selectedRunIds.length >= MAX_RUN_COLORS) {
    setPickerNote(`Up to ${MAX_RUN_COLORS} runs at a time.`);
    updateRunPickerUI();
    return;
  }

  const current = new Set(state.selectedRunIds);
  if (selected) current.add(id);
  else current.delete(id);
  state.selectedRunIds = state.runs
    .filter((run) => current.has(run.run_id))
    .map((run) => run.run_id);

  if (selected) assignRunSlot(id);
  else runColorSlots.delete(id);

  setPickerNote("");
  updateRunPickerUI();
  applySelection();
}

function syncRunsParam() {
  const params = new URLSearchParams(window.location.search);
  if (state.selectedRunIds.length) {
    params.set("runs", state.selectedRunIds.join(","));
  } else {
    params.delete("runs");
  }
  const query = params.toString();
  try {
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  } catch {}
}

const runCache = new Map();

function loadRun(run) {
  if (!runCache.has(run.run_id)) {
    const promise = fetchRun(run).catch((err) => {
      runCache.delete(run.run_id);
      throw err;
    });
    runCache.set(run.run_id, promise);
  }
  return runCache.get(run.run_id);
}

async function fetchRun(run) {
  const base = `${OUTPUT_BASE_URL}${encodeURIComponent(run.run_id)}/`;
  const files = run.files || {};
  const [allPayload, hotPayload] = await Promise.all([
    fetchJson(
      base + encodeURIComponent(files.all_stories || "news_all_stories.json"),
    ),
    fetchJson(
      base + encodeURIComponent(files.super_hot || "news_super_hot.json"),
    ).catch(() => null),
  ]);

  const hotUrls = new Set(
    ((hotPayload && hotPayload.stories) || [])
      .map((s) => s && s.url)
      .filter(Boolean),
  );

  const label = runShortLabel(run);
  const stories = ((allPayload && allPayload.stories) || [])
    .filter((s) => s && typeof s === "object")
    .map((s) => ({
      title: s.title || "(untitled)",
      source: s.source || "Unknown source",
      story: (s.story || "")
        .replace(/\s*(?:\.{3}|…)?\s*\[\+?\d+\s*chars\]\s*$/, "")
        .trim(),
      url: s.url || "",
      time: Date.parse(s.timestamp || ""),
      hot: hotUrls.has(s.url),
      runId: run.run_id,
      runLabel: label,
    }));

  return { run, stories };
}

const logCache = new Map();
const logResults = new Map();
const logHotInfo = new Map();

function loadRunLog(run) {
  if (!logCache.has(run.run_id)) {
    const base = `${OUTPUT_BASE_URL}${encodeURIComponent(run.run_id)}/`;
    const file = (run.files && run.files.log) || "news_agent_log.json";
    const promise = fetchJson(base + encodeURIComponent(file))
      .then((payload) => {
        const hotInfo = {};
        for (const art of (payload && payload.super_hot_articles) || []) {
          if (art && art.url) {
            hotInfo[art.url] = {
              reason: art.super_hot_reason || "",
              keyword: art.source_keyword || "",
            };
          }
        }
        logHotInfo.set(run.run_id, hotInfo);
        const searches = Array.isArray(payload && payload.searches)
          ? payload.searches
          : [];
        return searches.map((s) => ({
          keyword: String((s && s.keyword) || "").trim() || "(unknown)",
          articleCount:
            (s && (s.article_count ?? (s.articles || []).length)) || 0,
        }));
      })
      .catch(() => null)
      .then((stats) => {
        logResults.set(run.run_id, stats);
        if (!logHotInfo.has(run.run_id)) logHotInfo.set(run.run_id, {});
        if (stats === null) logCache.delete(run.run_id);
        return stats;
      });
    logCache.set(run.run_id, promise);
  }
  return logCache.get(run.run_id);
}

let selectionGen = 0;

async function applySelection() {
  const gen = ++selectionGen;
  syncRunsParam();

  if (!state.selectedRunIds.length) {
    state.loadedRuns = [];
    state.stories = [];
    els.dashboard.hidden = true;
    els.emptyState.hidden = false;
    setEmptyMessage([
      document.createTextNode("Pick one or more runs from "),
      el("strong", "", "Choose runs"),
      document.createTextNode(" above to see their stories."),
    ]);
    return;
  }

  els.dashboard.classList.add("loading");
  const runs = state.selectedRunIds.map((id) => runById(id)).filter(Boolean);
  const settled = await Promise.allSettled(runs.map((run) => loadRun(run)));
  if (gen !== selectionGen) return;
  els.dashboard.classList.remove("loading");

  const loaded = [];
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") loaded.push(result.value);
    else failed.push(runs[index]);
  });

  if (failed.length) {
    const failedIds = new Set(failed.map((run) => run.run_id));
    state.selectedRunIds = state.selectedRunIds.filter(
      (id) => !failedIds.has(id),
    );
    for (const id of failedIds) runColorSlots.delete(id);
    updateRunPickerUI();
    setPickerNote(
      `Could not load: ${failed.map((run) => runShortLabel(run)).join(", ")}`,
    );
    syncRunsParam();
  }

  if (!loaded.length) {
    els.dashboard.hidden = true;
    els.emptyState.hidden = false;
    setEmptyMessage([
      document.createTextNode("None of the selected runs could be loaded."),
    ]);
    return;
  }

  state.loadedRuns = loaded;
  state.stories = loaded.flatMap((entry) => entry.stories);
  state.visibleCount = PAGE_SIZE;

  els.emptyState.hidden = true;
  els.dashboard.hidden = false;
  renderAll();
}

function addStat(value, label, detail, valueClass) {
  const stat = el("div", "stat");
  stat.appendChild(
    el("div", `stat-value${valueClass ? ` ${valueClass}` : ""}`, value),
  );
  if (detail) stat.appendChild(el("div", "stat-detail", detail));
  stat.appendChild(el("div", "stat-label", label));
  els.summary.appendChild(stat);
}

function renderSummary() {
  els.summary.textContent = "";

  const stories = state.stories;
  const hotCount = stories.filter((s) => s.hot).length;
  const searches = state.loadedRuns.reduce(
    (sum, entry) => sum + (entry.run.quota_used || 0),
    0,
  );
  const keywords = new Set(
    state.loadedRuns.flatMap((entry) => entry.run.keywords_searched || []),
  );

  const times = stories.map((s) => s.time).filter(Number.isFinite);
  let span = "-";
  if (times.length) {
    const fmt = (ms) =>
      new Date(ms).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    const lo = fmt(Math.min(...times));
    const hi = fmt(Math.max(...times));
    span = lo === hi ? lo : `${lo} - ${hi}`;
  }

  addStat(
    formatNumber(state.loadedRuns.length),
    state.loadedRuns.length === 1 ? "run selected" : "runs selected",
  );
  addStat(formatNumber(stories.length), "stories");
  addStat(formatNumber(hotCount), "super-hot");
  addStat(formatNumber(searches), "searches");
  addStat(formatNumber(keywords.size), "keywords");
  addStat(span, "story dates", undefined, "stat-value-range");
}

function applyFilters() {
  const needle = state.search.trim().toLowerCase();
  state.filtered = state.stories.filter((s) => {
    if (state.type === "hot" && !s.hot) return false;
    if (!needle) return true;
    return (
      s.title.toLowerCase().includes(needle) ||
      s.source.toLowerCase().includes(needle) ||
      s.story.toLowerCase().includes(needle)
    );
  });
}

function positionTooltip(x, y) {
  const tip = els.tooltip;
  const rect = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width > window.innerWidth - 8) {
    left = Math.max(8, x - rect.width - 14);
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, y - rect.height - 14);
  }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showTooltip(title, rows, x, y, sub) {
  const tip = els.tooltip;
  tip.textContent = "";
  tip.appendChild(el("div", "tooltip-title", title));

  for (const row of rows) {
    const line = el("div", "tooltip-row");
    if (row.color) {
      const key = el("span", "tooltip-key");
      key.style.background = row.color;
      line.appendChild(key);
    }
    line.appendChild(el("span", "tooltip-value", row.value));
    line.appendChild(el("span", "", row.label));
    tip.appendChild(line);
  }

  if (sub) tip.appendChild(el("div", "tooltip-sub", sub));

  tip.hidden = false;
  positionTooltip(x, y);
}

function hideTooltip() {
  els.tooltip.hidden = true;
}

const VIZ_MIN_WIDTH = 120;

const chartDrawers = new Map();
const chartObserver =
  "ResizeObserver" in window
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const rec = chartDrawers.get(entry.target);
          if (!rec) continue;
          const width = Math.floor(entry.contentRect.width);
          if (width < VIZ_MIN_WIDTH || Math.abs(width - rec.width) < 2) {
            continue;
          }
          rec.width = width;
          if (!rec.raf) {
            rec.raf = requestAnimationFrame(() => {
              rec.raf = 0;
              rec.draw(rec.width);
            });
          }
        }
      })
    : null;

function clearCharts() {
  for (const rec of chartDrawers.values()) {
    if (rec.raf) cancelAnimationFrame(rec.raf);
  }
  chartDrawers.clear();
  if (chartObserver) chartObserver.disconnect();
  hideTooltip();
}

function vizCard(title) {
  const card = el("section", "chart-card");
  card.appendChild(el("h3", "chart-title", title));
  const body = el("div", "viz");
  card.appendChild(body);
  return { card, body };
}

function registerViz(card, body, draw) {
  const rec = {
    width: 0,
    raf: 0,
    draw(width) {
      body.textContent = "";
      draw(body, width);
    },
  };
  chartDrawers.set(card, rec);
  if (chartObserver) chartObserver.observe(card);
  const width = Math.floor(body.clientWidth);
  if (width >= VIZ_MIN_WIDTH) {
    rec.width = width;
    rec.draw(width);
  }
}

function appendChartTable(card, headers, rows) {
  const details = el("details", "chart-table");
  details.appendChild(el("summary", "", "View as table"));
  const scroll = el("div", "table-scroll");
  const table = el("table", "data-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const h of headers) {
    headRow.appendChild(el("th", h.num ? "num" : "", h.label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((value, i) => {
      tr.appendChild(
        el("td", headers[i] && headers[i].num ? "num" : "", String(value)),
      );
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  details.appendChild(scroll);
  card.appendChild(details);
}

function clientPoint(svgNode, x, y) {
  const rect = svgNode.getBoundingClientRect();
  return [rect.left + x, rect.top + y];
}

function drawYAxisGrid(svg, scale, { left, right, ticks = 4 }) {
  const axis = d3
    .axisLeft(scale)
    .tickSize(-(right - left))
    .tickPadding(8)
    .tickFormat(formatNumber);
  axis.tickValues(scale.ticks(ticks).filter(Number.isInteger));
  const g = svg
    .append("g")
    .attr("class", "viz-axis")
    .attr("transform", `translate(${left},0)`)
    .call(axis);
  g.select(".domain").remove();
  return g;
}

function drawXAxis(svg, scale, { y, ticks }) {
  const axis = d3.axisBottom(scale).tickSize(0).tickPadding(8);
  if (ticks != null) axis.ticks(ticks);
  const g = svg
    .append("g")
    .attr("class", "viz-axis")
    .attr("transform", `translate(0,${y})`)
    .call(axis);
  g.select(".domain").remove();
  return g;
}

function makeLegend(runsInPlay, extraItems = []) {
  const legend = el("div", "chart-legend");
  if (runsInPlay && runsInPlay.length > 1) {
    for (const entry of runsInPlay) {
      const item = el("span", "legend-item");
      const swatch = el("span", "legend-swatch");
      swatch.style.background = runColorVar(entry.run.run_id);
      item.appendChild(swatch);
      item.appendChild(el("span", "", runShortLabel(entry.run)));
      legend.appendChild(item);
    }
  }
  for (const extra of extraItems) legend.appendChild(extra);
  return legend.childNodes.length ? legend : null;
}

function buildRunLegend(card, body, runsInPlay, extraItems = []) {
  const legend = makeLegend(runsInPlay, extraItems);
  if (legend) card.insertBefore(legend, body);
}

function swatchLegendItem(label, color) {
  const item = el("span", "legend-item");
  const swatch = el("span", "legend-swatch");
  swatch.style.background = color;
  item.appendChild(swatch);
  item.appendChild(el("span", "", label));
  return item;
}

function markLegendItem(label, size, opacity) {
  const item = el("span", "legend-item");
  const swatch = el("span", "legend-swatch legend-dot");
  swatch.style.width = `${size}px`;
  swatch.style.height = `${size}px`;
  swatch.style.background = "var(--ink-2)";
  swatch.style.opacity = String(opacity);
  item.appendChild(swatch);
  item.appendChild(el("span", "", label));
  return item;
}

function buildStoryTimeline(stories) {
  const lanes = state.loadedRuns
    .map((entry) => ({
      run: entry.run,
      events: stories
        .filter((s) => s.runId === entry.run.run_id && Number.isFinite(s.time))
        .sort((a, b) => a.time - b.time),
    }))
    .filter((lane) => lane.events.length);

  if (!lanes.length) return null;

  const noTime = stories.filter((s) => !Number.isFinite(s.time)).length;
  const allTimes = lanes.flatMap((lane) => lane.events.map((e) => e.time));
  let tMin = Math.min(...allTimes);
  let tMax = Math.max(...allTimes);
  if (tMin === tMax) {
    tMin -= 30 * 60 * 1000;
    tMax += 30 * 60 * 1000;
  }

  const { card, body } = vizCard("Story Timeline");
  buildRunLegend(card, body, lanes, [
    markLegendItem("Super-hot story", 12, 1),
    markLegendItem("Story", 8, 0.5),
  ]);

  const LANE_HEIGHT = 72;
  const LEVEL_STEP = 11;
  const MAX_LEVELS = 4;

  registerViz(card, body, (host, width) => {
    const margin = { top: 8, right: 16, bottom: 30, left: 16 };
    const height = margin.top + lanes.length * LANE_HEIGHT + margin.bottom;
    const x = d3
      .scaleTime()
      .domain([tMin, tMax])
      .range([margin.left, width - margin.right])
      .nice();

    const hotTotal = stories.filter(
      (s) => s.hot && Number.isFinite(s.time),
    ).length;
    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `Story timeline: ${formatNumber(allTimes.length)} stories across ` +
          `${lanes.length} ${lanes.length === 1 ? "run" : "runs"}, ` +
          `${formatNumber(hotTotal)} super-hot. ` +
          "Use arrow keys to step through stories; Enter opens the article.",
      );

    lanes.forEach((lane, i) => {
      const laneTop = margin.top + i * LANE_HEIGHT;
      if (i > 0) {
        svg
          .append("line")
          .attr("class", "viz-lane-line")
          .attr("x1", margin.left)
          .attr("x2", width - margin.right)
          .attr("y1", laneTop)
          .attr("y2", laneTop);
      }
      svg
        .append("text")
        .attr("class", "viz-lane-label")
        .attr("x", margin.left)
        .attr("y", laneTop + 14)
        .text(runLabel(lane.run));
    });

    drawXAxis(svg, x, {
      y: height - margin.bottom,
      ticks: Math.max(3, Math.min(8, Math.floor(width / 110))),
    });
    svg
      .append("line")
      .attr("class", "viz-baseline")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", height - margin.bottom)
      .attr("y2", height - margin.bottom);

    const placed = [];
    lanes.forEach((lane, i) => {
      const laneBottom = margin.top + (i + 1) * LANE_HEIGHT - 12;
      const lastX = new Array(MAX_LEVELS).fill(-Infinity);
      for (const event of lane.events) {
        const px = x(event.time);
        let level = lastX.findIndex((last) => px - last >= 10);
        if (level === -1) {
          level = lastX.indexOf(Math.min(...lastX));
        }
        lastX[level] = px;
        placed.push({
          story: event,
          x: px,
          y: laneBottom - level * LEVEL_STEP,
        });
      }
    });

    placed.sort((a, b) => (a.story.hot ? 1 : 0) - (b.story.hot ? 1 : 0));
    const dots = svg
      .selectAll(".viz-story-dot")
      .data(placed)
      .join("circle")
      .attr("class", (d) => `viz-story-dot${d.story.hot ? " is-hot" : ""}`)
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", (d) => (d.story.hot ? 6 : 4))
      .style("fill", (d) => runColorVar(d.story.runId));

    const delaunay = d3.Delaunay.from(
      placed,
      (d) => d.x,
      (d) => d.y,
    );
    const byTime = [...placed].sort((a, b) => a.story.time - b.story.time);
    const indexInByTime = new Map(byTime.map((d, i) => [d, i]));
    let focus = null;

    const setFocus = (point) => {
      focus = point;
      dots.classed("is-focus", (d) => d === point);
    };

    const tooltipFor = (point, cx, cy) => {
      const s = point.story;
      const rows = [
        {
          value: formatDayTime(s.time),
          label: s.runLabel,
          color: runColorValue(s.runId),
        },
        { value: s.source, label: "source" },
      ];
      const subParts = [];
      if (s.hot) subParts.push("★ Super-hot story");
      if (safeHref(s.url)) subParts.push("Click or press Enter to open");
      showTooltip(s.title, rows, cx, cy, subParts.join(" · "));
    };

    const findAt = (mx, my) => {
      if (!placed.length) return null;
      const i = delaunay.find(mx, my);
      const point = placed[i];
      const dist = Math.hypot(point.x - mx, point.y - my);
      return dist <= 28 ? point : null;
    };

    svg.on("pointermove", (event) => {
      const [mx, my] = d3.pointer(event);
      const point = findAt(mx, my);
      setFocus(point);
      svg.style("cursor", point ? "pointer" : null);
      if (point) tooltipFor(point, event.clientX, event.clientY);
      else hideTooltip();
    });
    svg.on("pointerleave", () => {
      setFocus(null);
      hideTooltip();
    });
    svg.on("click", (event) => {
      const [mx, my] = d3.pointer(event);
      const point = findAt(mx, my);
      const href = point && safeHref(point.story.url);
      if (href) window.open(href, "_blank", "noopener");
    });
    svg.on("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        const href = focus && safeHref(focus.story.url);
        if (href) {
          event.preventDefault();
          window.open(href, "_blank", "noopener");
        }
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const from = focus
        ? indexInByTime.get(focus)
        : step > 0
          ? -1
          : byTime.length;
      const next = Math.max(0, Math.min(byTime.length - 1, from + step));
      const point = byTime[next];
      setFocus(point);
      const [cx, cy] = clientPoint(svg.node(), point.x, point.y);
      tooltipFor(point, cx, cy);
    });
    svg.on("blur", () => {
      setFocus(null);
      hideTooltip();
    });
  });

  if (noTime) {
    card.appendChild(
      el(
        "p",
        "chart-note",
        `${formatNumber(noTime)} ${noTime === 1 ? "story has" : "stories have"} ` +
          "no publish time and appear only in the list below.",
      ),
    );
  }

  return card;
}

function roundedTopBarPath(x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  return (
    `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
    `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
  );
}

function buildVolumeChart(stories) {
  const timed = stories.filter((s) => Number.isFinite(s.time));
  if (timed.length < 2) return null;

  const runsInPlay = state.loadedRuns.filter((entry) =>
    timed.some((s) => s.runId === entry.run.run_id),
  );

  const { card, body } = vizCard("Story Volume Over Time");
  buildRunLegend(card, body, runsInPlay);

  registerViz(card, body, (host, width) => {
    const height = 220;
    const margin = { top: 12, right: 16, bottom: 30, left: 40 };
    const x = d3
      .scaleTime()
      .domain(d3.extent(timed, (s) => s.time))
      .range([margin.left, width - margin.right])
      .nice();

    const bucketCount = Math.max(6, Math.min(24, Math.floor(width / 56)));
    const bins = d3
      .bin()
      .value((s) => s.time)
      .domain(x.domain())
      .thresholds(x.ticks(bucketCount))(timed);

    const counted = bins.map((bin) => {
      const counts = new Map();
      for (const s of bin) {
        counts.set(s.runId, (counts.get(s.runId) || 0) + 1);
      }
      return { bin, counts, total: bin.length };
    });

    const maxTotal = d3.max(counted, (b) => b.total) || 1;
    const y = d3
      .scaleLinear()
      .domain([0, maxTotal])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr(
        "aria-label",
        `Story volume over time: ${formatNumber(timed.length)} stories ` +
          `bucketed into ${counted.length} intervals. Details in the table view.`,
      );

    drawYAxisGrid(svg, y, { left: margin.left, right: width - margin.right });
    drawXAxis(svg, x, {
      y: height - margin.bottom,
      ticks: Math.max(3, Math.min(8, Math.floor(width / 110))),
    });
    svg
      .append("line")
      .attr("class", "viz-baseline")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", y(0))
      .attr("y2", y(0));

    const GAP = 2;
    for (const bucket of counted) {
      if (!bucket.total) continue;
      const x0 = x(bucket.bin.x0);
      const x1 = x(bucket.bin.x1);
      const barWidth = Math.min(24, Math.max(3, x1 - x0 - 4));
      const barX = x0 + (x1 - x0 - barWidth) / 2;

      const group = svg.append("g").attr("class", "viz-col");
      const segments = runsInPlay
        .map((entry) => ({
          runId: entry.run.run_id,
          count: bucket.counts.get(entry.run.run_id) || 0,
        }))
        .filter((seg) => seg.count > 0);

      let cum = 0;
      segments.forEach((seg, idx) => {
        const yBottom = y(cum) - (idx > 0 ? GAP : 0);
        cum += seg.count;
        const yTop = y(cum);
        const h = Math.max(1, yBottom - yTop);
        const isTop = idx === segments.length - 1;
        if (isTop) {
          group
            .append("path")
            .attr("class", "viz-mark")
            .attr("d", roundedTopBarPath(barX, yTop, barWidth, h, 4))
            .style("fill", runColorVar(seg.runId));
        } else {
          group
            .append("rect")
            .attr("class", "viz-mark")
            .attr("x", barX)
            .attr("y", yTop)
            .attr("width", barWidth)
            .attr("height", h)
            .style("fill", runColorVar(seg.runId));
        }
      });

      const hit = group
        .append("rect")
        .attr("class", "viz-hit")
        .attr("x", x0)
        .attr("y", margin.top)
        .attr("width", Math.max(1, x1 - x0))
        .attr("height", height - margin.top - margin.bottom)
        .attr("tabindex", 0)
        .attr(
          "aria-label",
          `${formatDayTime(bucket.bin.x0)}: ${formatNumber(bucket.total)} stories`,
        );

      const showBucketTooltip = (cx, cy) => {
        const rows = runsInPlay.map((entry) => ({
          value: formatNumber(bucket.counts.get(entry.run.run_id) || 0),
          label: runShortLabel(entry.run),
          color: runColorValue(entry.run.run_id),
        }));
        if (runsInPlay.length > 1) {
          rows.push({ value: formatNumber(bucket.total), label: "total" });
        }
        showTooltip(
          `${formatDayTime(bucket.bin.x0)} - ${formatDayTime(bucket.bin.x1)}`,
          rows,
          cx,
          cy,
        );
      };

      hit.on("pointermove", (event) => {
        group.style("filter", "brightness(1.08)");
        showBucketTooltip(event.clientX, event.clientY);
      });
      hit.on("pointerleave", () => {
        group.style("filter", null);
        hideTooltip();
      });
      hit.on("focus", () => {
        group.style("filter", "brightness(1.08)");
        const [cx, cy] = clientPoint(
          svg.node(),
          barX + barWidth / 2,
          y(bucket.total),
        );
        showBucketTooltip(cx, cy);
      });
      hit.on("blur", () => {
        group.style("filter", null);
        hideTooltip();
      });
    }
  });

  const xTable = d3
    .scaleTime()
    .domain(d3.extent(timed, (s) => s.time))
    .nice();
  const tableBins = d3
    .bin()
    .value((s) => s.time)
    .domain(xTable.domain())
    .thresholds(xTable.ticks(12))(timed);
  appendChartTable(
    card,
    [{ label: "Interval" }, { label: "Total", num: true }],
    tableBins
      .filter((bin) => bin.length)
      .map((bin) => [
        `${formatDayTime(bin.x0)} - ${formatDayTime(bin.x1)}`,
        formatNumber(bin.length),
      ]),
  );

  return card;
}

function resolveLabelYs(entries, minGap, top, bottom) {
  const sorted = [...entries].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].y - sorted[i - 1].y < minGap) {
      sorted[i].y = sorted[i - 1].y + minGap;
    }
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (overflow > 0) {
    for (const entry of sorted) entry.y -= overflow;
  }
  for (const entry of sorted) entry.y = Math.max(top, entry.y);
}

function buildCumulativeChart(stories) {
  const seriesData = state.loadedRuns
    .map((entry) => ({
      run: entry.run,
      times: stories
        .filter((s) => s.runId === entry.run.run_id && Number.isFinite(s.time))
        .map((s) => s.time)
        .sort((a, b) => a - b),
    }))
    .filter((set) => set.times.length);
  if (!seriesData.length) return null;

  const tMin = Math.min(...seriesData.map((s) => s.times[0]));
  const tMax = Math.max(...seriesData.map((s) => s.times[s.times.length - 1]));
  if (tMin === tMax) return null;
  const maxCount = Math.max(...seriesData.map((s) => s.times.length));

  const { card, body } = vizCard("Cumulative Stories By Publish Time");
  buildRunLegend(card, body, seriesData);

  registerViz(card, body, (host, width) => {
    const height = 240;
    const margin = { top: 16, right: 60, bottom: 30, left: 40 };
    const x = d3
      .scaleTime()
      .domain([tMin, tMax])
      .range([margin.left, width - margin.right]);
    const y = d3
      .scaleLinear()
      .domain([0, maxCount])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `Cumulative stories by publish time across ${seriesData.length} ` +
          `${seriesData.length === 1 ? "run" : "runs"}, up to ` +
          `${formatNumber(maxCount)} stories. Use arrow keys to step through time.`,
      );

    drawYAxisGrid(svg, y, { left: margin.left, right: width - margin.right });
    drawXAxis(svg, x, {
      y: height - margin.bottom,
      ticks: Math.max(3, Math.min(8, Math.floor(width / 110))),
    });
    svg
      .append("line")
      .attr("class", "viz-baseline")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", y(0))
      .attr("y2", y(0));

    const gen = d3
      .line()
      .x((p) => x(p.t))
      .y((p) => y(p.c))
      .curve(d3.curveStepAfter);
    for (const set of seriesData) {
      const points = [
        { t: tMin, c: 0 },
        ...set.times.map((t, i) => ({ t, c: i + 1 })),
        { t: tMax, c: set.times.length },
      ];
      svg
        .append("path")
        .attr("class", "viz-line")
        .style("stroke", runColorVar(set.run.run_id))
        .attr("d", gen(points));
    }

    const labels = seriesData.map((set) => ({
      set,
      y: y(set.times.length),
    }));
    resolveLabelYs(labels, 14, margin.top + 6, height - margin.bottom - 4);
    for (const label of labels) {
      const dotY = y(label.set.times.length);
      svg
        .append("circle")
        .attr("class", "viz-dot")
        .attr("cx", x(tMax))
        .attr("cy", dotY)
        .attr("r", 4)
        .style("fill", runColorVar(label.set.run.run_id));
      if (Math.abs(label.y - dotY) > 6) {
        svg
          .append("line")
          .attr("class", "viz-leader")
          .attr("x1", x(tMax) + 5)
          .attr("y1", dotY)
          .attr("x2", x(tMax) + 8)
          .attr("y2", label.y);
      }
      svg
        .append("text")
        .attr("class", "viz-end-label")
        .attr("x", x(tMax) + 8)
        .attr("y", label.y + 4)
        .text(formatNumber(label.set.times.length));
    }

    const crosshair = svg
      .append("line")
      .attr("class", "viz-crosshair")
      .attr("y1", margin.top)
      .attr("y2", height - margin.bottom)
      .attr("visibility", "hidden");
    const hoverDots = seriesData.map((set) =>
      svg
        .append("circle")
        .attr("class", "viz-dot")
        .attr("r", 4)
        .style("fill", runColorVar(set.run.run_id))
        .attr("visibility", "hidden"),
    );

    const unionTimes = [
      ...new Set(seriesData.flatMap((set) => set.times)),
    ].sort((a, b) => a - b);
    const bisectUnion = d3.bisector((t) => t).center;
    let focusIndex = -1;

    const showAt = (index, clientX, clientY) => {
      const t = unionTimes[index];
      if (t == null) return;
      const px = x(t);
      crosshair.attr("x1", px).attr("x2", px).attr("visibility", "visible");
      const rows = seriesData.map((set, i) => {
        const cum = d3.bisectRight(set.times, t);
        hoverDots[i]
          .attr("cx", px)
          .attr("cy", y(cum))
          .attr("visibility", "visible");
        return {
          value: formatNumber(cum),
          label: runShortLabel(set.run),
          color: runColorValue(set.run.run_id),
        };
      });
      showTooltip(formatDayTime(t), rows, clientX, clientY);
    };
    const hideHover = () => {
      crosshair.attr("visibility", "hidden");
      for (const dot of hoverDots) dot.attr("visibility", "hidden");
      hideTooltip();
    };

    svg.on("pointermove", (event) => {
      const [mx] = d3.pointer(event);
      focusIndex = bisectUnion(unionTimes, x.invert(mx).getTime());
      showAt(focusIndex, event.clientX, event.clientY);
    });
    svg.on("pointerleave", hideHover);
    svg.on("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const from =
        focusIndex < 0 ? (step > 0 ? -1 : unionTimes.length) : focusIndex;
      focusIndex = Math.max(0, Math.min(unionTimes.length - 1, from + step));
      const [cx, cy] = clientPoint(
        svg.node(),
        x(unionTimes[focusIndex]),
        margin.top + 10,
      );
      showAt(focusIndex, cx, cy);
    });
    svg.on("blur", () => {
      focusIndex = -1;
      hideHover();
    });
  });

  const tickTimes = d3.scaleTime().domain([tMin, tMax]).ticks(8);
  appendChartTable(
    card,
    [{ label: "By" }, { label: "Total", num: true }],
    tickTimes.map((tick) => [
      formatDayTime(tick.getTime()),
      formatNumber(
        seriesData.reduce(
          (sum, set) => sum + d3.bisectRight(set.times, tick.getTime()),
          0,
        ),
      ),
    ]),
  );

  return card;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  const base = ((h + 11) % 12) + 1;
  return `${base} ${h < 12 ? "AM" : "PM"}`;
}

function buildRhythmHeatmap(stories) {
  const timed = stories.filter((s) => Number.isFinite(s.time));
  if (timed.length < 2) return null;

  const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const s of timed) {
    const d = new Date(s.time);
    counts[(d.getDay() + 6) % 7][d.getHours()] += 1;
  }
  const maxCount = d3.max(counts, (row) => d3.max(row)) || 1;
  let busiest = { day: 0, hour: 0, count: 0 };
  counts.forEach((row, day) =>
    row.forEach((count, hour) => {
      if (count > busiest.count) busiest = { day, hour, count };
    }),
  );

  const { card, body } = vizCard("Publishing Rhythm");

  registerViz(card, body, (host, width) => {
    const margin = { top: 8, right: 8, bottom: 24, left: 40 };
    const cw = (width - margin.left - margin.right) / 24;
    const ch = Math.min(24, Math.max(14, cw));
    const height = margin.top + 7 * ch + margin.bottom;
    const opacity = d3.scaleSqrt().domain([1, maxCount]).range([0.18, 1]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `Publishing rhythm by weekday and hour. Busiest: ` +
          `${DAY_NAMES[busiest.day]} around ${hourLabel(busiest.hour)} with ` +
          `${formatNumber(busiest.count)} stories. Use arrow keys to move ` +
          "between cells.",
      );

    counts.forEach((row, day) => {
      svg
        .append("text")
        .attr("class", "viz-heat-day")
        .attr("x", margin.left - 8)
        .attr("y", margin.top + day * ch + ch / 2 + 4)
        .attr("text-anchor", "end")
        .text(DAY_NAMES[day]);
      row.forEach((count, hour) => {
        const rect = svg
          .append("rect")
          .attr("x", margin.left + hour * cw + 1)
          .attr("y", margin.top + day * ch + 1)
          .attr("width", Math.max(1, cw - 2))
          .attr("height", ch - 2)
          .attr("rx", 2);
        if (count) {
          rect
            .style("fill", "var(--accent)")
            .style("fill-opacity", opacity(count));
        } else {
          rect.style("fill", "var(--grid)").style("fill-opacity", 0.35);
        }
      });
    });

    for (const hour of [0, 6, 12, 18]) {
      svg
        .append("text")
        .attr("class", "viz-heat-hour")
        .attr("x", margin.left + hour * cw + 1)
        .attr("y", height - 8)
        .text(hourLabel(hour));
    }

    const showCellTooltip = (day, hour, clientX, clientY) => {
      const count = counts[day][hour];
      showTooltip(
        `${DAY_NAMES[day]}, ${hourLabel(hour)} - ${hourLabel(hour + 1)}`,
        [
          {
            value: formatNumber(count),
            label: count === 1 ? "story" : "stories",
          },
        ],
        clientX,
        clientY,
      );
    };

    const focusRect = svg
      .append("rect")
      .attr("class", "viz-heat-focus")
      .attr("width", Math.max(1, cw - 2))
      .attr("height", ch - 2)
      .attr("rx", 2)
      .attr("visibility", "hidden");
    let focusCell = null;

    const focusAt = (day, hour) => {
      focusCell = { day, hour };
      focusRect
        .attr("x", margin.left + hour * cw + 1)
        .attr("y", margin.top + day * ch + 1)
        .attr("visibility", "visible");
      const [cx, cy] = clientPoint(
        svg.node(),
        margin.left + hour * cw + cw / 2,
        margin.top + day * ch,
      );
      showCellTooltip(day, hour, cx, cy);
    };

    svg.on("pointermove", (event) => {
      const [mx, my] = d3.pointer(event);
      const hour = Math.floor((mx - margin.left) / cw);
      const day = Math.floor((my - margin.top) / ch);
      if (hour < 0 || hour > 23 || day < 0 || day > 6) {
        hideTooltip();
        return;
      }
      showCellTooltip(day, hour, event.clientX, event.clientY);
    });
    svg.on("pointerleave", hideTooltip);
    svg.on("keydown", (event) => {
      const steps = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
      };
      const step = steps[event.key];
      if (!step) return;
      event.preventDefault();
      if (!focusCell) {
        focusAt(busiest.day, busiest.hour);
        return;
      }
      focusAt(
        Math.max(0, Math.min(6, focusCell.day + step[0])),
        Math.max(0, Math.min(23, focusCell.hour + step[1])),
      );
    });
    svg.on("blur", () => {
      focusCell = null;
      focusRect.attr("visibility", "hidden");
      hideTooltip();
    });
  });

  return card;
}

function buildBarRowsCard(opts) {
  const card = el("section", "chart-card");
  card.appendChild(el("h3", "chart-title", opts.title));
  const legend = makeLegend(opts.legendRuns, opts.extraLegend || []);
  if (legend) card.appendChild(legend);

  const rowsWrap = el("div", "chart-rows");
  const max = Math.max(
    ...opts.rows.map((row) =>
      row.segments.reduce((sum, seg) => sum + seg.value, 0),
    ),
    1,
  );

  for (const row of opts.rows) {
    const rowEl = el("div", "bar-row");
    rowEl.tabIndex = 0;
    rowEl.setAttribute("role", "img");
    rowEl.setAttribute("aria-label", row.aria);

    const label = el("span", "bar-label", row.label);
    label.title = row.label;
    rowEl.appendChild(label);

    const track = el("span", "bar-track");
    const segments = row.segments.filter((seg) => seg.value > 0);
    segments.forEach((seg, i) => {
      const segEl = el(
        "span",
        `bar-seg${i === segments.length - 1 ? " seg-end" : ""}`,
      );
      segEl.style.width = `${(seg.value / max) * 100}%`;
      segEl.style.background = seg.color;
      track.appendChild(segEl);
    });
    rowEl.appendChild(track);
    rowEl.appendChild(el("span", "bar-value", row.totalLabel));

    rowEl.addEventListener("pointermove", (event) =>
      showTooltip(
        row.tooltipTitle,
        row.tooltipRows,
        event.clientX,
        event.clientY,
        row.tooltipSub,
      ),
    );
    rowEl.addEventListener("pointerleave", hideTooltip);
    rowEl.addEventListener("focus", () => {
      const rect = rowEl.getBoundingClientRect();
      showTooltip(
        row.tooltipTitle,
        row.tooltipRows,
        rect.left + rect.width / 2,
        rect.top,
        row.tooltipSub,
      );
    });
    rowEl.addEventListener("blur", hideTooltip);

    rowsWrap.appendChild(rowEl);
  }
  card.appendChild(rowsWrap);

  if (opts.note) card.appendChild(el("p", "chart-note", opts.note));
  if (opts.tableHeaders) {
    appendChartTable(card, opts.tableHeaders, opts.tableRows);
  }
  return card;
}

function perRunTooltipRows(perRun, runsInPlay, total) {
  const rows = runsInPlay.map((entry) => ({
    value: formatNumber(perRun.get(entry.run.run_id) || 0),
    label: runShortLabel(entry.run),
    color: runColorValue(entry.run.run_id),
  }));
  if (runsInPlay.length > 1) {
    rows.push({ value: formatNumber(total), label: "total" });
  }
  return rows;
}

function buildTopSourcesChart(stories) {
  if (!stories.length) return null;
  const runsInPlay = state.loadedRuns.filter((entry) =>
    stories.some((s) => s.runId === entry.run.run_id),
  );

  const bySource = new Map();
  for (const s of stories) {
    if (!bySource.has(s.source)) {
      bySource.set(s.source, { source: s.source, perRun: new Map(), total: 0 });
    }
    const item = bySource.get(s.source);
    item.perRun.set(s.runId, (item.perRun.get(s.runId) || 0) + 1);
    item.total += 1;
  }

  const all = [...bySource.values()].sort((a, b) => b.total - a.total);
  const top = all.slice(0, 10);

  return buildBarRowsCard({
    title: "Top Sources",
    legendRuns: runsInPlay,
    rows: top.map((item) => ({
      label: item.source,
      segments: runsInPlay.map((entry) => ({
        color: runColorVar(entry.run.run_id),
        value: item.perRun.get(entry.run.run_id) || 0,
      })),
      totalLabel: formatNumber(item.total),
      tooltipTitle: item.source,
      tooltipRows: perRunTooltipRows(item.perRun, runsInPlay, item.total),
      aria: `${item.source}: ${formatNumber(item.total)} stories`,
    })),
    tableHeaders: [{ label: "Source" }, { label: "Total", num: true }],
    tableRows: all.map((item) => [item.source, formatNumber(item.total)]),
  });
}

function buildHotRateChart(stories) {
  const rows = state.loadedRuns
    .map((entry) => {
      const own = stories.filter((s) => s.runId === entry.run.run_id);
      const hot = own.filter((s) => s.hot).length;
      return { run: entry.run, hot, rest: own.length - hot, total: own.length };
    })
    .filter((row) => row.total > 0);
  if (!rows.length) return null;

  return buildBarRowsCard({
    title: "Super-Hot Share By Run",
    extraLegend: [
      swatchLegendItem("Super-hot", "var(--gradient-hot)"),
      swatchLegendItem("Other stories", "var(--series-muted)"),
    ],
    rows: rows.map((row) => {
      const pct = Math.round((row.hot / row.total) * 100);
      return {
        label: runLabel(row.run),
        segments: [
          { color: "var(--gradient-hot)", value: row.hot },
          { color: "var(--series-muted)", value: row.rest },
        ],
        totalLabel: `${formatNumber(row.hot)}/${formatNumber(row.total)} · ${pct}%`,
        tooltipTitle: runLabel(row.run),
        tooltipRows: [
          {
            value: formatNumber(row.hot),
            label: "super-hot",
            color: cssVarValue("--gradient-hot"),
          },
          {
            value: formatNumber(row.rest),
            label: "other stories",
            color: cssVarValue("--series-muted"),
          },
          { value: `${pct}%`, label: "super-hot share" },
        ],
        aria:
          `${runLabel(row.run)}: ${formatNumber(row.hot)} of ` +
          `${formatNumber(row.total)} stories super-hot (${pct}%)`,
      };
    }),
    tableHeaders: [
      { label: "Run" },
      { label: "Super-hot", num: true },
      { label: "Other", num: true },
      { label: "Share", num: true },
    ],
    tableRows: rows.map((row) => [
      runLabel(row.run),
      formatNumber(row.hot),
      formatNumber(row.rest),
      `${Math.round((row.hot / row.total) * 100)}%`,
    ]),
  });
}

function buildKeywordChart() {
  const entries = state.loadedRuns;
  if (!entries.length) return null;
  if (entries.some((e) => !logResults.has(e.run.run_id))) {
    return { pending: true };
  }

  const withStats = entries.filter((e) =>
    Array.isArray(logResults.get(e.run.run_id)),
  );
  const title = "Articles Per Search Keyword";
  if (!withStats.length) {
    const card = el("section", "chart-card");
    card.appendChild(el("h3", "chart-title", title));
    card.appendChild(
      el(
        "p",
        "chart-note",
        "The search logs for the selected runs could not be loaded.",
      ),
    );
    return card;
  }

  const agg = new Map();
  for (const entry of withStats) {
    for (const s of logResults.get(entry.run.run_id)) {
      if (!agg.has(s.keyword)) {
        agg.set(s.keyword, {
          keyword: s.keyword,
          perRun: new Map(),
          total: 0,
        });
      }
      const item = agg.get(s.keyword);
      item.perRun.set(
        entry.run.run_id,
        (item.perRun.get(entry.run.run_id) || 0) + s.articleCount,
      );
      item.total += s.articleCount;
    }
  }

  const all = [...agg.values()].sort((a, b) => b.total - a.total);
  if (!all.length) return null;
  const top = all.slice(0, 12);

  return buildBarRowsCard({
    title,
    legendRuns: withStats,
    rows: top.map((item) => ({
      label: item.keyword,
      segments: withStats.map((entry) => ({
        color: runColorVar(entry.run.run_id),
        value: item.perRun.get(entry.run.run_id) || 0,
      })),
      totalLabel: formatNumber(item.total),
      tooltipTitle: item.keyword,
      tooltipRows: perRunTooltipRows(item.perRun, withStats, item.total),
      aria: `${item.keyword}: ${formatNumber(item.total)} articles`,
    })),
    tableHeaders: [{ label: "Keyword" }, { label: "Total", num: true }],
    tableRows: all.map((item) => [item.keyword, formatNumber(item.total)]),
  });
}

const STOPWORDS = new Set(
  (
    "the a an and or but nor for yet so of in on at to from by with without " +
    "about into over after before between during under above across against " +
    "as is are was were be been being am do does did done doing have has had " +
    "having will would shall should may might must can could this that these " +
    "those it its they them their theirs he him his she her hers you your " +
    "yours we us our ours i me my mine who whom whose which what when where " +
    "why how not no nor only own same than too very just also more most other " +
    "some such all any both each few once here there then now out up down off " +
    "again further if while because until unless says said say new news report " +
    "reports reported according amid among via per like get gets got make " +
    "makes made take takes took year years month months week weeks day days " +
    "today yesterday tomorrow first last next one two three latest breaking " +
    "update live top best big chars monday tuesday wednesday thursday friday " +
    "saturday sunday january february march april may june july august " +
    "september october november december"
  ).split(/\s+/),
);

function computeTopTerms(stories, limit) {
  const counts = new Map();
  for (const s of stories) {
    const text = `${s.title} ${s.story}`.toLowerCase();
    const seen = new Set();
    for (const match of text.matchAll(/[a-z][a-z'’-]{2,}/g)) {
      const word = match[0].replace(/^['’-]+|['’-]+$/g, "");
      if (word.length < 3 || STOPWORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  const minCount = stories.length >= 10 ? 2 : 1;
  const candidates = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);

  const haystacks = stories.map((s) =>
    `${s.title} ${s.source} ${s.story}`.toLowerCase(),
  );
  return candidates
    .map((term) => ({
      term,
      count: haystacks.filter((h) => h.includes(term)).length,
    }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function applyCloudFilter(word) {
  els.search.value = word;
  state.search = word;
  state.visibleCount = PAGE_SIZE;
  setTab("results");
  renderFiltered();
  els.search.focus();
}

const CLOUD_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function buildWordCloudChart(stories) {
  if (typeof d3.layout === "undefined" || !d3.layout.cloud) return null;
  const terms = computeTopTerms(stories, 60);
  if (terms.length < 3) return null;

  const topSet = new Set(terms.slice(0, 8).map((t) => t.term));
  const { card, body } = vizCard("Common Words Across Stories");
  let activeLayout = null;

  registerViz(card, body, (host, width) => {
    if (activeLayout) activeLayout.stop();
    const height = Math.max(220, Math.min(340, Math.round(width * 0.42)));
    const counts = terms.map((t) => t.count);
    const size = d3
      .scaleSqrt()
      .domain([Math.min(...counts), Math.max(...counts)])
      .range([13, Math.max(26, Math.min(46, width / 14))]);

    activeLayout = d3.layout
      .cloud()
      .size([width, height])
      .words(
        terms.map((t) => ({
          text: t.term,
          count: t.count,
          size: size(t.count),
        })),
      )
      .padding(2)
      .rotate(0)
      .font(CLOUD_FONT_FAMILY)
      .fontWeight(600)
      .fontSize((d) => d.size)
      .random(mulberry32(42))
      .on("end", (words) => {
        const svg = d3
          .select(host)
          .append("svg")
          .attr("width", width)
          .attr("height", height)
          .attr("role", "img")
          .attr(
            "aria-label",
            `Word cloud of the ${terms.length} most common words across the ` +
              "filtered stories, sized by how many stories mention each word. " +
              "Full counts in the table view.",
          );
        svg
          .append("g")
          .attr("transform", `translate(${width / 2},${height / 2})`)
          .selectAll("text")
          .data(words)
          .join("text")
          .attr(
            "class",
            (d) => `viz-cloud-word${topSet.has(d.text) ? " is-top" : ""}`,
          )
          .attr("transform", (d) => `translate(${d.x},${d.y})`)
          .attr("text-anchor", "middle")
          .style("font-family", CLOUD_FONT_FAMILY)
          .style("font-weight", 600)
          .style("font-size", (d) => `${d.size}px`)
          .attr("tabindex", 0)
          .attr("role", "button")
          .attr(
            "aria-label",
            (d) =>
              `${d.text}: in ${formatNumber(d.count)} stories. ` +
              "Press Enter to filter the story list to this word.",
          )
          .text((d) => d.text)
          .on("pointermove", (event, d) => {
            showTooltip(
              d.text,
              [
                {
                  value: formatNumber(d.count),
                  label: d.count === 1 ? "story" : "stories",
                },
              ],
              event.clientX,
              event.clientY,
              "Click to filter the story list",
            );
          })
          .on("pointerleave", hideTooltip)
          .on("click", (event, d) => applyCloudFilter(d.text))
          .on("keydown", (event, d) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              applyCloudFilter(d.text);
            }
          });
      });
    activeLayout.start();
  });

  appendChartTable(
    card,
    [{ label: "Word" }, { label: "Stories", num: true }],
    terms.map((t) => [t.term, formatNumber(t.count)]),
  );

  return card;
}

let chartsGen = 0;
let chartsStale = true;

function renderCharts(retryFailedLogs = true) {
  const gen = ++chartsGen;
  chartsStale = false;
  clearCharts();
  els.charts.textContent = "";

  if (retryFailedLogs) {
    for (const entry of state.loadedRuns) {
      const id = entry.run.run_id;
      if (logResults.get(id) === null && !logCache.has(id)) {
        logResults.delete(id);
      }
    }
  }

  const stories = state.filtered;
  const wide = [];
  const half = [];

  const timeline = buildStoryTimeline(stories);
  if (timeline) wide.push(timeline);
  const volume = buildVolumeChart(stories);
  if (volume) wide.push(volume);
  const cumulative = buildCumulativeChart(stories);
  if (cumulative) wide.push(cumulative);

  const rhythm = buildRhythmHeatmap(stories);
  if (rhythm) half.push(rhythm);
  const hotRate = buildHotRateChart(stories);
  if (hotRate) half.push(hotRate);
  const sources = buildTopSourcesChart(stories);
  if (sources) half.push(sources);

  const keywords = buildKeywordChart();
  if (keywords && keywords.pending) {
    const placeholder = el("section", "chart-card");
    placeholder.appendChild(
      el("h3", "chart-title", "Articles Per Search Keyword"),
    );
    placeholder.appendChild(el("p", "chart-note", "Loading search logs…"));
    half.push(placeholder);
    const runs = state.loadedRuns.map((entry) => entry.run);
    Promise.allSettled(runs.map((run) => loadRunLog(run))).then(() => {
      if (gen !== chartsGen) return;
      if (state.tab === "analytics") renderCharts(false);
      else chartsStale = true;
    });
  } else if (keywords) {
    half.push(keywords);
  }

  const cloud = buildWordCloudChart(stories);

  for (const card of half) card.classList.add("chart-card--half");
  for (const card of [...wide, ...half]) els.charts.appendChild(card);
  if (cloud) els.charts.appendChild(cloud);

  if (!els.charts.childNodes.length) {
    els.charts.appendChild(
      el(
        "p",
        "empty-list",
        stories.length
          ? "The matching stories have no publish times to plot."
          : "No stories match the current filters.",
      ),
    );
  }
}

function buildCard(story) {
  const li = el("li", "card");

  li.appendChild(
    el(
      "div",
      "card-time",
      Number.isFinite(story.time) ? formatDayTime(story.time) : "unknown",
    ),
  );

  const bodyEl = el("div", "card-body");
  const title = el("h3", "card-title");
  const href = safeHref(story.url);
  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = story.title;
    title.appendChild(link);
  } else {
    title.textContent = story.title;
  }
  bodyEl.appendChild(title);

  if (story.story) {
    const text =
      story.story.length > 280
        ? `${story.story.slice(0, 280).trimEnd()}…`
        : story.story;
    bodyEl.appendChild(el("p", "card-desc", text));
  }

  const meta = el("div", "card-meta");
  if (story.hot) meta.appendChild(el("span", "badge badge-hot", "Super-hot"));
  if (state.loadedRuns.length > 1) {
    const runBadge = el("span", "badge badge-run");
    const dot = el("span", "run-dot");
    dot.style.background = runColorVar(story.runId);
    runBadge.appendChild(dot);
    runBadge.appendChild(document.createTextNode(story.runLabel));
    meta.appendChild(runBadge);
  }
  meta.appendChild(el("span", "", story.source));
  bodyEl.appendChild(meta);

  li.appendChild(bodyEl);
  return li;
}

function renderList() {
  els.stories.textContent = "";

  const sorted = [...state.filtered].sort((a, b) => {
    const ta = Number.isFinite(a.time) ? a.time : -Infinity;
    const tb = Number.isFinite(b.time) ? b.time : -Infinity;
    return tb - ta;
  });

  const visible = sorted.slice(0, state.visibleCount);
  for (const story of visible) {
    els.stories.appendChild(buildCard(story));
  }

  if (!sorted.length) {
    els.stories.appendChild(
      el("li", "empty-list", "No stories match the current filters."),
    );
  }

  els.resultCount.textContent = sorted.length
    ? `Showing ${formatNumber(visible.length)} of ${formatNumber(sorted.length)} stories, newest first`
    : "";
  els.resultsBadge.textContent = formatNumber(sorted.length);
  els.pager.hidden = visible.length >= sorted.length;
}

function renderFiltered() {
  applyFilters();
  renderList();
  updateAnalysisButton();
  if (state.tab === "analytics") renderCharts();
  else chartsStale = true;
}

function renderAll() {
  renderSummary();
  state.visibleCount = PAGE_SIZE;
  renderFiltered();
}

function syncTabParam() {
  const params = new URLSearchParams(window.location.search);
  if (state.tab === "analytics") params.set("tab", "analytics");
  else params.delete("tab");
  const query = params.toString();
  try {
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  } catch {}
}

function setTab(name) {
  state.tab = name;
  for (const tab of els.tabs) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  els.panelResults.hidden = name !== "results";
  els.panelAnalytics.hidden = name !== "analytics";
  syncTabParam();
  hideTooltip();
  if (name === "analytics" && chartsStale) renderCharts();
}

const ANALYSIS_SENTINEL = "\u001e";
let analysisRunning = false;

function hotStoriesInView() {
  return state.filtered.filter((s) => s.hot);
}

function setAnalysisStatus(message) {
  els.analysisStatus.textContent = message;
}

function updateAnalysisButton() {
  if (!els.analyzeButton) return;
  const count = hotStoriesInView().length;
  els.analyzeButton.textContent = analysisRunning
    ? "Analyzing…"
    : `Analyze ${formatNumber(count)} super-hot ${count === 1 ? "story" : "stories"} with Claude`;
  els.analyzeButton.disabled = !analysisRunning && count === 0;
  els.analyzeButton.setAttribute("aria-busy", String(analysisRunning));
}

function appendInline(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      parent.appendChild(
        document.createTextNode(text.slice(last, match.index)),
      );
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parent.appendChild(el("strong", "", token.slice(2, -2)));
    } else {
      parent.appendChild(el("code", "", token.slice(1, -1)));
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

function renderMarkdownInto(container, text) {
  container.textContent = "";
  let list = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = el("p");
    appendInline(p, paragraph.join(" "));
    container.appendChild(p);
    paragraph = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      list = null;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      list = null;
      const h = el(heading[1].length <= 2 ? "h4" : "h5", "md-heading");
      appendInline(h, heading[2]);
      container.appendChild(h);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = numbered ? "OL" : "UL";
      if (!list || list.tagName !== tag) {
        list = el(tag.toLowerCase(), "md-list");
        if (numbered) {
          const start = parseInt(numbered[1], 10);
          if (Number.isFinite(start) && start > 1) list.start = start;
        }
        container.appendChild(list);
      }
      const li = el("li");
      appendInline(li, numbered ? numbered[2] : bullet[1]);
      list.appendChild(li);
      continue;
    }

    list = null;
    paragraph.push(line);
  }
  flushParagraph();
}

async function runAnalysis() {
  if (analysisRunning) return;
  const stories = [...hotStoriesInView()].sort((a, b) => {
    const ta = Number.isFinite(a.time) ? a.time : -Infinity;
    const tb = Number.isFinite(b.time) ? b.time : -Infinity;
    return tb - ta;
  });
  if (!stories.length) return;
  const loadedRuns = state.loadedRuns.slice();

  analysisRunning = true;
  updateAnalysisButton();
  setAnalysisStatus("Collecting the agent's notes…");
  els.analysisOutput.hidden = false;
  els.analysisOutput.textContent = "";

  try {
    await Promise.allSettled(loadedRuns.map((entry) => loadRunLog(entry.run)));

    const payload = {
      stories: stories.map((s) => {
        const info = (logHotInfo.get(s.runId) || {})[s.url] || {};
        return {
          title: s.title,
          source: s.source,
          published: Number.isFinite(s.time)
            ? new Date(s.time).toISOString()
            : null,
          url: s.url,
          run: s.runLabel,
          keyword: info.keyword || null,
          agent_reason: info.reason || null,
          excerpt: s.story.slice(0, 500),
        };
      }),
      runs: loadedRuns.map((entry) => ({
        run: runLabel(entry.run),
        root_keyword: entry.run.root_keyword,
        searches: entry.run.search_count,
        stories: entry.run.all_stories_count,
        super_hot: entry.run.super_hot_count,
      })),
    };

    setAnalysisStatus("Claude is reading the stories…");
    let res;
    try {
      res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setAnalysisStatus(
        "Could not reach the analysis endpoint. Serve the dashboard with " +
          "python3 serve.py (instead of python3 -m http.server) and try again.",
      );
      els.analysisOutput.hidden = true;
      return;
    }

    if (!res.ok) {
      let message = `Analysis failed (HTTP ${res.status}).`;
      if (res.status === 501 || res.status === 405) {
        message =
          "This server can't run analyses. Serve the dashboard with " +
          "python3 serve.py (instead of python3 -m http.server) and retry.";
      } else {
        try {
          const err = await res.json();
          if (err && err.error) message = `Analysis failed: ${err.error}`;
        } catch {}
      }
      setAnalysisStatus(message);
      els.analysisOutput.hidden = true;
      return;
    }

    const model = res.headers.get("X-Analysis-Model") || "Claude";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let renderQueued = 0;
    const renderVisible = () => {
      const cut = buffer.indexOf(ANALYSIS_SENTINEL);
      renderMarkdownInto(
        els.analysisOutput,
        cut >= 0 ? buffer.slice(0, cut) : buffer,
      );
    };
    const scheduleRender = () => {
      if (renderQueued) return;
      renderQueued = requestAnimationFrame(() => {
        renderQueued = 0;
        renderVisible();
      });
    };

    let interrupted = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        scheduleRender();
      }
      buffer += decoder.decode();
    } catch {
      interrupted = true;
    }
    if (renderQueued) {
      cancelAnimationFrame(renderQueued);
      renderQueued = 0;
    }
    renderVisible();

    const cut = buffer.indexOf(ANALYSIS_SENTINEL);
    const text = (cut >= 0 ? buffer.slice(0, cut) : buffer).trim();
    let meta = null;
    if (cut >= 0) {
      try {
        meta = JSON.parse(buffer.slice(cut + 1));
      } catch {}
    }

    if (!text) {
      setAnalysisStatus(
        interrupted
          ? "The connection dropped before Claude answered - try again."
          : "Claude returned an empty analysis - try again.",
      );
      els.analysisOutput.hidden = true;
      return;
    }

    const base =
      `Analyzed ${formatNumber(stories.length)} super-hot ` +
      `${stories.length === 1 ? "story" : "stories"} with ${model}. ` +
      "Reflects the run selection and filters at the moment you clicked.";
    if (interrupted || !meta) {
      setAnalysisStatus(
        `${base} The connection ended before Claude finished - this may be incomplete.`,
      );
    } else if (meta.stop_reason === "max_tokens") {
      setAnalysisStatus(
        `${base} Claude hit the length limit, so the ending may be cut off.`,
      );
    } else if (meta.stop_reason && meta.stop_reason !== "end_turn") {
      setAnalysisStatus(`${base} Claude stopped early (${meta.stop_reason}).`);
    } else {
      setAnalysisStatus(base);
    }
  } catch {
    setAnalysisStatus("Something went wrong running the analysis - try again.");
  } finally {
    analysisRunning = false;
    updateAnalysisButton();
  }
}

function applyTheme(theme, persist = true) {
  state.theme = theme;
  if (theme === "auto") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  els.themeToggle.textContent = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
  if (persist) {
    try {
      localStorage.setItem("newsbot-theme", theme);
    } catch {}
  }
}

async function tryAutoLoad() {
  if (!window.location.protocol.startsWith("http")) {
    setEmptyMessage([
      document.createTextNode(
        "This page needs to be served over HTTP to read run data. From the repo directory, start ",
      ),
      el("code", "", "python3 -m http.server"),
      document.createTextNode(" and open "),
      el("code", "", "http://localhost:8000/"),
      document.createTextNode("."),
    ]);
    return;
  }

  let index;
  try {
    index = await fetchJson(RUNS_INDEX_URL);
  } catch {
    setEmptyMessage([
      document.createTextNode("No runs found. Run the agent first with "),
      el("code", "", "python3 app.py"),
      document.createTextNode(", then reload this page."),
    ]);
    return;
  }

  const runs = (index.runs || []).filter((run) => run && run.run_id);
  if (!runs.length) {
    setEmptyMessage([
      document.createTextNode("The runs index is empty. Run the agent with "),
      el("code", "", "python3 app.py"),
      document.createTextNode(", then reload this page."),
    ]);
    return;
  }

  runs.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  state.runs = runs;
  buildRunPicker(runs);

  const requested = (
    new URLSearchParams(window.location.search).get("runs") || ""
  )
    .split(",")
    .filter(Boolean);
  const available = new Set(runs.map((run) => run.run_id));
  const valid = requested
    .filter((id) => available.has(id))
    .slice(0, MAX_RUN_COLORS);
  const wanted = new Set(valid.length ? valid : [runs[0].run_id]);
  state.selectedRunIds = runs
    .filter((run) => wanted.has(run.run_id))
    .map((run) => run.run_id);

  for (const id of state.selectedRunIds) assignRunSlot(id);
  updateRunPickerUI();
  await applySelection();
}

function init() {
  if (typeof d3 === "undefined") {
    setEmptyMessage([
      document.createTextNode("Could not load D3 from "),
      el("code", "", "vendor/d3.v7.min.js"),
      document.createTextNode(" - the file is missing."),
    ]);
    return;
  }

  const themeParam = new URLSearchParams(window.location.search).get("theme");
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem("newsbot-theme");
  } catch {}
  if (THEMES.includes(themeParam)) {
    applyTheme(themeParam, false);
  } else {
    applyTheme(THEMES.includes(storedTheme) ? storedTheme : "auto", false);
  }

  els.themeToggle.addEventListener("click", () => {
    const next = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    applyTheme(next);
  });

  const tabOrder = [...els.tabs];
  tabOrder.forEach((tab, i) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      let target = null;
      if (event.key === "ArrowRight") {
        target = tabOrder[(i + 1) % tabOrder.length];
      } else if (event.key === "ArrowLeft") {
        target = tabOrder[(i - 1 + tabOrder.length) % tabOrder.length];
      } else if (event.key === "Home") {
        target = tabOrder[0];
      } else if (event.key === "End") {
        target = tabOrder[tabOrder.length - 1];
      }
      if (!target) return;
      event.preventDefault();
      setTab(target.dataset.tab);
      target.focus();
    });
  });
  setTab(
    new URLSearchParams(window.location.search).get("tab") === "analytics"
      ? "analytics"
      : "results",
  );

  els.analyzeButton.addEventListener("click", runAnalysis);

  els.runPickerToggle.addEventListener("click", () => {
    setRunMenuOpen(els.runPickerMenu.hidden);
  });
  document.addEventListener("click", (event) => {
    if (!els.runPicker.contains(event.target)) setRunMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.runPickerMenu.hidden) {
      setRunMenuOpen(false);
      els.runPickerToggle.focus();
    }
  });

  els.search.addEventListener(
    "input",
    debounce(() => {
      state.search = els.search.value;
      state.visibleCount = PAGE_SIZE;
      renderFiltered();
    }, 150),
  );

  els.typeFilter.addEventListener("change", () => {
    state.type = els.typeFilter.value;
    state.visibleCount = PAGE_SIZE;
    renderFiltered();
  });

  els.showMore.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderList();
  });
  els.showAll.addEventListener("click", () => {
    state.visibleCount = Infinity;
    renderList();
  });

  tryAutoLoad();
}

init();
