/* =========================================================
 * API 客戶端
 * ========================================================= */
const Api = (() => {
  // ★ 站長部署用:填入你的 proxy 網址(例如 Cloudflare Worker),
  //   訪客即可免填 API Key。留空 = 使用者自備 key 直連 Nexon。
  const SITE_PROXY = "https://msequipmentcalc.maluku1125.workers.dev";

  const DEFAULT_BASE = SITE_PROXY || "https://open.api.nexon.com";
  const GAME = "maplestorytw";

  function base() { return (localStorage.getItem("msec_base") || DEFAULT_BASE).replace(/\/+$/, ""); }
  function key()  { return localStorage.getItem("msec_key") || ""; }
  function needKey() { return !SITE_PROXY && !localStorage.getItem("msec_base"); }

  async function call(path, params) {
    const url = new URL(`${base()}/${GAME}/v1${path}`);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const headers = {};
    if (key()) headers["x-nxopen-api-key"] = key(); // proxy 模式可不帶 key
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      throw new Error("連線失敗。可能原因:網路問題,或 Nexon API 不允許瀏覽器直連(CORS)。\n若為 CORS 問題,請在「進階:CORS Proxy 設定」填入自架 proxy 位址。");
    }
    if (!res.ok) {
      let msg = `API 錯誤 (HTTP ${res.status})`;
      try {
        const e = await res.json();
        if (e?.error?.message) msg += `:${e.error.message}`;
      } catch (_) {}
      if (res.status === 400) msg += "\n(常見原因:角色名稱不存在或拼寫錯誤)";
      if (res.status === 403) msg += "\n(常見原因:API Key 無效或未選擇 MapleStory TW)";
      if (res.status === 429) msg += "\n(API 用量已達上限,請稍後再試)";
      throw new Error(msg);
    }
    return res.json();
  }

  return {
    DEFAULT_BASE, needKey, SITE_PROXY,
    getOcid:  (name) => call("/id", { character_name: name }),
    getBasic: (ocid) => call("/character/basic", { ocid }),
    getStat:  (ocid) => call("/character/stat", { ocid }),
    getEquip: (ocid) => call("/character/item-equipment", { ocid }),
  };
})();

/* =========================================================
 * UI
 * ========================================================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const state = { statMap: null, build: "str", className: "", planKey: "", lastSim: null };

/* ---------- 主題 ---------- */
const THEMES = [
  ["ocean",  "深夜藍", "#5ec8f2", "#1c1f28"],
  ["maple",  "楓紅",   "#f2755e", "#241618"],
  ["forest", "森林綠", "#6fd98a", "#17211a"],
  ["violet", "紫羅蘭", "#b78af2", "#1d1626"],
  ["light",  "淺色",   "#1e88c7", "#ffffff"],
];
function applyTheme(key) {
  document.body.dataset.theme = key;
  localStorage.setItem("msec_theme", key);
  document.querySelectorAll(".tsw").forEach(b =>
    b.classList.toggle("active", b.dataset.theme === key));
}
{
  const bar = $("themeBar");
  for (const [key, name, accent, card] of THEMES) {
    const b = document.createElement("button");
    b.className = "tsw";
    b.dataset.theme = key;
    b.title = name;
    b.setAttribute("aria-label", `主題:${name}`);
    b.style.background = `linear-gradient(135deg, ${accent} 50%, ${card} 50%)`;
    b.onclick = () => applyTheme(key);
    bar.appendChild(b);
  }
  applyTheme(localStorage.getItem("msec_theme") || "ocean");
}

/* ---------- 步驟編號與 API 設定卡 ---------- */
{
  const NUM = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];
  const steps = ["hKey", "hSearch", "hChar", "hManual", "hBuff", "hSim", "hPlans"];
  let order = steps;
  if (Api.SITE_PROXY) {
    // 已內建站方 proxy:第一步免填,收合並移出編號
    order = steps.slice(1);
    $("hKeyTitle").textContent = "API 設定(本站已內建,一般使用者不需填寫;點此展開)";
    $("hKey").style.cursor = "pointer";
    $("hKey").style.fontSize = ".85rem";
    $("keyBody").classList.add("hidden");
    $("hKey").onclick = () => $("keyBody").classList.toggle("hidden");
  }
  order.forEach((id, i) => $(id).querySelector(".stepno").textContent = NUM[i] + " ");
}

/* ---------- 設定 ---------- */
$("apiKey").value = localStorage.getItem("msec_key") || "";
$("apiBase").value = localStorage.getItem("msec_base") || "";
$("btnSaveKey").onclick = () => {
  localStorage.setItem("msec_key", $("apiKey").value.trim());
  const b = $("apiBase").value.trim();
  if (b) localStorage.setItem("msec_base", b); else localStorage.removeItem("msec_base");
  $("btnSaveKey").textContent = "已儲存 ✓";
  setTimeout(() => $("btnSaveKey").textContent = "儲存", 1500);
};

/* ---------- 查詢 ---------- */
$("btnSearch").onclick = () => search();
$("charName").addEventListener("keydown", e => { if (e.key === "Enter") search(); });

/* 最近查詢過的角色 */
const RECENT_MAX = 8;
function loadRecent() {
  try { return JSON.parse(localStorage.getItem("msec_recent") || "[]"); } catch (_) { return []; }
}
function saveRecent(list) {
  localStorage.setItem("msec_recent", JSON.stringify(list.slice(0, RECENT_MAX)));
  renderRecent();
}
function pushRecent(name) {
  if (!name) return;
  const list = loadRecent().filter(n => n !== name);
  list.unshift(name);
  saveRecent(list);
}
function renderRecent() {
  const bar = $("recentBar"), list = loadRecent();
  bar.innerHTML = "";
  if (!list.length) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  bar.insertAdjacentHTML("beforeend", `<span class="rlabel">最近查詢:</span>`);
  for (const name of list) {
    const chip = document.createElement("span");
    chip.className = "rchip";
    chip.innerHTML = `<span class="rname">${esc(name)}</span><span class="rdel" title="移除">×</span>`;
    chip.querySelector(".rname").onclick = () => {
      $("charName").value = name;
      search(name);
    };
    chip.querySelector(".rdel").onclick = () => saveRecent(loadRecent().filter(n => n !== name));
    bar.appendChild(chip);
  }
}
renderRecent();

async function search(preset) {
  const name = (preset || $("charName").value).trim();
  const errBox = $("searchErr");
  errBox.classList.add("hidden");
  if (!name) return showErr("請輸入角色名稱");
  if (Api.needKey() && !localStorage.getItem("msec_key"))
    return showErr("請先於上方儲存 API Key(或於進階設定填入 Proxy 網址)");

  $("btnSearch").disabled = true;
  $("btnSearch").textContent = "查詢中…";
  try {
    const { ocid } = await Api.getOcid(name);
    const [basic, stat, equip] = await Promise.all([
      Api.getBasic(ocid), Api.getStat(ocid), Api.getEquip(ocid),
    ]);
    renderCharacter(basic, stat);
    renderEquipment(equip);
    setupSimulation(basic, stat);
    pushRecent(basic.character_name || name);
  } catch (e) {
    showErr(e.message);
  } finally {
    $("btnSearch").disabled = false;
    $("btnSearch").textContent = "查詢";
  }

  function showErr(msg) { errBox.textContent = msg; errBox.classList.remove("hidden"); }
}

/* ---------- 角色資訊 ---------- */
const SHOW_STATS = [
  "戰鬥力", "最低屬性攻擊力", "最高屬性攻擊力",
  "傷害", "BOSS怪物傷害", "一般怪物傷害", "最終傷害",
  "爆擊機率", "爆擊傷害", "無視防禦率", "無視屬性耐性",
  "攻擊力", "魔法攻擊力",
  "STR", "DEX", "INT", "LUK", "HP", "MP",
  "星力", "神秘力量", "真實之力",
  "冷卻時間減少(秒)", "冷卻時間減少(％)", "未套用冷卻時間",
  "道具掉落率", "楓幣獲得量", "獲得額外經驗值", "Buff持續時間",
  "狀態異常追加傷害", "狀態異常耐性", "攻擊速度", "武器熟練度",
];
const PCT_STATS = new Set([
  "傷害", "BOSS怪物傷害", "一般怪物傷害", "最終傷害",
  "爆擊機率", "爆擊傷害", "無視防禦率", "無視屬性耐性",
  "冷卻時間減少(％)", "未套用冷卻時間",
  "道具掉落率", "楓幣獲得量", "獲得額外經驗值", "Buff持續時間",
  "狀態異常追加傷害", "武器熟練度",
]);
const SEC_STATS = new Set(["冷卻時間減少(秒)"]);

