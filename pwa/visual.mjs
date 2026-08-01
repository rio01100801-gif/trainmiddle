/**
 * 視覚確認・視覚回帰用のスクリーンショット取得。
 *
 * 目的が2つある。混同しないこと。
 *
 *   1. 忠実度（リファレンス画像にどれだけ近いか）
 *      → これは自動判定できない。リファレンスは端末ベゼル入り・解像度も縦横比も違う
 *        合成モックアップなので、実装スクショとピクセル比較しても意味のある差分にならない。
 *        ここで撮った画像を人が reference-ui/crops/*.jpeg と並べて見比べ、
 *        差分を言葉にして直す。
 *
 *   2. 回帰（前と比べて意図せず変わっていないか）
 *      → これは自動判定できる。visual/baseline/ と比較する（--check）。
 *
 * 決定的にするために、時刻・データ・アニメーションを固定する。
 * 固定しないと毎回違う絵が出て、どちらの目的にも使えない。
 *
 *   node pwa/visual.mjs                 # 既定の幅で撮る
 *   node pwa/visual.mjs --all-widths    # 390 / 393 / 430 で撮る
 *   node pwa/visual.mjs --only=today    # 一部だけ
 */
import http from "http";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { loadChromium, launchOptions, ROOT, DIST } from "./e2e-env.mjs";

const args = process.argv.slice(2);
const ALL_WIDTHS = args.includes("--all-widths");
const CHECK = args.includes("--check");
const UPDATE = args.includes("--update");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);

const OUT_DIR = path.join(ROOT, "visual", "current");
const BASE_DIR = path.join(ROOT, "visual", "baseline");
fs.mkdirSync(OUT_DIR, { recursive: true });

/*
 * 基準日。レース(2026-09-25)のちょうど41日前にしてある。
 * リファレンス画像が「レースまで 41日」なので、同じ条件で見比べられる。
 */
const FROZEN_NOW = "2026-08-15T09:41:00+09:00";
const RACE_DATE = "2026-09-25";
/*
 * プランの生成開始日。基準日よりかなり前から作る。
 * 理由が2つある。
 *  - 基準日と同じだと、カレンダーの表示範囲（週頭から）の前半がまるごと
 *    「予定なし」になり、画面の半分が空で比較にならない。
 *  - 分析のPERFORMANCEは「前の同じ長さの期間」と比べるので、
 *    MONTH（30日）の前期ぶんまで実績が無いと増減率が出ず、その表示を確認できない。
 */
const PLAN_START = "2026-06-01";

/**
 * 撮る画面。name はファイル名、hash は遷移先。
 * hash が関数のときは、シード後のデータからその場で組み立てる
 * （セッションIDのように、生成しないと決まらない遷移先があるため）。
 */
const SCREENS = [
  /*
   * スプラッシュはReactがマウントすると自分で消えるので、bundle.js を読ませずに撮る。
   * 起動時に出る値（レースまでの日数）は前回起動時に localStorage へ置かれたものを
   * 読むので、ここでも同じ形で入れておく。
   */
  { name: "splash", blockBundle: true, hash: "#/", waitMs: 4200 },
  { name: "today", hash: "#/" },
  { name: "calendar", hash: "#/calendar" },
  { name: "analytics", hash: "#/analysis" },
  { name: "results", hash: "#/results" },
  {
    name: "ai-menu",
    hash: async (page) => {
      const id = await page.evaluate(async (today) => {
        // 生成理由（REASON）が付くセッションを優先して選ぶ。
        // ジョグには理由が付かないので、それを撮ると REASON の表示を確認できない。
        const to = new Date(new Date(today).getTime() + 13 * 86400000)
          .toISOString()
          .slice(0, 10);
        const d = await fetch(`/api/sessions?from=${today}&to=${to}`).then((r) => r.json());
        const list = d.sessions ?? [];
        const withReason = list.find((s) => s.generation?.selectionReasons?.length);
        return (withReason ?? list[0])?.id;
      }, FROZEN_NOW.slice(0, 10));
      return id ? `#/session?id=${encodeURIComponent(id)}` : undefined;
    },
  },
  {
    name: "session-run",
    hash: async (page) => {
      // 設定タイムのあるセッション（＝1本ずつ入れる画面が出るもの）を選ぶ
      const id = await page.evaluate(async (today) => {
        const to = new Date(new Date(today).getTime() + 20 * 86400000)
          .toISOString()
          .slice(0, 10);
        const d = await fetch(`/api/sessions?from=${today}&to=${to}`).then((r) => r.json());
        return (d.sessions ?? []).find((s) => (s.targetPaces ?? []).length > 0)?.id;
      }, FROZEN_NOW.slice(0, 10));
      return id ? `#/run?sessionId=${encodeURIComponent(id)}` : undefined;
    },
  },
  {
    name: "summary",
    hash: async (page) => {
      // 本ごとのタイムが出るインターバルの記録を優先する
      const id = await page.evaluate(async () => {
        const rs = await fetch("/api/results").then((r) => r.json());
        const list = rs.results ?? [];
        const withReps = list.find((r) => (r.interval?.results ?? []).length > 0);
        return (withReps ?? list[0])?.sessionId;
      });
      return id ? `#/summary?sessionId=${encodeURIComponent(id)}` : undefined;
    },
  },
];

