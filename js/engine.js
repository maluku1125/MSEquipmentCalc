/**
 * 計算引擎 —— 純函式,無 DOM/瀏覽器相依。
 * 瀏覽器:以 <script src> 載入後可用全域 Engine
 * node  :const { Engine } = require('./js/engine.js')
 */

const Engine = (() => {

  // 職業體系:主/副屬對應與屬性係數
  const BUILDS = {
    str:   { label: "力量型(主STR/副DEX)",     main: ["STR"],              minor: ["DEX"] },
    dex:   { label: "敏捷型(主DEX/副STR)",     main: ["DEX"],              minor: ["STR"] },
    int:   { label: "智力型(主INT/副LUK)",     main: ["INT"],              minor: ["LUK"] },
    luk:   { label: "幸運型(主LUK/副DEX)",     main: ["LUK"],              minor: ["DEX"] },
    luk2:  { label: "幸運型(主LUK/副STR+DEX)", main: ["LUK"],              minor: ["STR", "DEX"] },
    xenon: { label: "傑諾(STR+DEX+LUK)",       main: ["STR", "DEX", "LUK"], minor: [] },
    hp:    { label: "惡魔復仇者(HP)",           main: ["HP"],               minor: ["STR"] },
  };

  // API character_class 關鍵字 → 體系(比對採「包含」,容忍 API 名稱變體)
  const CLASS_KEYWORDS = [
    ["hp",    ["惡魔復仇者"]],
    ["xenon", ["傑諾"]],
    ["luk2",  ["暗影神偷", "影武者", "卡蒂娜"]],
    ["luk",   ["夜使者", "暗夜行者", "幻影俠盜", "虎影", "卡莉"]],
    ["int",   ["大魔導士", "主教", "烈焰巫師", "煉獄巫師", "龍魔導士", "夜光",
               "伊利恩", "凱內西斯", "菈菈", "琳恩", "陰陽師"]],
    ["dex",   ["箭神", "神射手", "開拓者", "槍神", "破風使者", "狂豹獵人", "機甲戰神",
               "精靈遊俠", "天使破壞者", "凱殷", "墨玄"]],
    ["str",   ["英雄", "聖騎士", "黑騎士", "拳霸", "重砲指揮官", "聖魂劍士", "閃雷悍將",
               "米哈逸", "爆拳槍神", "惡魔殺手", "狂狼勇士", "隱月", "凱撒", "亞克",
               "阿戴爾", "神之子", "劍豪"]],
  ];

  // 爆傷基底 = 基礎傷害 1.0 + 基礎爆傷 0.35。
  // 已確認 API 的「爆擊傷害」不含基礎 35%,故此處相加不會重複計算。
  const CRIT_BASE = 1.35;
  const DA_HP_DIVISOR = 3.5, DA_HP_WEIGHT = 0.8; // 惡魔復仇者 HP→屬性 近似換算

  function detectBuild(className) {
    if (!className) return "str";
    for (const [key, words] of CLASS_KEYWORDS)
      if (words.some(w => className.includes(w))) return key;
    return "str";
  }

  // final_stat 陣列 → { 名稱: 數值 }
  function parseFinalStat(list) {
    const out = {};
    for (const s of list || []) {
      const name = s.stat_name, raw = s.stat_value;
      if (name == null || raw == null) continue;
      const num = parseFloat(String(raw).replace(/[,%\s]/g, ""));
      if (!Number.isNaN(num)) out[name] = num;
    }
    return out;
  }

  function sumStats(statMap, names) {
    return names.reduce((acc, n) => acc + (statMap[n] || 0), 0);
  }

  // 屬性戰力:一般 4×主+副;惡魔復仇者 HP 折算
  function attributePower(main, minor, buildKey) {
    if (buildKey === "hp") return DA_HP_WEIGHT * (main / DA_HP_DIVISOR) + minor;
    return 4 * main + minor;
  }

  // 無視防禦乘算疊加(delta<0 = 移除一條 |delta| 的無視)
  function combineIgnore(base, delta) {
    let v = base;
    if (delta > 0) v = 1 - (1 - base) * (1 - delta);
    if (delta < 0) v = 1 - (1 - base) / (1 - Math.min(-delta, 0.9999));
    return Math.min(Math.max(v, 0), 1);
  }

  // 對特定防禦率怪物的傷害係數
  function defenseFactor(ignore, monsterPdr) {
    return Math.max(1 - monsterPdr * (1 - ignore), 0.0001);
  }

  // 由最終值反推吃%裸值:final = clear×(1+pct) + unique
  function deriveClear(finalV, pct, unique) {
    return Math.max((finalV - unique) / (1 + pct), 0);
  }

  /**
   * 模擬總增幅
   * 屬性模型:最終值 = 吃%裸值(clear) × (1 + 屬性%) + 不吃%值(unique)
   * baseline: { build, mainFinal, mainPct, mainUnique,
   *             minorFinal, minorPct, minorUnique,
   *             attack, attackPct, dmg, boss, crit, fd, ignore, bossPdr }
   *   (百分比一律以小數表示,例如 85% → 0.85)
   * delta: { mainFlat(吃%), mainPct, mainUnique(不吃%),
   *          minorFlat(吃%), minorPct, minorUnique(不吃%),
   *          attackFlat, attackPct, dmg, boss, crit, ignore,
   *          fdFrom, fdTo(終傷單一來源 原先/調整後,互乘逆推) }
   * 回傳 { factors: {各項倍率}, total: 總倍率 }
   */
  function simulate(baseline, delta) {
    const b = baseline, d = delta;
    const f = {};

    // 屬性:flat 變化吃%,unique 變化不吃%
    const mainClear  = deriveClear(b.mainFinal,  b.mainPct  || 0, b.mainUnique  || 0);
    const minorClear = deriveClear(b.minorFinal, b.minorPct || 0, b.minorUnique || 0);
    const mainNew  = (mainClear  + (d.mainFlat  || 0)) * (1 + (b.mainPct  || 0) + (d.mainPct  || 0)) + (b.mainUnique  || 0) + (d.mainUnique  || 0);
    const minorNew = (minorClear + (d.minorFlat || 0)) * (1 + (b.minorPct || 0) + (d.minorPct || 0)) + (b.minorUnique || 0) + (d.minorUnique || 0);
    const apOld = attributePower(b.mainFinal, b.minorFinal, b.build);
    const apNew = attributePower(mainNew, minorNew, b.build);
    f.attribute = apOld > 0 ? apNew / apOld : 1;

    // 攻擊力:面板值已含攻擊%,故 flat 加成須先還原為「裸攻」再一併乘上%
    //   裸攻 = 面板 ÷ (1+攻擊%);新面板 = (裸攻 + flat) × (1 + 攻擊% + Δ攻擊%)
    const atkClear = b.attack / (1 + (b.attackPct || 0));
    f.attackFlat = atkClear > 0 ? (atkClear + (d.attackFlat || 0)) / atkClear : 1;
    f.attackPct  = (1 + b.attackPct + (d.attackPct || 0)) / (1 + b.attackPct);

    // 傷害 + BOSS 傷(共用同一乘區)
    const dbOld = 1 + b.dmg + b.boss;
    f.dmgBoss = (dbOld + (d.dmg || 0) + (d.boss || 0)) / dbOld;

    // 爆擊傷害
    f.crit = (CRIT_BASE + b.crit + (d.crit || 0)) / (CRIT_BASE + b.crit);

    // 最終傷害:各來源互乘,以「單一來源 原先→調整後」逆推
    // 增幅 = (1+調整後) / (1+原先);面板新值 = (1+面板)×增幅 - 1
    f.finalDmg = (1 + (d.fdTo || 0)) / (1 + (d.fdFrom || 0));

    // 無視防禦
    const igNew = combineIgnore(b.ignore, d.ignore || 0);
    f.ignore = defenseFactor(igNew, b.bossPdr) / defenseFactor(b.ignore, b.bossPdr);

    const total = f.attribute * f.attackFlat * f.attackPct * f.dmgBoss * f.crit * f.finalDmg * f.ignore;
    return { factors: f, total };
  }

  // 合併兩組變化量(數值相加;無視防禦以乘算疊加)
  function mergeDelta(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) {
      if (!v) continue;
      if (k === "ignore") out.ignore = 1 - (1 - (out.ignore || 0)) * (1 - v);
      else if (k === "fdFrom" || k === "fdTo") out[k] = v;
      else out[k] = (out[k] || 0) + v;
    }
    return out;
  }

  // 相對戰力(僅用於比較兩種狀態的傷害比例,非絕對傷害值)
  function power(b) {
    return attributePower(b.mainFinal, b.minorFinal, b.build)
         * b.attack
         * (1 + b.dmg + b.boss)
         * (CRIT_BASE + b.crit)
         * (1 + b.fd)
         * defenseFactor(b.ignore, b.bossPdr);
  }

  /**
   * 兩段加權模擬
   *   q = 爆發期的「傷害占比」(職業特性,例如 20 秒打完 70% 傷害 → q = 0.7)
   *   增幅 = q × r_爆發 + (1−q) × r_平時
   * 因為 q 直接就是傷害權重,不需再推導傷害率倍率。
   * 爆發專用 buff 之間的相乘效果只落在爆發窗內,
   * 不會像「等效常駐值」那樣把交叉項稀釋成 q²。
   *
   *   burstExtra:僅作用於爆發期的額外變化量(例如爆發專用技能升級)
   */
  function simulateWeighted(normal, burst, delta, q, burstExtra) {
    const rn = simulate(normal, delta);
    if (!burst || !(q > 0)) return { factors: rn.factors, total: rn.total, normal: rn, burst: null, R: 1 };
    const rb = simulate(burst, burstExtra ? mergeDelta(delta, burstExtra) : delta);
    return {
      factors: rn.factors,
      total: q * rb.total + (1 - q) * rn.total,
      normal: rn, burst: rb,
      R: power(burst) / power(normal),   // 僅供顯示:爆發期與平時的傷害率倍率
    };
  }

  /**
   * 爆發技能的時間分布
   *   dur   持續秒數 / cd 冷卻秒數 / W 爆發窗秒數 / C 爆發週期(預設 120)
   *   aligned=true(對軸):第一次與爆發窗起點對齊,之後每 cd 秒一次
   *   aligned=false(不對軸):觸發時機與爆發無關,視為均勻分布
   * 回傳 { n 每輪次數, cover 窗內覆蓋率, spill 平砍覆蓋率, uptime 總佔比 }
   */
  function skillCoverage(dur, cd, W, C = 120, aligned = true) {
    const n = Math.max(1, Math.floor(C / (cd || C)));
    const uptime = Math.min((n * dur) / C, 1);
    if (W <= 0 || W >= C) return { n, cover: uptime, spill: 0, uptime };
    if (!aligned) return { n, cover: uptime, spill: uptime, uptime };
    // 精確重疊:每次觸發區間 [t, t+dur) 與爆發窗 [0, W) 的交集
    let inSec = 0;
    for (let t = 0; t < C; t += (cd || C)) inSec += Math.max(0, Math.min(t + dur, W) - t);
    const outSec = n * dur - inSec;
    return { n, cover: Math.min(inSec / W, 1), spill: Math.min(outSec / (C - W), 1), uptime };
  }

  return { BUILDS, detectBuild, parseFinalStat, sumStats, attributePower,
           combineIgnore, defenseFactor, deriveClear, simulate, power,
           simulateWeighted, skillCoverage, mergeDelta, CRIT_BASE };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Engine };
