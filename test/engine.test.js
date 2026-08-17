/**
 * 計算引擎單元測試
 *   執行:node test/engine.test.js
 * 不需要任何套件,直接載入 js/engine.js。
 */
const { Engine } = require("../js/engine.js");

let pass = 0, fail = 0;
const ck = (name, got, want, eps = 1e-9) => {
  if (Math.abs(got - want) < eps) pass++;
  else { fail++; console.log(`  ✗ ${name}\n      got ${got}\n      want ${want}`); }
};
const section = (s) => console.log(`\n── ${s} ──`);

/* ---------- 職業判定 ---------- */
section("職業判定");
for (const [cls, want] of [
  ["龍魔導士", "int"], ["夜光", "int"], ["影武者", "luk2"], ["夜使者", "luk"],
  ["傑諾", "xenon"], ["惡魔復仇者", "hp"], ["英雄(雙手武器)", "str"], ["新職業XYZ", "str"],
]) ck(`detectBuild(${cls})`, Engine.detectBuild(cls) === want ? 1 : 0, 1);

/* ---------- final_stat 解析 ---------- */
section("final_stat 解析");
const m = Engine.parseFinalStat([
  { stat_name: "傷害", stat_value: "118.00" },
  { stat_name: "HP", stat_value: "51,434" },
  { stat_name: "壞值", stat_value: "abc" },
]);
ck("百分比", m["傷害"], 118);
ck("千分位", m["HP"], 51434);
ck("無效值忽略", m["壞值"] === undefined ? 1 : 0, 1);

/* ---------- 屬性戰力 ---------- */
section("屬性戰力");
ck("一般 4×主+副", Engine.attributePower(1000, 500, "str"), 4500);
ck("傑諾同一般式", Engine.attributePower(1000, 0, "xenon"), 4000);
ck("惡復 HP 折算", Engine.attributePower(35000, 4000, "hp"), 0.8 * 35000 / 3.5 + 4000);

/* ---------- 裸值反推 ---------- */
section("裸值反推");
ck("deriveClear", Engine.deriveClear(70000, 0.9, 13000), 30000);
ck("反推↔建構互逆", Engine.deriveClear(30000 * 1.9 + 13000, 0.9, 13000), 30000);
ck("不為負", Engine.deriveClear(100, 0.5, 500), 0);

/* ---------- 無視防禦 ---------- */
section("無視防禦");
ck("乘算疊加", Engine.combineIgnore(0.9, 0.5), 1 - 0.1 * 0.5);
ck("反向移除", Engine.combineIgnore(0.9, -0.2), 1 - 0.1 / 0.8);
ck("上限 1", Engine.combineIgnore(0.999, 0.999) <= 1 ? 1 : 0, 1);
ck("防禦係數", Engine.defenseFactor(0.9, 3), 1 - 3 * 0.1);

/* ---------- 主測試基準(以實際角色面板為準) ---------- */
const base = {
  build: "int",
  mainFinal: 105946, mainPct: 7.13, mainUnique: 40390,
  minorFinal: 12569, minorPct: 1.35, minorUnique: 560,
  attack: 20965, attackPct: 1.87,
  dmg: 0.84, boss: 6.25, crit: 1.5035, fd: 1.4636,
  ignore: 0.982, bossPdr: 3,
};

section("各乘區");
ck("無變化 = 1", Engine.simulate(base, {}).total, 1, 1e-12);
ck("傷害", Engine.simulate(base, { dmg: 0.1 }).factors.dmgBoss, (1 + 0.84 + 0.1 + 6.25) / (1 + 0.84 + 6.25));
ck("BOSS 同乘區", Engine.simulate(base, { boss: 0.1 }).factors.dmgBoss, (1 + 0.84 + 6.25 + 0.1) / (1 + 0.84 + 6.25));
ck("爆傷(基底1.35)", Engine.simulate(base, { crit: 0.08 }).factors.crit, (1.35 + 1.5035 + 0.08) / (1.35 + 1.5035));
ck("終傷互乘逆推", Engine.simulate(base, { fdFrom: 0.4, fdTo: 0.6 }).factors.finalDmg, 1.6 / 1.4);
ck("無視對300%防禦", Engine.simulate(base, { ignore: 0.1 }).factors.ignore,
   Engine.defenseFactor(Engine.combineIgnore(0.982, 0.1), 3) / Engine.defenseFactor(0.982, 3));

section("攻擊力(面板含攻擊%,flat 須吃%)");
{
  const clear = 20965 / (1 + 1.87);
  const r = Engine.simulate(base, { attackFlat: 10 });
  ck("裸攻比值", r.factors.attackFlat, (clear + 10) / clear);
  ck("面板增加 = 10×(1+187%)", (r.factors.attackFlat - 1) * 20965, 10 * 2.87, 1e-6);
  ck("攻擊%", Engine.simulate(base, { attackPct: 0.12 }).factors.attackPct, (1 + 1.87 + 0.12) / (1 + 1.87));
}

section("屬性:吃% vs 不吃%");
{
  const clear = Engine.deriveClear(105946, 7.13, 40390);
  const ap = 4 * 105946 + 12569;
  const a = Engine.simulate(base, { mainFlat: 1000 }).factors.attribute;
  const b = Engine.simulate(base, { mainUnique: 1000 }).factors.attribute;
  ck("吃% 增量 = 1000×(1+713%)", (a - 1) * ap / 4, 1000 * (1 + 7.13), 1e-6);
  ck("不吃% 增量 = 1000", (b - 1) * ap / 4, 1000, 1e-6);
  ck("吃%效益較高", a > b ? 1 : 0, 1);
  ck("裸值合理", clear > 7000 && clear < 9000 ? 1 : 0, 1);
}