const WIDTHS = ALL_WIDTHS
  ? [
      { w: 390, h: 844 },
      { w: 393, h: 852 },
      { w: 430, h: 932 },
    ]
  : [{ w: 390, h: 844 }];

// ---------------------------------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8793, r));

const chromium = await loadChromium();
const browser = await chromium.launch(launchOptions());

/** 決定的なデータを流し込む。UI操作ではなくAPI直叩き（速いうえ、画面の変更に影響されない） */
async function seed(page) {
  const report = await page.evaluate(
    async ({ raceDate, startDate, today }) => {
      const post = async (url, body) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return r.json();
      };
      await post("/api/athlete", {
        name: "伊藤 吏央",
        heightCm: 171,
        weightKg: 64.5,
        skeletalMuscleKg: 32.5,
        pb400mSec: 49.0,
        pb800mSec: 109.51,
        pb1500mSec: 236.0,
        heatTolerance: "low",
        recoveryProfile: "normal",
      });
      await post("/api/goal", {
        goal: {
          targetEvent: "800m",
          targetTimeSec: 108.5,
          targetRaceId: "race-visual-1",
          subRaceIds: [],
        },
        races: [
          {
            id: "race-visual-1",
            name: "秋季選手権",
            dateStart: raceDate,
            priority: "A",
            rounds: [
              { type: "heat", datetime: `${raceDate}T10:00:00` },
              { type: "final", datetime: "2026-09-27T15:00:00" },
            ],
            peakTargetRound: "final",
          },
        ],
      });
      const plan = await post("/api/plan", { startDate });

      /*
       * 基準日より前のセッションに結果を入れる。
       * 実施済みが1件も無いと WEEKLY SUMMARY も分析のグラフも空のままで、
       * 見た目の確認ができない。処方どおりこなした体で機械的に埋める。
       */
      const from = startDate;
      const list = await fetch(`/api/sessions?from=${from}&to=${today}`).then((r) => r.json());
      let recorded = 0;
      for (const s of list.sessions ?? []) {
        if (s.date >= today || s.category === "off") continue;
        const durationMin = s.durationMin ?? 40;
        const distanceKm = s.distanceKm ?? 8;
        const tp = s.targetPaces?.[0];

        /*
         * 設定タイムがあるセッションは本ごとのタイムを入れる。
         * 全部を持続走で埋めると、記録サマリーの「本ごとのタイム」や
         * 同一処方比較のような、本数を前提にした表示を確認できない。
         * 設定の中央値から少しずつ落ちる形にして、最速が最終本にならないようにする。
         */
        const body =
          tp && s.category !== "aerobic"
            ? (() => {
                const reps = 4;
                const base = (tp.targetSecFast + tp.targetSecSlow) / 2;
                const times = [base + 0.3, base - 0.4, base + 0.1, base + 0.8].map(
                  (v) => Math.round(v * 10) / 10
                );
                return {
                  actualLapsSec: times,
                  lapDistancesM: times.map(() => tp.distanceM),
                  interval: {
                    reps,
                    distanceM: tp.distanceM,
                    restType: "jog",
                    restSec: 300,
                    results: times.map((actualSec, i) => ({
                      index: i,
                      distanceM: tp.distanceM,
                      targetSec: Math.round(base * 10) / 10,
                      actualSec,
                    })),
                  },
                };
              })()
            : {
                actualLapsSec: [Math.round(durationMin * 60)],
                continuous: {
                  distanceKm,
                  durationMin,
                  avgPaceSecPerKm: Math.round((durationMin * 60) / distanceKm),
                },
              };

        const r = await fetch("/api/results", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: `res-visual-${s.id}`,
            sessionId: s.id,
            date: s.date,
            ...body,
            achievement: "achieved",
            rpe: s.category === "aerobic" ? 3 : 8,
            subjective: s.category === "aerobic" ? "easy" : "hard",
            note: s.category === "aerobic" ? undefined : "調子良く、最後まで安定して走れた。",
          }),
        });
        if (r.ok) recorded++;
      }
      return { sessions: plan?.sessionCount ?? 0, recorded, error: plan?.error };
    },
    { raceDate: RACE_DATE, startDate: PLAN_START, today: FROZEN_NOW.slice(0, 10) }
  );
  // IndexedDBへの保存は250msデバウンスされている。読み直す前に落ち着かせる
  await page.waitForTimeout(600);
  return report;
}