function fmtStat(k, v) {
  if (PCT_STATS.has(k)) return `${v}%`;
  if (SEC_STATS.has(k)) return `${v} 秒`;
  return v.toLocaleString();
}

function renderCharacter(basic, stat) {
  $("cardChar").classList.remove("hidden");
  $("charImg").src = basic.character_image || "";
  $("cName").textContent = basic.character_name;
  $("cClass").textContent = `Lv.${basic.character_level} ${basic.character_class}`;
  $("cWorld").textContent = basic.world_name || "";
  $("cDate").textContent = stat.date ? `資料日期:${String(stat.date).slice(0, 10)}` : "";

  const m = Engine.parseFinalStat(stat.final_stat);
  state.statMap = m;
  state.className = basic.character_class || "";

  const grid = $("statGrid");
  grid.innerHTML = "";
  const shown = new Set();
  for (const k of SHOW_STATS) {
    if (m[k] == null) continue;
    shown.add(k);
    grid.insertAdjacentHTML("beforeend",
      `<div class="stat"><div class="k">${k}</div><div class="v">${fmtStat(k, m[k])}</div></div>`);
  }
  // 其餘未列出的數值收進「更多」
  const rest = Object.keys(m).filter(k => !shown.has(k));
  const more = $("statMore");
  if (rest.length) {
    more.classList.remove("hidden");
    $("statMoreGrid").innerHTML = rest.map(k =>
      `<div class="stat"><div class="k">${k}</div><div class="v">${fmtStat(k, m[k])}</div></div>`).join("");
  } else {
    more.classList.add("hidden");
  }
}

/* ---------- 裝備 ---------- */
// item_total_option 摘要要顯示的欄位
const OPT_LABELS = [
  ["str", "STR"], ["dex", "DEX"], ["int", "INT"], ["luk", "LUK"],
  ["max_hp", "HP"], ["attack_power", "攻擊"], ["magic_power", "魔攻"],
  ["all_stat", "全屬%"], ["boss_damage", "BOSS傷%"], ["damage", "傷害%"],
  ["ignore_monster_armor", "無視%"], ["max_hp_rate", "HP%"],
];

function optionSummary(opt) {
  if (!opt) return "";
  const parts = [];
  for (const [key, label] of OPT_LABELS) {
    const v = parseFloat(opt[key]);
    if (v) parts.push(`${label}+${v.toLocaleString()}`);
  }
  return parts.join(" / ");
}

// 機體資訊 / 裝備一覽 分頁切換
$("tabBtnInfo").onclick = () => switchCharTab(true);
$("tabBtnEquip").onclick = () => switchCharTab(false);
function switchCharTab(showInfo) {
  $("tabInfo").classList.toggle("hidden", !showInfo);
  $("tabEquip").classList.toggle("hidden", showInfo);
  $("tabBtnInfo").className = showInfo ? "" : "ghost";
  $("tabBtnEquip").className = showInfo ? "ghost" : "";
}

function renderEquipment(equip) {
  switchCharTab(true); // 查詢後預設顯示機體資訊

  // preset 頁籤(圖騰、寶玉等只存在於「目前裝備」)
  const presets = [
    ["目前裝備", equip.item_equipment || []],
    ["Preset 1", equip.item_equipment_preset_1 || []],
    ["Preset 2", equip.item_equipment_preset_2 || []],
    ["Preset 3", equip.item_equipment_preset_3 || []],
  ].filter(([, list]) => list.length);

  const tabs = $("presetTabs");
  tabs.innerHTML = "";
  presets.forEach(([label, list], i) => {
    const active = (label === "目前裝備");
    const btn = document.createElement("button");
    btn.className = active ? "" : "ghost";
    btn.textContent = `${label} (${list.length})`;
    btn.onclick = () => {
      [...tabs.children].forEach(b => b.className = "ghost");
      btn.className = "";
      renderEquipList(list);
    };
    tabs.appendChild(btn);
    if (active || (i === 0 && presets.length === 1)) renderEquipList(list);
  });
  if (equip.preset_no != null)
    $("equipCount").textContent = `(套用中 Preset ${equip.preset_no})`;
}

function renderEquipList(items) {
  const grid = $("equipGrid");
  grid.innerHTML = "";

  for (const it of items) {
    const star = parseInt(it.starforce || "0", 10);
    const scroll = parseInt(it.scroll_upgrade || "0", 10);
    const pots = [it.potential_option_1, it.potential_option_2, it.potential_option_3].filter(Boolean);
    const adds = [it.additional_potential_option_1, it.additional_potential_option_2, it.additional_potential_option_3].filter(Boolean);
    const grade = it.potential_option_grade;
    const summary = optionSummary(it.item_total_option);

    let html = `<div class="equip">
      <div class="slot">${esc(it.item_equipment_slot || "")}</div>
      <div class="hdr">`;
    if (it.item_icon) html += `<img class="icon" src="${esc(it.item_icon)}" alt="" loading="lazy">`;
    html += `<div class="nm">${esc(it.item_name || "未知裝備")}`;
    if (star > 0) html += ` <span class="star">★${star}</span>`;
    if (scroll > 0) html += ` <span class="scroll">+${scroll}</span>`;
    html += `</div></div>`;
    if (summary) html += `<div class="opts">${esc(summary)}</div>`;
    if (grade && grade !== "None")
      html += `<div class="pot"><b class="grade-${esc(grade)}">[${esc(grade)}]</b> ${pots.map(esc).join("<br>")}</div>`;
    if (adds.length && it.additional_potential_option_grade && it.additional_potential_option_grade !== "None")
      html += `<div class="pot"><b class="grade-${esc(it.additional_potential_option_grade)}">[附加 ${esc(it.additional_potential_option_grade)}]</b> ${adds.map(esc).join("<br>")}</div>`;
    if (it.soul_name)
      html += `<div class="pot"><b>[靈魂]</b> ${esc(it.soul_name)}${it.soul_option ? `:${esc(it.soul_option)}` : ""}</div>`;
    html += `</div>`;
    grid.insertAdjacentHTML("beforeend", html);
  }
}