section("乘區獨立性");
{
  const d = { dmg: 0.1, crit: 0.08, attackFlat: 100, mainFlat: 500, ignore: 0.1, fdFrom: 0.4, fdTo: 0.6 };
  const r = Engine.simulate(base, d);
  ck("各乘區乘積 = total", r.total, Object.values(r.factors).reduce((x, y) => x * y, 1));
}

/* ---------- 兩段加權(q = 傷害占比)---------- */
section("爆發期兩段加權");
{
  const q = 0.5;
  const c = base.attack / (1 + base.attackPct), nA = base.attackPct + 0.85;
  const burst = { ...base, attackPct: nA, attack: c * (1 + nA), dmg: base.dmg + 0.65 };

  ck("無變化 = 1", Engine.simulateWeighted(base, burst, {}, q).total, 1, 1e-12);
  ck("q=0 退化為平時", Engine.simulateWeighted(base, burst, { boss: 0.3 }, 0).total,
     Engine.simulate(base, { boss: 0.3 }).total);
  ck("q=1 退化為爆發", Engine.simulateWeighted(base, burst, { boss: 0.3 }, 1).total,
     Engine.simulate(burst, { boss: 0.3 }).total);

  const rn = Engine.simulate(base, { boss: 0.3 }).total, rb = Engine.simulate(burst, { boss: 0.3 }).total;
  ck("加權 = q·r爆 + (1−q)·r平", Engine.simulateWeighted(base, burst, { boss: 0.3 }, q).total,
     q * rb + (1 - q) * rn);
  // 線性:對 q 的一階函數
  ck("對 q 線性", Engine.simulateWeighted(base, burst, { boss: 0.3 }, 0.25).total,
     0.25 * rb + 0.75 * rn);

  // 僅作用於爆發期的額外變化量
  ck("burstExtra 空值", Engine.simulateWeighted(base, burst, {}, q, {}).total, 1, 1e-12);
  const be = Engine.simulateWeighted(base, burst, {}, q, { dmg: 0.1 }).total;
  const bc = Engine.simulateWeighted(base, burst, { dmg: 0.1 }, q).total;
  ck("僅爆發期效益 < 常駐", be < bc ? 1 : 0, 1);

  // R 僅供顯示,不參與加權
  ck("R = 各乘區乘積", Engine.power(burst) / Engine.power(base),
     ((1 + nA) / (1 + 1.87)) * ((1 + 0.84 + 0.65 + 6.25) / (1 + 0.84 + 6.25)));
}

/* ---------- 爆發技能覆蓋率 ---------- */
section("爆發技能覆蓋率(週期 120s / 爆發窗 20s)");
{
  const C = 120, W = 20;
  const cov = (d, cd, al = true) => Engine.skillCoverage(d, cd, W, C, al);

  // 規範戒指:CD 120 → 每輪 1 次,持續 20s 完全落在窗內
  let c = cov(20, 120);
  ck("規範Lv6 次數", c.n, 1); ck("規範Lv6 窗內", c.cover, 1); ck("規範Lv6 平砍", c.spill, 0);
  c = cov(15, 120);
  ck("規範Lv4 窗內 15/20", c.cover, 0.75); ck("規範Lv4 無溢出", c.spill, 0);

  // 靈魂鬥志:持續 40s > 窗 20s → 窗內滿額,多出 20s 落在平砍
  c = cov(40, 120);
  ck("魂武 窗內滿額", c.cover, 1);
  ck("魂武 平砍 20/100", c.spill, 20 / 100);
  ck("魂武 uptime 40/120", c.uptime, 40 / 120);

  // 靈魂契約:CD 60 → 每輪 2 次,第 2 次整段在平砍期
  c = cov(15, 60);
  ck("靈魂契約 次數", c.n, 2);
  ck("靈魂契約 窗內 15/20", c.cover, 0.75);
  ck("靈魂契約 平砍 15/100", c.spill, 15 / 100);

  // 一擊必殺對軸:CD 30 → 每輪 4 次,1 次在窗內、3 次在平砍
  c = cov(4, 30);
  ck("一擊必殺 次數", c.n, 4);
  ck("對軸 窗內 4/20", c.cover, 0.2);
  ck("對軸 平砍 12/100", c.spill, 12 / 100);

  // 不對軸:均勻分布,窗內外皆等於總 uptime
  c = cov(4, 30, false);
  ck("不對軸 窗內 = uptime", c.cover, 16 / 120);
  ck("不對軸 平砍 = uptime", c.spill, 16 / 120);

  // 轉折點:窗 > 30s 第 2 次開始進入(部分重疊須精確計算)
  ck("窗30s 仍 1 次", Engine.skillCoverage(4, 30, 30, C).cover * 30, 4);
  ck("窗32s 部分重疊", Engine.skillCoverage(4, 30, 32, C).cover * 32, 6);
  ck("窗34s 完整 2 次", Engine.skillCoverage(4, 30, 34, C).cover * 34, 8);

  // 時間守恆:窗內秒數 + 平砍秒數 = 總觸發秒數
  for (const [d, cd] of [[20, 120], [40, 120], [15, 60], [4, 30]]) {
    const x = Engine.skillCoverage(d, cd, W, C);
    ck(`守恆 ${d}s/${cd}s`, x.cover * W + x.spill * (C - W), x.n * d, 1e-9);
  }
}

section("mergeDelta");
ck("數值相加", Engine.mergeDelta({ boss: 0.1 }, { boss: 0.2 }).boss, 0.3);
ck("無視乘算", Engine.mergeDelta({ ignore: 0.1 }, { ignore: 0.2 }).ignore, 1 - 0.9 * 0.8);
ck("終傷覆寫", Engine.mergeDelta({ fdTo: 0.5 }, { fdTo: 0.6 }).fdTo, 0.6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