let shots = 0;
for (const { w, h } of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    /*
     * Service Worker を動かさない。
     * 動いていると bundle.js がキャッシュから返り、`route(..., abort)` が
     * 効かない。スプラッシュを撮るつもりの1枚が、実際にはアプリ本体を
     * 撮っていた（baselineごと間違ったまま固定されていた）。
     */
    serviceWorkers: "block",
  });
  const page = await context.newPage();

  /*
   * 時刻を固定する。固定しないと「レースまでN日」が実行日ごとに変わる。
   *
   * context に入れるのは、スプラッシュを別ページで撮るため。
   * page だけに入れていたときは、そのページだけ実時刻で動いていて、
   * 「GOOD MORNING / GOOD EVENING」が撮った時間帯で変わっていた。
   */
  await context.addInitScript((iso) => {
    const fixed = new Date(iso).getTime();
    const Real = Date;
    class Frozen extends Real {
      constructor(...a) {
        // 引数なしの new Date() だけを固定する。日付計算はそのまま動かす
        super(...(a.length === 0 ? [fixed] : a));
      }
      static now() {
        return fixed;
      }
    }
    // eslint-disable-next-line no-global-assign
    Date = Frozen;
  }, FROZEN_NOW);

  await page.goto("http://localhost:8793/");
  await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 20000 });

  const seeded = await seed(page);
  if (seeded.sessions === 0) {
    throw new Error(`シードでセッションが生成されなかった: ${seeded.error ?? "理由不明"}`);
  }

  for (const s of SCREENS) {
    if (ONLY && s.name !== ONLY) continue;

    if (s.blockBundle) {
      const sp = await context.newPage();
      await sp.route("**/bundle.js", (route) => route.abort());
      await sp.addInitScript(
        (v) => localStorage.setItem("forge:splash", v),
        JSON.stringify({ raceDate: RACE_DATE, gapText: "目標 1:48.50 まで −5.7秒" })
      );
      await sp.goto(`http://localhost:8793/${s.hash}`);
      await sp.waitForTimeout(s.waitMs ?? 4200);
      /*
       * 「アプリを準備しています」は無限に点滅する。止めないと撮るたびに
       * 不透明度が変わり、毎回違うPNGになって回帰判定に使えない。
       * ここで全アニメーションを止めると、入場アニメ（forwards で
       * 最終状態を保持している）まで初期状態に戻ってしまうので、
       * 点滅している要素だけを止める。
       */
      await sp.addStyleTag({
        content: "#splash .wait{animation:none!important;opacity:.7!important}",
      });
      await sp.waitForTimeout(80);
      const file = path.join(OUT_DIR, `${s.name}-${w}.png`);
      await sp.screenshot({ path: file });
      await sp.close();
      shots++;
      console.log(`  ${path.relative(ROOT, file)}`);
      continue;
    }

    const hash = typeof s.hash === "function" ? await s.hash(page) : s.hash;
    if (!hash) {
      console.log(`  (${s.name}: 遷移先を決められないので飛ばした)`);
      continue;
    }
    // 同じハッシュへのgotoは再読み込みにならないので、一度別画面を経由する
    await page.goto("http://localhost:8793/#/__reset");
    await page.waitForTimeout(120);
    await page.goto(`http://localhost:8793/${hash}`);
    await page.waitForTimeout(1100);
    await page.addStyleTag({
      content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
    });
    await page.waitForTimeout(120);
    const file = path.join(OUT_DIR, `${s.name}-${w}.png`);
    await page.screenshot({ path: file });
    shots++;
    console.log(`  ${path.relative(ROOT, file)}`);
  }
  console.log(`  （生成 ${seeded.sessions}件 / 実施記録 ${seeded.recorded}件）`);
  await context.close();
}

await browser.close();
server.close();
console.log(`\n${shots}枚を visual/current/ に保存しました（基準日 ${FROZEN_NOW.slice(0, 10)}）`);

/*
 * 回帰の判定。
 *
 * 時刻・データ・アニメーションを固定してあるので、同じ実装からは
 * バイト単位で同じPNGが出る（実測済み）。だからハッシュ比較で足りる。
 * pixelmatch のような画像差分ライブラリを足していないのはこのため——
 * 「どこが変わったか」は current と baseline を並べて目で見るほうが速い。
 *
 * これは「前と変わっていないか」の判定であって、
 * 「リファレンス画像に近いか」の判定ではない（後者は自動化できない）。
 */
const digest = (p) => crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");

if (UPDATE) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    fs.copyFileSync(path.join(OUT_DIR, f), path.join(BASE_DIR, f));
    n++;
  }
  console.log(`baseline を ${n}枚 更新しました`);
} else if (CHECK) {
  const captured = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".png"));
  const changed = [];
  const added = [];
  for (const f of captured) {
    const base = path.join(BASE_DIR, f);
    if (!fs.existsSync(base)) {
      added.push(f);
      continue;
    }
    if (digest(path.join(OUT_DIR, f)) !== digest(base)) changed.push(f);
  }
  if (added.length) console.log(`\nbaseline に無い画面: ${added.join(", ")}`);
  if (changed.length) {
    console.error(`\n見た目が変わった画面（${changed.length}件）:`);
    for (const f of changed) console.error(`  ${f}`);
    console.error(
      "\nvisual/current/ と visual/baseline/ を並べて確認してください。" +
        "\n意図した変更なら: npm run visual:update"
    );
    process.exit(1);
  }
  console.log("baseline と一致しました（見た目の回帰なし）");
}