const BuffUI = (() => {
  const CATS = [["skill", "技能"], ["pot", "藥水"], ["pass", "傳授技能"]];
  const LABELS = {
    atk: "攻擊力", atkP: "攻擊%", dmg: "傷害%", boss: "BOSS傷%", crit: "爆傷%",
    ign: "無視防禦%", all: "全屬", allP: "全屬%", main: "主屬", sub: "副屬",
    sub2: "副屬2", hp: "HP",
  };
  const PCT = new Set(["atkP", "dmg", "boss", "crit", "ign", "allP"]);
  let state = {}, saveKey = "", ctx = {}, mode = "hot";  // hot=套用 / cold=不套用(保留勾選)

  const bid = (cat, b) => `${cat}:${b.n}`;
  // step 型(等差)展開成等級表
  function levelTable(b) {
    if (b.lv) return b.lv;
    if (!b.step) return null;
    const t = {};
    for (let l = 1; l <= b.max; l++) {
      t[l] = {};
      for (const [k, v] of Object.entries(b.step)) t[l][k] = Math.round(v * l * 100) / 100;
    }
    return t;
  }
  const levelKeys = (b) => {
    const t = levelTable(b);
    return t ? Object.keys(t).map(Number).sort((a, c) => a - c) : null;
  };

  function effectAt(b, v) {
    const t = levelTable(b);
    return t ? (t[String(v)] || {}) : (b.e || {});
  }

  // 爆發窗長度(秒):可於④手動填入,未填則預設 20
  const BURST_WINDOW_DEFAULT = 20;
  function burstWindow() {
    const el = $("manual_burstSec");
    const v = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(v) && v > 0 ? v : BURST_WINDOW_DEFAULT;
  }

  // 技能持續秒數(靈魂契約依 API「Buff持續時間」動態計算)
  function durationOf(b, v) {
    if (b.durDyn === "soul") return 10 * (1 + (ctx.buffDuration || 0) / 100);
    if (b.durLv) return b.durLv[String(v)] || burstWindow();
    return b.dur || burstWindow();
  }

  function burstRatio() {
    const el = $("manual_burst");
    const v = el ? parseFloat(el.value) : NaN;
    return (Number.isFinite(v) ? Math.min(Math.max(v, 0), 100) : 0) / 100;
  }

  /**
   * 加總啟用中的 buff(冷機視為完全沒吃 buff,但勾選內容保留)
   *   onlyBurst=true  → 爆發窗內的加成
   *                     覆蓋率 = min(持續秒數, 20) ÷ 20
   *   onlyBurst=false → 平時的加成:常駐 buff 全額
   *                     + 爆發技能超出 20 秒、溢出到平砍環節的部分
   *                     溢出率 = p × max(持續秒數−20, 0) ÷ (20 × (1−p))
   */
  function totals(onlyBurst) {
    const out = {};
    if (mode === "cold") return out;
    const p = burstRatio(), W = burstWindow();
    for (const [cat] of CATS)
      for (const b of BUFF_DATA[cat] || []) {
        const v = state[bid(cat, b)];
        if (!v) continue;
        const eff = effectAt(b, v);
        let k;
        if (b.burst) {
          const D = durationOf(b, v);
          k = onlyBurst
            ? Math.min(D, W) / W
            : (p > 0 && p < 1 ? p * Math.max(D - W, 0) / (W * (1 - p)) : 0);
        } else {
          k = onlyBurst ? 0 : 1;
        }
        if (!k) continue;
        for (const [key, n] of Object.entries(eff)) out[key] = (out[key] || 0) + n * k;
      }
    for (const key in out) out[key] = Math.round(out[key] * 100) / 100;
    return out;
  }
  const burstTotals = () => totals(true);
  const hasBurst = () => Object.keys(burstTotals()).length > 0;

  // buff 效果 → 引擎變化量(供「升到滿等」試算)
  function effToDelta(eff, scale) {
    const d = {}, s = scale;
    const def = Engine.BUILDS[($("base_build") || {}).value] || Engine.BUILDS.str;
    const hpBuild = ($("base_build") || {}).value === "hp";
    const add = (k, v) => { if (v) d[k] = (d[k] || 0) + v; };
    for (const [k, n0] of Object.entries(eff)) {
      const n = n0 * s;
      if (k === "atk")   add("attackFlat", n);
      if (k === "atkP")  add("attackPct", n / 100);
      if (k === "dmg")   add("dmg", n / 100);
      if (k === "boss")  add("boss", n / 100);
      if (k === "crit")  add("crit", n / 100);
      if (k === "ign")   add("ignore", n / 100);
      if (k === "allP") { if (!hpBuild) add("mainPct", n / 100); add("minorPct", n / 100); }
      if (k === "all") { if (!hpBuild) add("mainFlat", n * def.main.length); add("minorFlat", n * def.minor.length); }
      if (k === "main")  add("mainFlat", n);
      if (k === "sub")   add("minorFlat", n);
      if (k === "sub2" && def.minor.length > 1) add("minorFlat", n);
      if (k === "hp" && hpBuild) add("mainFlat", n);
    }
    return d;
  }

  // 由目前等級升到滿等的增幅%(null = 已滿等或非等級型)
  function levelUpGain(cat, b) {
    const lv = levelKeys(b);
    if (!lv || typeof evaluate !== "function") return null;
    const cur = Number(state[bid(cat, b)]);
    if (!cur) return null;                       // 未啟用不試算
    const max = lv[lv.length - 1];
    if (cur >= max) return null;
    const W = burstWindow();
    const diff = {};
    const a = effectAt(b, cur), z = effectAt(b, max);
    for (const k of new Set([...Object.keys(a), ...Object.keys(z)])) {
      const v = (z[k] || 0) - (a[k] || 0);
      if (v) diff[k] = v;
    }
    if (!Object.keys(diff).length) return null;
    if (b.burst) {
      // 爆發專用:僅作用於爆發窗,依覆蓋率折算;超出部分溢出到平時
      const p = burstRatio();
      const Da = durationOf(b, cur), Dz = durationOf(b, max);
      const coverZ = Math.min(Dz, W) / W, coverA = Math.min(Da, W) / W;
      const spillZ = (p > 0 && p < 1) ? p * Math.max(Dz - W, 0) / (W * (1 - p)) : 0;
      const spillA = (p > 0 && p < 1) ? p * Math.max(Da - W, 0) / (W * (1 - p)) : 0;
      const zEff = effectAt(b, max), aEff = effectAt(b, cur);
      const burstDelta = {}, normDelta = {};
      for (const k of new Set([...Object.keys(aEff), ...Object.keys(zEff)])) {
        const vb = (zEff[k] || 0) * coverZ - (aEff[k] || 0) * coverA;
        const vn = (zEff[k] || 0) * spillZ - (aEff[k] || 0) * spillA;
        if (vb) burstDelta[k] = vb;
        if (vn) normDelta[k] = vn;
      }
      const r = evaluate(effToDelta(normDelta, 1), effToDelta(burstDelta, 1));
      return (r.total - 1) * 100;
    }
    return (evaluate(effToDelta(diff, 1)).total - 1) * 100;
  }

  // 自身連結技能(角色本身職業提供的那一條)
  function isOwnLink(b) {
    const cls = ctx.className || "";
    if (!b.job || !cls) return false;
    return b.job.split("/").some(j => cls.includes(j) || j.includes(cls));
  }
  const ownLinkInList = () => (BUFF_DATA.pass || []).some(isOwnLink);

  // 爆發技能明細(供介面顯示換算過程)
  function burstDetail() {
    const p = burstRatio(), W = burstWindow(), rows = [];
    for (const [cat] of CATS)
      for (const b of BUFF_DATA[cat] || []) {
        if (!b.burst) continue;
        const v = state[bid(cat, b)];
        if (!v) continue;
        const D = durationOf(b, v);
        const cover = Math.min(D, W) / W;
        const spill = (p > 0 && p < 1) ? p * Math.max(D - W, 0) / (W * (1 - p)) : 0;
        const eff = effectAt(b, v);
        rows.push({ name: b.n, dur: Math.round(D * 10) / 10, cover, spill, eff });
      }
    return rows;
  }

  function render() {
    const tabs = $("buffTabs");
    tabs.innerHTML = "";
    CATS.forEach(([cat, label], i) => {
      const btn = document.createElement("button");
      btn.className = i === 0 ? "" : "ghost";
      btn.textContent = `${label} (${(BUFF_DATA[cat] || []).length})`;
      btn.onclick = () => {
        [...tabs.children].forEach(x => x.className = "ghost");
        btn.className = "";
        renderList(cat);
      };
      tabs.appendChild(btn);
      if (i === 0) renderList(cat);
    });
  }

  // 佔用額度的已啟用數量(連結技能不計自身那條)
  function activeCount(cat) {
    return (BUFF_DATA[cat] || [])
      .filter(b => state[bid(cat, b)] && !(cat === "pass" && isOwnLink(b))).length;
  }
  // 自身連結技能是否已勾選
  function ownLinkOn() {
    return (BUFF_DATA.pass || []).some(b => isOwnLink(b) && state[bid("pass", b)]);
  }
  const limitOf = (cat) => BUFF_LIMIT[cat];

  function renderList(cat) {
    const body = $("buffBody");
    body.innerHTML = "";
    const all = BUFF_DATA[cat] || [];
    const groups = BUFF_GROUPS[cat];

    if (!groups) {
      buildGroup(cat, null, all);
    } else {
      const used = new Set();
      for (const [, names] of groups) (names || []).forEach(n => used.add(n));
      for (const [label, names] of groups) {
        const items = names
          ? names.map(n => all.find(b => b.n === n)).filter(Boolean)
          : all.filter(b => !used.has(b.n));
        if (items.length) buildGroup(cat, label, items);
      }
    }
    updateLimitHint(cat);
  }

  function updateLimitHint(cat) {
    const cap = limitOf(cat);
    const el = $("buffLimit");
    if (!cap) { el.textContent = ""; return; }
    const n = activeCount(cat);
    let txt = `已選 ${n} / ${cap} 種`;
    if (cat === "pass") {
      txt = `已選 ${n} / ${cap}(他人)`;
      if (ownLinkInList()) {
        txt += ownLinkOn()
          ? ` ＋ 自身 1 條(不佔額度,合計 ${n + 1} / 13)`
          : " ＋ 自身 1 條(不佔額度,尚未勾選)";
      } else {
        txt += ";自身職業的連結技能非戰鬥向,未列於表中";
      }
    }
    el.textContent = txt;
    el.style.color = n >= cap ? "var(--accent2)" : "var(--muted)";
  }

  function buildGroup(cat, label, items) {
    const body = $("buffBody");
    if (label) body.insertAdjacentHTML("beforeend", `<div class="bgroup">${esc(label)}</div>`);
    body.insertAdjacentHTML("beforeend", `<div class="buffgrid"></div>`);
    const grid = body.lastChild;
    for (const b of items) {
      const key = bid(cat, b);
      const lv = levelKeys(b);
      const on = !!state[key];
      const row = document.createElement("div");
      row.className = "buff" + (on ? " on" : "");
      const shownLv = lv ? (Number(state[key]) || (cat === "pass" ? lv[0] : lv[lv.length - 1])) : true;
      const tip = Object.entries(effectAt(b, shownLv))
        .map(([k, v]) => `${LABELS[k] || k}+${v}${PCT.has(k) ? "%" : ""}`).join(" / ");
      row.title = (b.r ? b.r + " — " : "") + (lv ? `Lv${shownLv}:${tip}` : tip);
      const own = cat === "pass" && isOwnLink(b);
      let html = `<input type="checkbox" ${on ? "checked" : ""}>
        <span class="bn">${esc(b.n)}${own ? ` <span class="bown" title="你自己職業提供的連結技能">自身</span>` : ""}` +
        `${b.job ? ` <span class="bjob">${esc(b.job)}</span>` : ""}</span>`;
      if (b.np) html += `<span class="bnp" title="非常駐技能,以等效值計算">等效</span>`;
      if (lv) html += `<select>${lv.map(l =>
        `<option value="${l}" ${Number(state[key]) === l ? "selected" : ""}>Lv${l}</option>`).join("")}</select>`;
      row.innerHTML = html;

      // 升到滿等的增幅(僅對已啟用且未滿等者顯示)
      const gain = levelUpGain(cat, b);
      if (gain != null && Math.abs(gain) > 0.0001) {
        const g = document.createElement("span");
        g.className = "bgain";
        g.textContent = `滿等 +${gain.toFixed(2)}%`;
        g.title = `由 Lv${state[key]} 升到 Lv${lv[lv.length - 1]} 的總增幅`;
        row.appendChild(g);
      }
      const cb = row.querySelector("input"), sel = row.querySelector("select");
      // 傳授技能預設取最低級(Lv2;小偷的狡詐/實戰知識為 Lv6),其餘預設滿級
      if (sel && !state[key]) sel.value = String(cat === "pass" ? lv[0] : lv[lv.length - 1]);
      const sync = () => {
        // 數量上限(自身連結技能不佔額度)
        const cap = limitOf(cat);
        const freeSlot = cat === "pass" && isOwnLink(b);
        if (cb.checked && cap && !state[key] && !freeSlot && activeCount(cat) >= cap) {
          cb.checked = false;
          $("buffLimit").textContent = `已達上限 ${cap} 條(他人),請先取消其他項目`;
          $("buffLimit").style.color = "var(--bad)";
          return;
        }
        state[key] = cb.checked ? (sel ? Number(sel.value) : true) : 0;
        // 互斥組:啟用時關閉同組其他項
        if (cb.checked) {
          const grp = BUFF_EXCLUSIVE.find(g => g.includes(b.n));
          if (grp) {
            for (const other of grp) {
              if (other === b.n) continue;
              const ob = (BUFF_DATA[cat] || []).find(x => x.n === other);
              if (ob) state[bid(cat, ob)] = 0;
            }
            persist();
            renderList(cat);
            return;
          }
        }
        row.classList.toggle("on", cb.checked);
        persist();
        updateLimitHint(cat);
      };
      cb.onchange = sync;
      if (sel) sel.onchange = () => { cb.checked = true; sync(); };
      grid.appendChild(row);
    }
  }

  function persist() {
    if (saveKey) localStorage.setItem(saveKey, JSON.stringify({ sel: state, mode }));
    summarize();
    if (typeof window.onBuffChange === "function") window.onBuffChange();
  }

  function summarize() {
    $("btnBuffHot").className = mode === "hot" ? "" : "ghost";
    $("btnBuffCold").className = mode === "cold" ? "" : "ghost";
    const picked = Object.values(state).filter(Boolean).length;
    if (mode === "cold") {
      $("buffSummary").textContent =
        `冷機中:已保留 ${picked} 項勾選但不套用,增幅以未吃 buff 的面板為分母。`;
      return;
    }
    const fmt = (t) => Object.entries(t).filter(([, v]) => v)
      .map(([k, v]) => `${LABELS[k] || k} +${Math.round(v * 100) / 100}${PCT.has(k) ? "%" : ""}`);
    const parts = fmt(totals(false)), bparts = fmt(burstTotals());
    let msg = parts.length
      ? `熱機中(${picked} 項)常駐合計:` + parts.join("、")
      : "尚未勾選常駐 Buff(增幅將以未吃 buff 的面板為分母)。";
    if (bparts.length) msg += `\n爆發窗內額外:` + bparts.join("、");
    $("buffSummary").style.whiteSpace = "pre-line";
    $("buffSummary").textContent = msg;

    // 爆發技能換算明細
    const rows = burstDetail(), box = $("burstDetail");
    if (!rows.length || mode === "cold") { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const p = burstRatio(), W = burstWindow();
    const fmtEff = (e, k) => Object.entries(e)
      .map(([s, n]) => `${LABELS[s] || s} ${Math.round(n * k * 100) / 100}${PCT.has(s) ? "%" : ""}`).join("、");
    box.innerHTML =
      `<b>爆發窗 ${W} 秒</b>　覆蓋率 = min(持續, ${W}) ÷ ${W}` +
      `　溢出平砍 = p × max(持續−${W}, 0) ÷ (${W} × (1−p))　` +
      `<span style="color:var(--muted)">p = 爆發占比 = ${(p * 100).toFixed(0)}%</span><br>` +
      rows.map(r =>
        `・<b>${esc(r.name)}</b> 持續 ${r.dur}s → 爆發窗覆蓋 ${(r.cover * 100).toFixed(0)}%:${esc(fmtEff(r.eff, r.cover))}` +
        (r.spill > 0
          ? `;溢出平砍 ${(r.spill * 100).toFixed(1)}%:${esc(fmtEff(r.eff, r.spill))}`
          : (r.dur > W ? ";溢出部分需填爆發占比才會計入" : ""))
      ).join("<br>");
  }

  function setMode(m) {
    mode = m;
    persist();
    summarize();
  }

  function init(charName, statMap, className) {
    saveKey = "msec_buff_" + (charName || "");
    ctx.buffDuration = (statMap && statMap["Buff持續時間"]) || 0;
    ctx.className = className || "";
    state = {}; mode = "hot";
    try {
      const raw = JSON.parse(localStorage.getItem(saveKey) || "{}");
      // 相容舊版(直接存勾選表)與新版({sel, mode})
      if (raw && typeof raw === "object" && raw.sel) {
        state = raw.sel || {};
        mode = raw.mode === "cold" ? "cold" : "hot";
      } else {
        state = raw || {};
      }
    } catch (_) { state = {}; }
    render();
    summarize();
  }

  // 「估計爆發占比」變動時重新整理(規範戒指為動態值)
  function refresh() {
    summarize();   // 爆發占比影響溢出率與明細,需重算摘要
  }

  // 重繪目前分頁(升等增幅會隨基準值變動)
  function redrawActive() {
    const tabs = $("buffTabs");
    if (!tabs || !tabs.children.length) return;
    const i = [...tabs.children].findIndex(b => b.className !== "ghost");
    renderList(CATS[Math.max(i, 0)][0]);
  }

  $("btnBuffHot").onclick = () => setMode("hot");
  $("btnBuffCold").onclick = () => setMode("cold");

  return { init, refresh, redrawActive, totals, burstTotals, hasBurst, LABELS };
})();

/* ---------- 模擬 ---------- */
const BASE_FIELDS = [
  ["build",      "職業體系",             "select"],
  ["mainFinal",  "主屬(最終值)",         "num"],
  ["minorFinal", "副屬(最終值)",         "num"],
  ["attack",     "攻擊力(最終值)",       "num"],
  ["dmg",        "傷害%",                "num"],
  ["boss",       "BOSS傷%",              "num"],
  ["crit",       "爆擊傷害%",            "num"],
  ["fd",         "最終傷害%",            "num"],
  ["ignore",     "無視防禦%",            "num"],
];
// 目標設定(獨立一列)
const TARGET_FIELDS = [
  ["bossPdr", "目標BOSS防禦%", "num"],
];
const MANUAL_FIELDS = [
  ["attackPct",   "攻擊%"],
  ["mainPct",     "主屬%"],
  ["mainUnique",  "不吃%主屬"],
  ["minorPct",    "副屬%"],
  ["minorUnique", "不吃%副屬"],
  ["hpReal",      "HP 實際值(API 上限 50 萬)"],   // 僅惡魔復仇者顯示
];

/* 依職業體系決定欄位名稱與說明 */
function statLabels(bk) {
  const d = Engine.BUILDS[bk] || Engine.BUILDS.str;
  if (bk === "hp") return {
    main: "HP", minor: "STR", mainPct: "HP%", minorPct: "STR%", hasMinor: true,
    note: "惡魔復仇者:屬性 = 0.8 ×(HP ÷ 3.5)+ STR,1 點 STR 約等於 4.38 點 HP。" +
          "主屬欄位一律填 HP;全屬類 buff 只會加到 STR,不會加到 HP。",
  };
  if (bk === "xenon") return {
    main: "三屬合計", minor: "", mainPct: "全屬%", minorPct: "", hasMinor: false,
    note: "傑諾:屬性 = 4 ×(STR + DEX + LUK),沒有副屬。「全屬%」欄位填三屬共通的百分比。" +
          "變化量的「三屬合計」請填三項加總(裝備給全屬 +30 就填 90;只給 DEX +200 則填 200);" +
          "若是只作用於單一屬性的百分比(如 STR% +10),請改用下方⑤的「STR/DEX/LUK ±%(單屬)」欄位。",
  };
  const M = d.main.join("+"), N = d.minor.join("+");
  return {
    main: `主屬(${M})`, minor: `副屬(${N})`,
    mainPct: `主屬%(${M})`, minorPct: `副屬%(${N})`, hasMinor: true,
    note: d.minor.length > 1
      ? `屬性 = 4 × ${M} + (${N})。副屬為兩項之和,若 ${d.minor[0]}% 與 ${d.minor[1]}% 不同,請填加權平均。`
      : `屬性 = 4 × ${M} + ${N}。`,
  };
}
// 爆發相關(獨立一列)
const BURST_FIELDS = [
  ["burst",    "估計爆發占比%(10~90)"],
  ["burstSec", "爆發窗秒數(預設20)"],
];
// 首次載入的預設值
const MANUAL_DEFAULTS = { burst: 50, burstSec: 20 };
// 有預設值、未填不需警告的欄位
const MANUAL_OPTIONAL = new Set(["burstSec"]);
// 未填時的影響說明
const MANUAL_IMPACT = {
  attackPct:   "「攻擊力 ±」的裸攻加成不會乘上攻擊%,增幅會被低估",
  mainPct:     "主屬裸值無法反推,「主屬 ±%」會直接乘面板值而偏高",
  mainUnique:  "不吃%的主屬(符文、悉法等)視為 0,裸值反推會偏高",
  minorPct:    "副屬裸值無法反推,「副屬 ±%」會直接乘面板值而偏高",
  minorUnique: "不吃%的副屬視為 0,裸值反推會偏高",
  burst:       "爆發期加權失效,規範戒指/靈魂契約將完全不列入計算",
  hpReal:      "API 的 HP 上限為 50 萬,若實際血量更高會被低估(未超過 50 萬則可不填)",
};
// 有預設值或視情況才需填的欄位,不列入未填警告
const MANUAL_SKIP_WARN = new Set(["hpReal"]);
const DELTA_FIELDS = [
  ["mainFlat",    "主屬 ±(吃%)"],
  ["mainPct",     "主屬 ±%"],
  ["mainUnique",  "不吃%主屬 ±"],
  ["minorFlat",   "副屬 ±(吃%)"],
  ["minorPct",    "副屬 ±%"],
  ["minorUnique", "不吃%副屬 ±"],
  ["attackFlat",  "攻擊力 ±(裸攻,會吃%)"],
  ["attackPct",   "攻擊 ±%"],
  ["dmg",         "傷害 ±%"],
  ["boss",        "BOSS傷 ±%"],
  ["crit",        "爆傷 ±%"],
  ["ignore",      "無視防禦 ±%(乘算)"],
  // 傑諾專用:單一屬性%(只作用於該屬性,不像全屬%三項都吃)
  ["strPct",      "STR ±%(單屬)"],
  ["dexPct",      "DEX ±%(單屬)"],
  ["lukPct",      "LUK ±%(單屬)"],
];
const XENON_PCT_FIELDS = ["strPct", "dexPct", "lukPct"];
const FACTOR_LABELS = {
  attribute: "屬性", attackFlat: "攻擊力", attackPct: "攻擊%",
  dmgBoss: "傷害+BOSS", crit: "爆傷", finalDmg: "終傷", ignore: "無視防禦",
};

function setupSimulation(basic, stat) {
  $("cardManual").classList.remove("hidden");
  $("cardBuff").classList.remove("hidden");
  $("cardSim").classList.remove("hidden");
  $("cardPlans").classList.remove("hidden");
  $("resultBox").classList.add("hidden");
  state.planKey = "msec_plans_" + (basic.character_name || "");
  state.lastSim = null;
  $("btnSavePlan").disabled = true;
  renderPlans();
  const m = state.statMap;
  const build = Engine.detectBuild(state.className);
  state.build = build;
  const B = Engine.BUILDS;

  // 基準值欄位
  const bg = $("baseGrid");
  bg.innerHTML = "";
  const tg = $("targetGrid");
  tg.innerHTML = "";
  for (const [grid, fields] of [[bg, BASE_FIELDS], [tg, TARGET_FIELDS]]) {
    for (const [id, label, type] of fields) {
      if (type === "select") {
        const opts = Object.entries(B).map(([k, v]) =>
          `<option value="${k}" ${k === build ? "selected" : ""}>${v.label}</option>`).join("");
        grid.insertAdjacentHTML("beforeend",
          `<div class="field" id="f_base_${id}"><label>${label}(自動判定,可修改)</label>` +
          `<select id="base_${id}">${opts}</select></div>`);
      } else {
        grid.insertAdjacentHTML("beforeend",
          `<div class="field" id="f_base_${id}"><label>${label}</label>` +
          `<input type="number" step="any" id="base_${id}"></div>`);
      }
    }
  }
  // 依職業體系套用欄位名稱、隱藏無用欄位、顯示說明
  function applyBuildLabels() {
    const L = statLabels($("base_build").value);
    const setLabel = (wrapId, text) => {
      const el = $(wrapId);
      if (el && el.firstElementChild) el.firstElementChild.textContent = text;
    };
    setLabel("f_manual_mainPct",     L.mainPct);
    setLabel("f_manual_mainUnique",  `不吃%${L.main}`);
    setLabel("f_manual_minorPct",    L.minorPct);
    setLabel("f_manual_minorUnique", `不吃%${L.minor}`);
    setLabel("f_delta_mainFlat",     `${L.main} ±(吃%)`);
    setLabel("f_delta_mainPct",      `${L.mainPct} ±`);
    setLabel("f_delta_mainUnique",   `不吃%${L.main} ±`);
    setLabel("f_delta_minorFlat",    `${L.minor} ±(吃%)`);
    setLabel("f_delta_minorPct",     `${L.minorPct} ±`);
    setLabel("f_delta_minorUnique",  `不吃%${L.minor} ±`);
    // HP 實際值欄位只對惡魔復仇者顯示
    const hpField = $("f_manual_hpReal");
    if (hpField) hpField.classList.toggle("hidden", $("base_build").value !== "hp");

    // 單屬性%欄位只對傑諾顯示(其他職業用「主屬%/副屬%」即可)
    const isXenon = $("base_build").value === "xenon";
    for (const id of XENON_PCT_FIELDS) {
      const el = $("f_delta_" + id);
      if (!el) continue;
      el.classList.toggle("hidden", !isXenon);
      if (!isXenon) { const inp = el.querySelector("input"); if (inp) inp.value = ""; }
    }

    // 傑諾沒有副屬 → 隱藏相關欄位並清空,避免誤填
    for (const id of ["f_manual_minorPct", "f_manual_minorUnique",
                      "f_delta_minorFlat", "f_delta_minorPct", "f_delta_minorUnique"]) {
      const el = $(id);
      if (!el) continue;
      el.classList.toggle("hidden", !L.hasMinor);
      if (!L.hasMinor) { const inp = el.querySelector("input"); if (inp) inp.value = ""; }
    }
    // ⑤基準值欄位也跟著改名
    setLabel("f_base_mainFinal",  `${L.main}(最終值)`);
    setLabel("f_base_minorFinal", `${L.minor}(最終值)`);
    const bf = $("f_base_minorFinal");
    if (bf) bf.classList.toggle("hidden", !L.hasMinor);

    const note = $("buildNote");
    if (note) note.textContent = L.note;
    updateHpCapWarn();
  }

  // 惡魔復仇者:API 的 HP 受遊戲血條上限影響,超過 50 萬會被截斷
  function updateHpCapWarn() {
    const warn = $("hpCapWarn");
    if (!warn) return;
    const isHp = $("base_build").value === "hp";
    warn.classList.toggle("hidden", !isHp);
    if (!isHp) return;
    const api = Engine.sumStats(state.statMap || {}, ["HP"]);
    const filled = parseFloat(($("manual_hpReal") || {}).value) || 0;
    warn.innerHTML =
      "因 API 限制,<b>HP 超過 50 萬請自行填入</b>。" +
      "<br>API 讀到的 HP 受遊戲內血條上限截斷(實際血量可能更高)," +
      "請於③手動填入的「HP 實際值」欄位輸入真實血量,否則屬性會被低估。" +
      (filled > 0
        ? `<br>目前已改用你填入的 <b>${filled.toLocaleString()}</b> 計算(API 讀到 ${api.toLocaleString()})。`
        : api >= 499000
          ? `<br><b>API 讀到 ${api.toLocaleString()},已達上限,極可能被截斷。</b>`
          : `<br>API 讀到 ${api.toLocaleString()},未達上限,可不必填寫。`);
  }

  $("base_build").onchange = () => { applyBuildLabels(); fillBaseline(); };

  // 目標BOSS防禦%:依角色記憶,不隨 buff/基準值重算而被覆寫
  const targetKey = "msec_target_" + (basic.character_name || "");
  const savedPdr = localStorage.getItem(targetKey);
  $("base_bossPdr").value = savedPdr != null && savedPdr !== "" ? savedPdr : 300;
  $("base_bossPdr").addEventListener("input", () => {
    localStorage.setItem(targetKey, $("base_bossPdr").value);
    if (state.planKey) renderPlans();          // 影響無視防禦效益 → 方案重算
    if (state.buffReady) BuffUI.redrawActive();
  });

  function fillBaseline() {
    const bk = $("base_build").value;
    const def = B[bk];
    const isMage = bk === "int";
    const t = BuffUI.totals();               // buff 加成
    const r = (x) => Math.round(x * 100) / 100;
    const atk = isMage
      ? (m["魔法攻擊力"] || m["攻擊力"] || 0)
      : (m["攻擊力"] || m["魔法攻擊力"] || 0);

    // 屬性:全屬(all)對「每一項」主/副屬各加一次(傑諾三主屬 = ×3、雙副屬 = ×2)
    //  buff 的裸屬與裝備一樣會吃屬性%,故須先還原裸值、加上 buff 後再一併乘%
    const hpBuild  = bk === "hp";
    const allFlat  = t.all || 0;
    const gvm = (id) => parseFloat(($("manual_" + id) || {}).value) || 0;
    const mainPctM  = gvm("mainPct") / 100,  mainUq  = gvm("mainUnique");
    const minorPctM = gvm("minorPct") / 100, minorUq = gvm("minorUnique");
    const allP = (t.allP || 0) / 100;                       // 全屬%(合成邏輯)
    const mainAllP  = hpBuild ? 0 : allP;                   // 全屬%不作用於 HP

    const mainFlatBuff  = hpBuild
      ? (t.hp || 0)
      : allFlat * def.main.length + (t.main || 0);
    const minorFlatBuff = allFlat * def.minor.length + (t.sub || 0)
      + (def.minor.length > 1 ? (t.sub2 || 0) : 0);

    // 惡魔復仇者:API 的 HP 上限 50 萬,使用者可於③填入實際值覆寫
    const hpReal = gvm("hpReal");
    const apiMain = (hpBuild && hpReal > 0) ? hpReal : Engine.sumStats(m, def.main);

    const mainClear  = Engine.deriveClear(apiMain,  mainPctM,  mainUq);
    const minorClear = Engine.deriveClear(Engine.sumStats(m, def.minor), minorPctM, minorUq);
    setV("mainFinal",  r((mainClear  + mainFlatBuff)  * (1 + mainPctM  + mainAllP) + mainUq));
    setV("minorFinal", r(def.minor.length
      ? (minorClear + minorFlatBuff) * (1 + minorPctM + allP) + minorUq
      : 0));
    // 攻擊力:面板已含攻擊%,buff 的裸攻須乘上總攻擊%後才能加到面板值
    const manualAtkP = (parseFloat(($("manual_attackPct") || {}).value) || 0) / 100;
    const totalAtkP  = manualAtkP + (t.atkP || 0) / 100;
    const atkClear   = atk / (1 + manualAtkP);
    setV("attack", r((atkClear + (t.atk || 0)) * (1 + totalAtkP)));
    setV("dmg", r((m["傷害"] || 0) + (t.dmg || 0)));
    setV("boss", r((m["BOSS怪物傷害"] || 0) + (t.boss || 0)));
    setV("crit", r((m["爆擊傷害"] || 0) + (t.crit || 0)));
    setV("fd", m["最終傷害"] || 0);
    // 無視防禦為乘算疊加
    setV("ignore", r(Engine.combineIgnore((m["無視防禦率"] || 0) / 100, (t.ign || 0) / 100) * 100));
    // 目標BOSS防禦%為使用者設定值,不隨 buff 變動重設
    // 攻擊% 與 全屬% 疊到手動填入區的基準百分比上
    state.buffAtkP = t.atkP || 0;
    state.buffAllP = t.allP || 0;
    state.hpBuild  = hpBuild;
    state.buffFlat = { main: mainFlatBuff, minor: minorFlatBuff, atk: t.atk || 0 };
    updateDerivedClear();
    updateHpCapWarn();
    // 基準值變動 → 方案增幅與 buff 升等效益一併重算
    if (state.planKey) renderPlans();
    if (state.buffReady) BuffUI.redrawActive();
    function setV(id, v) { $("base_" + id).value = v; }
  }
  // buff 變動時即時重算基準值
  window.onBuffChange = fillBaseline;

  // 手動填入欄位(依角色名記憶);爆發相關另置一列
  const saveKey = "msec_manual_" + (basic.character_name || "");
  const saved = JSON.parse(localStorage.getItem(saveKey) || "{}");
  const ALL_MANUAL = [...MANUAL_FIELDS, ...BURST_FIELDS];
  for (const [grid, fields] of [[$("manualGrid"), MANUAL_FIELDS], [$("burstGrid"), BURST_FIELDS]]) {
    grid.innerHTML = "";
    for (const [id, label] of fields) {
      grid.insertAdjacentHTML("beforeend",
        `<div class="field" id="f_manual_${id}"><label>${label}</label>` +
        `<input type="number" step="any" id="manual_${id}" placeholder="${id === "burstSec" ? "20" : "0"}"></div>`);
      const v = saved[id] != null ? saved[id] : MANUAL_DEFAULTS[id];
      if (v != null) $("manual_" + id).value = v;
    }
  }
  for (const [id] of ALL_MANUAL) {
    $("manual_" + id).addEventListener("input", () => {
      const data = {};
      for (const [i2] of ALL_MANUAL) {
        const v = $("manual_" + i2).value;
        if (v !== "") data[i2] = v;
      }
      localStorage.setItem(saveKey, JSON.stringify(data));
      updateDerivedClear();
      updateManualWarn();
      // 爆發占比/爆發窗會改變覆蓋率與溢出率;各項%會改變裸值還原 → 皆需重算
      if (id === "burst" || id === "burstSec") BuffUI.refresh();
      fillBaseline();
    });
  }
  $("base_mainFinal").addEventListener("input", updateDerivedClear);
  $("base_minorFinal").addEventListener("input", updateDerivedClear);

  // 初始化流程移至所有欄位(含變化量)建立之後,見本函式末端 bootstrap()

  // 未填欄位提示
  function updateManualWarn() {
    const empty = [];
    for (const [id, label] of [...MANUAL_FIELDS, ...BURST_FIELDS]) {
      const el = $("manual_" + id);
      const skip = MANUAL_OPTIONAL.has(id) || MANUAL_SKIP_WARN.has(id);
      const blank = !el || el.value.trim() === "";
      if (el) el.classList.toggle("unfilled", blank && !skip);
      if (blank && !skip) empty.push([id, label]);
    }
    const box = $("manualWarn");
    if (!empty.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.innerHTML =
      `⚠ 尚有 <b>${empty.length}</b> 項未填(視為 0),可能影響計算準確度:<br>` +
      empty.map(([id, label]) =>
        `・<b>${esc(label.replace(/%\(.*$/, "%"))}</b> — ${esc(MANUAL_IMPACT[id] || "")}`).join("<br>");
  }

  function updateDerivedClear() {
    const gv = (id) => parseFloat(($(id) || {}).value) || 0;
    // 反推裸值須用「總%」= 手動填入 + buff 提供的全屬%/攻擊%
    const allP = (state.hpBuild ? 0 : (state.buffAllP || 0)) / 100;
    const mc = Engine.deriveClear(gv("base_mainFinal"), gv("manual_mainPct") / 100 + allP, gv("manual_mainUnique"));
    const nc = Engine.deriveClear(gv("base_minorFinal"), gv("manual_minorPct") / 100 + (state.buffAllP || 0) / 100, gv("manual_minorUnique"));
    const ac = gv("base_attack") / (1 + gv("manual_attackPct") / 100 + (state.buffAtkP || 0) / 100);

    // 拆出「面板本身的裸值」與「buff 提供的裸值」,避免混淆
    const bf = state.buffFlat || { main: 0, minor: 0, atk: 0 };
    const n = (x) => Math.round(x).toLocaleString();
    const part = (label, total, buff) => buff
      ? `${label}:<b>${n(total - buff)}</b> + buff ${n(buff)} = ${n(total)}`
      : `${label}:<b>${n(total)}</b>`;
    $("derivedClear").innerHTML =
      `反推裸值(面板 = 裸值×(1+%) + 不吃%值)　` +
      [part("主屬", mc, bf.main), part("副屬", nc, bf.minor), part("裸攻", ac, bf.atk)].join("、");
  }

  // 變化量欄位
  const dg = $("deltaGrid");
  dg.innerHTML = "";
  for (const [id, label] of DELTA_FIELDS)
    dg.insertAdjacentHTML("beforeend",
      `<div class="field" id="f_delta_${id}"><label>${label}</label>` +
      `<input type="number" step="any" id="delta_${id}" placeholder="0"></div>`);

  // 終傷即時預覽
  const fdPreview = () => {
    const from = parseFloat($("delta_fdFrom").value) || 0;
    const to = parseFloat($("delta_fdTo").value) || 0;
    const el = $("fdPreview");
    if (!from && !to) { el.textContent = ""; return; }
    const ratio = (1 + to / 100) / (1 + from / 100);
    const panelOld = parseFloat($("base_fd").value) || 0;
    const panelNew = (1 + panelOld / 100) * ratio - 1;
    el.textContent = `終傷增幅 ×${ratio.toFixed(4)}(${ratio >= 1 ? "+" : ""}${((ratio - 1) * 100).toFixed(2)}%);面板終傷 ${panelOld}% → ${(panelNew * 100).toFixed(2)}%`;
  };
  $("delta_fdFrom").oninput = fdPreview;
  $("delta_fdTo").oninput = fdPreview;
  fdPreview();

  $("btnCalc").onclick = runSimulation;
  $("btnResetDelta").onclick = () => {
    for (const [id] of DELTA_FIELDS) $("delta_" + id).value = "";
    $("delta_fdFrom").value = "";
    $("delta_fdTo").value = "";
    fdPreview();
    $("resultBox").classList.add("hidden");
  };

  // 所有欄位(基準值/手動填入/變化量)都建立完成後才初始化,
  // 否則依職業套用的標籤會被後建立的欄位覆蓋
  state.buffReady = false;
  applyBuildLabels();
  BuffUI.init(basic.character_name, m, basic.character_class);
  fillBaseline();
  state.buffReady = true;
  BuffUI.redrawActive();
  updateDerivedClear();
  updateManualWarn();
}

/* ---------- 共用計算入口 ---------- */
// 由目前⑥的基準值欄位 + ④手動填入 組出 baseline
function buildBaseline() {
  const gv = (id) => parseFloat(($(id) || {}).value) || 0;
  const pct = (v) => v / 100;
  return {
    build:       $("base_build").value,
    mainFinal:   gv("base_mainFinal"),
    mainPct:     pct(gv("manual_mainPct") + (state.hpBuild ? 0 : (state.buffAllP || 0))),
    mainUnique:  gv("manual_mainUnique"),
    minorFinal:  gv("base_minorFinal"),
    minorPct:    pct(gv("manual_minorPct") + (state.buffAllP || 0)),
    minorUnique: gv("manual_minorUnique"),
    attack:      gv("base_attack"),
    attackPct:   pct(gv("manual_attackPct") + (state.buffAtkP || 0)),
    dmg:         pct(gv("base_dmg")),
    boss:        pct(gv("base_boss")),
    crit:        pct(gv("base_crit")),
    fd:          pct(gv("base_fd")),
    ignore:      pct(gv("base_ignore")),
    bossPdr:     pct(gv("base_bossPdr")),
  };
}

// 爆發期基準值(疊上爆發專用 buff)與爆發占比
function buildBurst(baseline) {
  const gv = (id) => parseFloat(($(id) || {}).value) || 0;
  const pct = (v) => v / 100;
  const bt = BuffUI.burstTotals();
  const p = Math.min(Math.max(gv("manual_burst") / 100, 0), 1);
  if (!Object.keys(bt).length || !(p > 0)) return { burstBase: null, p };
  const atkClear = baseline.attack / (1 + baseline.attackPct);
  const nAtkP = baseline.attackPct + pct(bt.atkP || 0);
  return {
    p,
    burstBase: {
      ...baseline,
      attackPct: nAtkP,
      attack:    (atkClear + (bt.atk || 0)) * (1 + nAtkP),
      dmg:       baseline.dmg + pct(bt.dmg || 0),
      boss:      baseline.boss + pct(bt.boss || 0),
      crit:      baseline.crit + pct(bt.crit || 0),
      ignore:    Engine.combineIgnore(baseline.ignore, pct(bt.ign || 0)),
    },
  };
}

// 以「目前的角色狀態」評估一組變化量
function evaluate(delta, burstExtra) {
  const baseline = buildBaseline();
  const { burstBase, p } = buildBurst(baseline);
  return Engine.simulateWeighted(baseline, burstBase, delta, p, burstExtra);
}

// DOM → 原始字串變化量(供儲存)
function readRawDelta() {
  const raw = {};
  for (const [id] of DELTA_FIELDS) raw[id] = $("delta_" + id).value;
  raw.fdFrom = $("delta_fdFrom").value;
  raw.fdTo = $("delta_fdTo").value;
  return raw;
}

// 原始字串 → 引擎用的數值變化量
function toDelta(raw) {
  const g = (k) => parseFloat(raw[k]) || 0;
  const pct = (v) => v / 100;
  const d = {
    mainFlat: g("mainFlat"), mainPct: pct(g("mainPct")), mainUnique: g("mainUnique"),
    minorFlat: g("minorFlat"), minorPct: pct(g("minorPct")), minorUnique: g("minorUnique"),
    attackFlat: g("attackFlat"), attackPct: pct(g("attackPct")),
    dmg: pct(g("dmg")), boss: pct(g("boss")), crit: pct(g("crit")),
    ignore: pct(g("ignore")), fdFrom: pct(g("fdFrom")), fdTo: pct(g("fdTo")),
  };

  // 傑諾:單一屬性%只作用於該屬性,不能直接套用在三屬合計上。
  //   STR% +p 的效果 = 該屬性裸值 × p,且此增量已在%之後,故計入「不吃%」。
  //   各屬裸值以面板值比例分攤總裸值估算。
  if (($("base_build") || {}).value === "xenon") {
    const m = state.statMap || {};
    const total = (m.STR || 0) + (m.DEX || 0) + (m.LUK || 0);
    if (total > 0) {
      const gvm = (id) => parseFloat(($("manual_" + id) || {}).value) || 0;
      const totalPct = gvm("mainPct") / 100 + (state.buffAllP || 0) / 100;
      const clear = Engine.deriveClear(total, totalPct, gvm("mainUnique"));
      for (const [key, stat] of [["strPct", "STR"], ["dexPct", "DEX"], ["lukPct", "LUK"]]) {
        const p = pct(g(key));
        if (p) d.mainUnique += clear * ((m[stat] || 0) / total) * p;
      }
    }
  }
  return d;
}

function runSimulation() {
  const rawDelta = readRawDelta();
  const delta = toDelta(rawDelta);
  const p = Math.min(Math.max((parseFloat(($("manual_burst") || {}).value) || 0) / 100, 0), 1);

  const res = evaluate(delta);
  const { factors, total } = res;
  const box = $("resultBox");
  box.classList.remove("hidden");

  // 兩段結果說明
  const phase = $("phaseInfo");
  if (res.burst) {
    const np = (res.normal.total - 1) * 100, bp = (res.burst.total - 1) * 100;
    phase.classList.remove("hidden");
    phase.textContent =
      `平時 ${np >= 0 ? "+" : ""}${np.toFixed(2)}% ／ 爆發期 ${bp >= 0 ? "+" : ""}${bp.toFixed(2)}%` +
      `(爆發占比 ${(p * 100).toFixed(0)}%,爆發期傷害為平時的 ${res.R.toFixed(2)} 倍;下方為加權結果)`;
  } else {
    phase.classList.add("hidden");
  }

  const totalPct = (total - 1) * 100;
  const t = $("resultTotal");
  t.textContent = `${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(2)}%`;
  t.className = "total " + (totalPct >= 0 ? "up" : "down");

  const bd = $("breakdown");
  bd.innerHTML = "";
  for (const [k, label] of Object.entries(FACTOR_LABELS)) {
    const p = (factors[k] - 1) * 100;
    if (Math.abs(p) < 0.0001) continue;
    bd.insertAdjacentHTML("beforeend",
      `<div class="bd"><div class="k">${label}</div><div class="v ${p >= 0 ? "up" : "down"}">${p >= 0 ? "+" : ""}${p.toFixed(2)}%</div></div>`);
  }
  if (!bd.children.length)
    bd.innerHTML = `<div class="bd"><div class="k">無變化</div><div class="v">±0.00%</div></div>`;

  // 記錄本次結果供「儲存方案」使用
  state.lastSim = { totalPct, rawDelta, ts: Date.now() };
  $("btnSavePlan").disabled = false;
}

/* ---------- 儲存方案 ---------- */
const DELTA_LABELS = Object.fromEntries(DELTA_FIELDS);

function loadPlans() {
  try { return JSON.parse(localStorage.getItem(state.planKey) || "[]"); }
  catch (_) { return []; }
}

function deltaDescription(rawDelta) {
  const parts = [];
  for (const [id, label] of DELTA_FIELDS) {
    const v = parseFloat(rawDelta[id]);
    if (v) parts.push(`${label.replace(/ ±.*$/, "")} ${v > 0 ? "+" : ""}${v}${label.includes("±%") ? "%" : ""}`);
  }
  const from = parseFloat(rawDelta.fdFrom) || 0, to = parseFloat(rawDelta.fdTo) || 0;
  if (from || to) parts.push(`終傷 ${from}%→${to}%`);
  return parts.join("、") || "(無變化量)";
}

$("btnSavePlan").onclick = () => {
  if (!state.lastSim) return;
  const name = $("planName").value.trim() || `方案 ${new Date().toLocaleString("zh-TW", { hour12: false })}`;
  const costV = parseFloat($("planCost").value);
  const plans = loadPlans();
  plans.push({ name, totalPct: state.lastSim.totalPct, rawDelta: state.lastSim.rawDelta,
               cost: Number.isFinite(costV) && costV > 0 ? costV : null,
               ts: Date.now() + Math.random() });
  localStorage.setItem(state.planKey, JSON.stringify(plans));
  $("planName").value = "";
  $("planCost").value = "";
  renderPlans();
};

// 以「目前的角色狀態」重算方案增幅,確保所有方案站在同一基準比較
function livePct(plan) {
  try { return (evaluate(toDelta(plan.rawDelta || {})).total - 1) * 100; }
  catch (_) { return plan.totalPct; }
}

// 每 1% 增幅的成本(CP 指標,越低越好);無成本或增幅≤0 → null
function unitCost(p) {
  if (p.cost == null || !(p.pct > 0)) return null;
  return p.cost / p.pct;
}

$("sortPct").onclick = () => setPlanSort("pct");
$("sortCp").onclick = () => setPlanSort("cp");
function setPlanSort(mode) {
  state.planSort = mode;
  $("sortPct").className = mode === "pct" ? "" : "ghost";
  $("sortCp").className = mode === "cp" ? "" : "ghost";
  renderPlans();
}

function renderPlans() {
  const list = $("planList");
  const mode = state.planSort || "pct";
  // 以當前基準即時重算每個方案(p.pct),存檔值(p.totalPct)僅供對照
  const plans = loadPlans().map(p => ({ ...p, pct: livePct(p) })).sort((a, b) => {
    if (mode === "cp") {
      const ua = unitCost(a), ub = unitCost(b);
      if (ua == null && ub == null) return b.pct - a.pct;
      if (ua == null) return 1;   // 無成本者排後
      if (ub == null) return -1;
      return ua - ub;             // 每1%成本越低越前
    }
    return b.pct - a.pct;
  });
  list.innerHTML = "";
  if (!plans.length) {
    $("planHint").classList.remove("hidden");
    return;
  }
  $("planHint").classList.add("hidden");
  plans.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "plan";
    const cls = p.pct >= 0 ? "up" : "down";
    const uc = unitCost(p);
    const isBest = i === 0 && plans.length > 1 && (mode === "pct" || uc != null);
    const bestLabel = mode === "cp" ? "CP值最高" : "效益最高";
    const num = (x, d = 0) => x.toLocaleString(undefined, { maximumFractionDigits: d });
    // 基準值變動後與存檔時的差異
    const drift = (p.totalPct != null && Math.abs(p.pct - p.totalPct) > 0.005)
      ? `<span class="drift" title="基準值已變動,顯示的是以目前狀態重算的結果">存檔時 ${p.totalPct >= 0 ? "+" : ""}${p.totalPct.toFixed(2)}%</span>` : "";
    row.innerHTML =
      `<div class="rank">#${i + 1}</div>
       <div class="pname">${esc(p.name)}${isBest ? ` <span class="best">${bestLabel}</span>` : ""}</div>
       <div class="pcol"><span class="ck">成本</span><span class="cv">${p.cost != null ? num(p.cost) : "—"}</span></div>
       <div class="pcol"><span class="ck">每 1% 成本</span><span class="cv">${uc != null ? num(uc, 1) : "—"}</span></div>
       <div class="pcol"><span class="ck">增幅${drift ? " *" : ""}</span><span class="cv ${cls}">${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(2)}%</span></div>
       <button class="ghost" data-act="load">載入</button>
       <button class="ghost" data-act="del" style="color:var(--bad);border-color:var(--bad)">刪除</button>
       <div class="pdesc">${esc(deltaDescription(p.rawDelta || {}))}${drift}</div>`;
    row.querySelector('[data-act="load"]').onclick = () => loadPlan(p);
    row.querySelector('[data-act="del"]').onclick = () => deletePlan(p.ts);
    list.appendChild(row);
  });
}

function loadPlan(p) {
  const rd = p.rawDelta || {};
  for (const [id] of DELTA_FIELDS) $("delta_" + id).value = rd[id] || "";
  $("delta_fdFrom").value = rd.fdFrom || "";
  $("delta_fdTo").value = rd.fdTo || "";
  $("delta_fdFrom").dispatchEvent(new Event("input")); // 更新終傷預覽
  runSimulation();
  $("cardSim").scrollIntoView({ behavior: "smooth" });
}

function deletePlan(ts) {
  const plans = loadPlans().filter(p => p.ts !== ts);
  localStorage.setItem(state.planKey, JSON.stringify(plans));
  renderPlans();
}

// 主程式已成功載入(供 index.html 的啟動診斷判斷)
window.__msecReady = true;
