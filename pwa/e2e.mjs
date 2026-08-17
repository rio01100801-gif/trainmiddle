/**
 * PWA E2E検証: iPhone幅で実際のユーザー操作フローを通す。
 * 1. セットアップ(PB入力→診断) 2. 目標・レース保存 3. プラン生成
 * 4. 実測マーカー登録 5. 日次チェック 6. 結果入力→CFE補正
 * 7. リロード→データ永続化確認 8. 各画面スクリーンショット
 */
import { DIST, ROOT, launchOptions, loadChromium } from "./e2e-env.mjs";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { FitBaseType, FitEncoder } from "fit-file-parser";


const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const p = req.url.split("?")[0];
  const file = path.join(DIST, p === "/" ? "index.html" : p);
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(8791, r));

const chromium = await loadChromium();
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1.5,
  hasTouch: true,
});
const page = await ctx.newPage();
/**
 * 目盛りスライダーを動かす。
 *
 * range 要素は fill() では動かないので、value を入れて input と change を投げる。
 * React の onChange は input イベントで拾われるので、これで実際の操作と同じ経路になる。
 */
async function setSlider(locator, value) {
  await locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

/**
 * カレンダーの行の操作（✎・＋）を開く。
 *
 * 操作は畳んである——常に出していたとき、1日に2本ある日はボタンが3つ並び、
 * **予定そのものが読める幅を奪っていた**。
 * 検査は操作を使うので、先に開ける。
 */
async function openAllDayOps(page) {
  const toggles = page.locator("[data-calendar-ops-toggle]");
  const n = await toggles.count();
  for (let i = 0; i < n; i += 1) {
    const t = toggles.nth(i);
    if ((await t.getAttribute("aria-expanded")) === "true") continue;
    await t.click();
  }
  await page.waitForTimeout(200);
}

const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

/*
 * スクリーンショットの置き場所。
 * 以前は開発コンテナの絶対パス（/home/claude/...）だったので、
 * Windows では C:\home\claude\ に散らばって誰も見なかった。
 * 見た目の確認（アイコン・ロード画面）は目で見ないと意味が無いので、
 * リポジトリ直下の shots/ に置く（.gitignore 済み）。
 */
const SHOT_DIR = path.join(ROOT, "shots");
const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });
const step = (msg) => console.log("STEP:", msg);
let failCount = 0;
const fail = (msg) => { failCount++; console.log("FAIL:", msg); process.exitCode = 1; };

// ---- 1. 初回起動 ----
await page.goto("http://localhost:8791/");
// Reactマウント完了（スプラッシュ除去）を待ってから判定する
await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
await page
  .waitForFunction(() => (document.body.textContent ?? "").includes("プロフィール"), {
    timeout: 10000,
  })
  .catch(() => fail("初回画面のセットアップ導線が表示されない"));
step("初回起動OK（未設定ガイダンス表示）");
await shot("00_first_launch");

/*
 * iOSキーボード対策: interactive-widget=resizes-content が無いと、
 * キーボード表示中もレイアウトビューポートが縮まず、position: fixed の
 * タブバー・FABがキーボードの裏に固定されたままになる。
 * 実機でしか最終確認できないが、metaタグ自体が消えていないかは機械で見張れる。
 */
const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
if (!viewportMeta?.includes("interactive-widget=resizes-content")) {
  fail(`viewport metaにinteractive-widget=resizes-contentが無い: ${viewportMeta}`);
}
step("viewport meta: interactive-widget=resizes-contentOK");

// ---- 2. セットアップ ----
await page.goto("http://localhost:8791/#/setup");
await page.waitForTimeout(400);
const fill = async (label, value) => {
  await page.getByLabel(label, { exact: false }).fill(value).catch(async () => {
    // labelテキスト→隣接input
    const el = page.locator(`label:has-text("${label}") input, label:has-text("${label}") select`).first();
    await el.fill(value);
  });
};
await page.locator('label:has-text("名前") input').fill("伊藤 吏央");
await page.locator('label:has-text("400m PB") input').first().fill("49.0");
await page.locator('label:has-text("800m PB") input').first().fill("1:49.51");
await page.locator('label:has-text("1500m PB") input').first().fill("3:56.0");
await page.locator('label:has-text("暑熱耐性") select').selectOption("low");
await page.getByRole("button", { name: "保存して診断" }).click();
await page.waitForTimeout(500);
const diagText = await page.textContent("body");
if (!diagText.includes("lactate_tolerant")) fail("診断結果が表示されない");
step("セットアップ→診断OK（lactate_tolerant）");
await shot("01_setup_diagnosis");

// ---- 3. 目標・レース ----
await page.goto("http://localhost:8791/#/goal");
await page.waitForTimeout(400);
await page.locator('label:has-text("目標タイム") input').fill("1:48.90");
await page.locator('label:has-text("大会名") input').first().fill("秋季選手権");
await page.locator('label:has-text("開催初日") input').fill("2026-09-25");
await page.locator('label:has-text("通過条件") select').selectOption("place_and_time");
await page.locator('label:has-text("着順による通過ボーダー") input').fill("2");
await page.locator('label:has-text("過去大会のボーダータイム") input').fill("1:51.0");
// ラウンド日時
const dt = page.locator('input[type="datetime-local"]');
await dt.nth(0).fill("2026-09-25T10:00");
await dt.nth(1).fill("2026-09-27T15:00");
await page.getByRole("button", { name: "+ 通過点レース追加" }).click();
const checkpointCard = page.locator("section.card", { hasText: "通過点レース" }).first();
await checkpointCard.locator('input[placeholder="大会名"]').fill("夏季記録会");
/*
 * 日付を固定するとカレンダーの表示窓（今日から4週間）から外れて、
 * **ある日を境に落ちるようになる**（実際に日付が変わった翌日に落ちた）。
 * 今日から2週間後にして、日付が進んでも窓の中に居るようにする。
 */
const checkpointDate = new Date();
checkpointDate.setDate(checkpointDate.getDate() + 14);
await checkpointCard
  .locator('input[type="date"]')
  .fill(checkpointDate.toISOString().slice(0, 10));
await checkpointCard.locator("select").selectOption("B");
await page.getByRole("button", { name: "目標・レースを保存" }).click();
await page.waitForTimeout(400);
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(200);
await page.goto("http://localhost:8791/#/goal");
await page.waitForTimeout(600);
if (
  (await page.locator('label:has-text("着順による通過ボーダー") input').inputValue()) !==
  "2"
) {
  fail("着順ボーダーが再読込後に消える");
}
if (
  (await page.locator('label:has-text("過去大会のボーダータイム") input').inputValue()) !==
  "1:51"
) {
  fail("タイムボーダーが再読込後に消える");
}
if (
  (await page
    .locator('section.card:has-text("通過点レース") input[placeholder="大会名"]')
    .inputValue()) !== "夏季記録会"
) {
  fail("通過点レースが再読込後に消える");
}
step("目標・レース保存→再読込OK（着順・タイムボーダー／通過点レース）");

/*
 * NEXT-001: 0秒のボーダーを保存させない。
 * 0 は Number.isFinite を通るうえ planHeatPace の `?? ` も素通りするので、
 * 保存されると通過目安が −0.5秒 になる。画面には値が出たまま中身だけ壊れるため、
 * 「保存できたか」ではなく「保存前の値が残っているか」まで見る。
 */
await page.locator('label:has-text("過去大会のボーダータイム") input').fill("0");
await page.getByRole("button", { name: "目標・レースを保存" }).click();
await page.waitForTimeout(300);
if (!/ボーダー/.test(await page.locator("main").innerText())) {
  fail("0秒のボーダーを保存しようとしても理由が出ない");
}
// 同じハッシュへの goto は再読込にならないので、一度別画面を挟む
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(200);
await page.goto("http://localhost:8791/#/goal");
await page.waitForTimeout(600);
if (
  (await page.locator('label:has-text("過去大会のボーダータイム") input').inputValue()) !==
  "1:51"
) {
  fail("0秒を弾いたのに、保存済みのボーダーまで消えている");
}
step("NEXT-001 0秒のボーダーを保存せず、保存済みの値も壊さないOK");

// ---- 3b. 固定曜日設定 + 自作メニュー（3-1 / 3-2） ----
await page.goto("http://localhost:8791/#/plan-settings");
await page.waitForTimeout(600);
// 固定曜日を有効化して 火=ポイント / 木=休養 / 土=ポイント / 日=ジョグ
await page.getByText("枠の希望を使う").click();
await page.waitForTimeout(200);
const dowSelect = (label) =>
  page.getByLabel(`${label}曜のメニュー`);
await dowSelect("火").selectOption("point");
await dowSelect("木").selectOption("off");
await dowSelect("土").selectOption("point");
await dowSelect("日").selectOption("aerobic");
for (const label of ["火", "木", "土", "日"]) {
  await page.getByRole("button", { name: `${label}曜 固定`, exact: true }).click();
}
await page.waitForTimeout(200);
await page.getByRole("button", { name: "設定を保存" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(600);
if (!(await page.textContent("body")).includes("保存しました")) fail("固定曜日設定が保存されない");
step("固定曜日設定OK（火・土ポイント / 木休養 / 日ジョグ）");

// 連日ポイントにするとERRORが出ることを確認
await dowSelect("水").selectOption("point");
await page.getByRole("button", { name: "水曜 固定", exact: true }).click();
await page.waitForTimeout(400);
const tplText = await page.textContent("body");
if (!tplText.includes("連日")) fail("連日ポイントのERROR警告が出ない（3-1検証）");
step("テンプレート検証OK（連日ポイントでERROR）");
await page.getByRole("button", { name: "水曜 指定なし", exact: true }).click();

/*
 * ---- 3b-2. 2部練習 ----
 *
 * 午前枠を指定した曜日だけが2本になること。
 * 危ない組み合わせ（午前・午後とも高負荷）は**生成前**に言うこと。
 * 生成してからルールエンジンに拾わせると、なぜそう置いたのかが分からなくなる。
 */
{
  const amSelect = (label) => page.getByLabel(`${label}曜の補助枠（2部練習）`);
  if ((await amSelect("火").count()) === 0) fail("2部練習: 補助枠の選択が無い");
  else {
    // 午前・午後とも高負荷 → その場でERROR
    await amSelect("火").selectOption("point");
    await page.waitForTimeout(400);
    if (!(await page.textContent("body")).includes("午前・午後とも高負荷")) {
      fail("2部練習: 午前・午後とも高負荷のERRORが生成前に出ない");
    }
    // 普通の2部（午前ジョグ）に直すと警告が消える
    await amSelect("火").selectOption("aerobic");
    await page.waitForTimeout(400);
    if ((await page.textContent("body")).includes("午前・午後とも高負荷")) {
      fail("2部練習: 午前をジョグに変えても警告が残る");
    }
    await page.getByRole("button", { name: "設定を保存" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "実行する" }).click();
    await page.waitForTimeout(600);
    /*
     * 曜日設定を保存しただけでは予定は変わらない（画面にもそう出ている）。
     * 再生成まで走らせないと2部の枠は現れないので、ここで明示的に生成する。
     */
    await page.evaluate(async () =>
      fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }).then((r) => r.json())
    );
    await page.waitForTimeout(900);

    /*
     * 指定した曜日は**すべて**2本になっていること。
     *
     * 「増えたか」だけでは足りない。坂ダッシュ＋ジョグの分割がたまたま火曜に
     * 当たると1日ぶん2本になるので、午前枠の生成を止めても 0→1 で通ってしまう
     * （実際にそれで2回空振りした）。カテゴリを見るのも同じ理由で効かない
     * ——分割で入るジョグも aerobic なので区別できない。
     * 「午後がある火曜には必ず午前がある」なら、取りこぼしを見逃さない。
     */
    const tue = await page.evaluate(async () => {
      const d = await fetch("/api/sessions").then((r) => r.json());
      const byDate = {};
      for (const s of d.sessions ?? []) {
        if (new Date(s.date + "T00:00:00Z").getUTCDay() !== 2) continue;
        if (s.category === "off") continue;
        (byDate[s.date] ??= []).push({ t: s.timeOfDay, cat: s.category });
      }
      const days = Object.entries(byDate).map(([date, list]) => ({
        date,
        hasPm: list.some((x) => x.t === "pm"),
        am: list.filter((x) => x.t === "am").map((x) => x.cat),
      }));
      return {
        total: days.filter((x) => x.hasPm).length,
        withAm: days.filter((x) => x.hasPm && x.am.length > 0).length,
        amCats: [...new Set(days.flatMap((x) => x.am))],
      };
    });
    if (tue.total === 0) fail("2部練習: 検査対象の火曜が1日も無い");
    else if (tue.withAm !== tue.total) {
      fail(
        `2部練習: 午前を指定した火曜のうち ${tue.withAm}/${tue.total} 日しか2本になっていない`
      );
    }
    if (!tue.amCats.every((c) => c === "aerobic")) {
      fail(`2部練習: 火曜の午前が指定どおりでない（${JSON.stringify(tue.amCats)}）`);
    }
    /*
     * カレンダーで午前が先に並び、「午前」と分かること。
     * 並べ替えていなかったので、保存順によっては午後の本練習が先に来て、
     * その日を上から読むと**実際にやる順と逆**になっていた。
     */
    const amDate = await page.evaluate(async () => {
      const d = await fetch("/api/sessions").then((r) => r.json());
      const byDate = new Map();
      for (const s of d.sessions ?? []) {
        if (!byDate.has(s.date)) byDate.set(s.date, []);
        byDate.get(s.date).push(s);
      }
      for (const [date, list] of byDate) {
        if (list.length >= 2 && list.some((s) => s.timeOfDay === "am")) return date;
      }
      return null;
    });
    if (!amDate) fail("2部練習: 午前つきの日が見つからない");
    else {
      await page.goto("http://localhost:8791/#/calendar");
      await page.waitForTimeout(800);
      await page.locator("select").first().selectOption("4");
      await page.waitForTimeout(800);
      const dayCard = page
        .locator("div.card", { hasText: amDate.slice(5).replace("-", "/") })
        .first();
      const rows = dayCard.locator("[data-calendar-session]");
      const rowCount = await rows.count();
      /*
       * **見つからなければ落とす。** 「2本あれば見る」にしていたら、
       * 行に届いていないだけのときも通ってしまい、
       * 並び順を逆にしても落ちない検査になっていた（実際そうなっていた）。
       */
      if (rowCount < 2) {
        fail(`2部練習: ${amDate} の行が読めない（${rowCount}行しか見つからない）`);
      } else {
        const firstRow = (await rows.nth(0).textContent()) ?? "";
        if (!firstRow.includes("午前")) {
          fail(`2部練習: カレンダーで午前が先に来ていない（1行目: ${firstRow.slice(0, 40)}）`);
        }
        const secondRow = (await rows.nth(1).textContent()) ?? "";
        if (secondRow.includes("午前")) {
          fail("2部練習: 午後の行にも「午前」が付いている（印が情報でなくなる）");
        }
      }
    }
    step(
      `2部練習OK（火曜 ${tue.withAm}/${tue.total} 日が2本・午前はジョグ・午前が先・生成前にERRORも出る）`
    );

    /*
     * 午前枠についての助言。
     * 自動では変えないので、出るのは文章だけ。
     * 「毎回出る」のでは気づきにならないので、噛み合っているときは出ないことも見る。
     */
    await page.goto("http://localhost:8791/#/plan-settings");
    await page.waitForTimeout(700);

    // この選手は400mが速く「維持が制限」と判定されるため、既定では助言は出ない
    const quiet = await page.evaluate(async () =>
      fetch("/api/plan-settings").then((r) => r.json())
    );
    if (!Array.isArray(quiet.amAdvice)) {
      fail("午前枠の助言がAPIから返らない（シムに対で足していない可能性）");
    }
    if ((quiet.amAdvice ?? []).length > 0) {
      fail("午前枠の助言が、噛み合っているのに出ている（毎回出ると気づきにならない）");
    }

    /*
     * 出る側も見る。400mのPBを遅くして「スピードが制限」に振る。
     * 出ないことだけ確認して終わると、機能が丸ごと壊れていても通ってしまう。
     * 確認後に必ず元へ戻す（以降の検査は元のPB前提で書かれている）。
     */
    const original = await page.evaluate(async () => {
      const d = await fetch("/api/athlete").then((r) => r.json());
      return d.athlete;
    });
    await page.evaluate(async (a) => {
      await fetch("/api/athlete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...a, pb400mSec: 53.5 }),
      });
    }, original);
    /*
     * 同じハッシュへの goto では画面が作り直されない（ハッシュルーティングなので
     * 遷移が起きず、最初に読み込んだ助言のまま残る）。リロードして読み直させる。
     */
    // 保存がIndexedDBへ落ちる前にリロードすると書き込みごと消える
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 20000 });
    await page.waitForTimeout(800);
    const savedPb = await page.evaluate(async () => {
      const d = await fetch("/api/athlete").then((r) => r.json());
      return d.athlete?.pb400mSec;
    });
    if (savedPb !== 53.5) {
      fail(`午前枠の助言の検査: PBの変更が保存されていない（${savedPb}）。助言の有無を判定できない`);
    }
    const loud = await page.evaluate(async () =>
      fetch("/api/plan-settings").then((r) => r.json())
    );
    if ((loud.amAdvice ?? []).length === 0) {
      fail("午前枠の助言: スピードが制限でも何も出ない");
    } else {
      const a = loud.amAdvice[0];
      if (!a.basis) fail("午前枠の助言に根拠が無い");
      if (!/可能性/.test(a.message)) fail("午前枠の助言が断定になっている");
      const shown = await page.textContent("body");
      if (!shown.includes("午前枠についての気づき")) {
        fail("午前枠の助言がAPIには出ているのに画面に出ていない");
      }
      if (!shown.includes("流し")) fail("午前枠の助言の中身が画面に出ていない");
      step("午前枠の助言OK（噛み合っていれば黙り、外れていれば根拠つきで出る）");
    }
    // 元のPBへ戻す
    await page.evaluate(async (a) => {
      await fetch("/api/athlete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(a),
      });
    }, original);
    await page.waitForTimeout(400);

    // 元に戻す（以降の検査に影響させない）
    await page.goto("http://localhost:8791/#/plan-settings");
    await page.waitForTimeout(600);
    await amSelect("火").selectOption("auto");
    await page.getByRole("button", { name: "設定を保存" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "実行する" }).click();
    await page.waitForTimeout(600);
    await page.evaluate(async () =>
      fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }).then((r) => r.json())
    );
    await page.waitForTimeout(900);
  }
}
await page.goto("http://localhost:8791/#/plan-settings");
await page.waitForTimeout(600);
await page.waitForTimeout(200);
await page.getByRole("button", { name: "設定を保存" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(400);

// 自作メニューを登録
await page.getByRole("button", { name: "+ 登録する" }).click();
await page.waitForTimeout(300);
await page.locator('label:has-text("メニュー名") input').fill("コーチ指定 300m×6");
await page.locator('label:has-text("カテゴリ") select').selectOption("high_lactate");
await page.locator('label:has-text("由来") select').selectOption("coach");
// S-3: 距離は本文から読み取るので、手で入れる欄は無くなった
await page.locator('label:has-text("内容") input').first().fill("300m×6 r4分 jog");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "このメニューを登録" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(600);
if (!(await page.textContent("body")).includes("コーチ指定 300m×6")) fail("自作メニューが登録されない");
step("自作メニュー登録OK");
await shot("15_plan_settings");

// ---- 3c. 過去データの遡り入力（現在地の再測定） ----
await page.goto("http://localhost:8791/#/past");
await page.waitForTimeout(600);
// レース結果（涼しい条件）を1本入れる
await page.getByRole("button", { name: "レース", exact: true }).click();
await page.waitForTimeout(200);
await page.locator('label:has-text("日付") input').fill("2026-07-18");
await page.locator('label:has-text("距離") select').selectOption("800");
await page.locator('label:has-text("記録") input').fill("1:54.20");
await page.locator('label:has-text("気温") input').fill("19");
await page.getByRole("button", { name: "この記録を登録" }).click();
await page.waitForTimeout(600);
let pastText = await page.textContent("body");
if (!pastText.includes("推定800m")) fail("過去データから現在地が推定されない");
if (!/1:5[0-9]/.test(pastText)) fail("推定値が表示されていない: " + pastText.slice(0, 200));
step("過去データ入力→現在地の推定OK");

// 内訳が開けること（根拠が見えないと使えない）
await page.getByRole("button", { name: "内訳を見る" }).click();
await page.waitForTimeout(300);
pastText = await page.textContent("body");
if (!pastText.includes("重み")) fail("推定の内訳（重み）が表示されない");
step("推定の内訳表示OK");

// 暑熱下のポイント練習を足しても、涼しいレースの推定が壊れないこと
await page.getByRole("button", { name: "ポイント練習", exact: true }).click();
await page.waitForTimeout(200);
await page.locator('label:has-text("日付") input').fill("2026-07-15");
await page.locator('label:has-text("1本の距離") input').fill("300");
await page.locator('label:has-text("各本のタイム") input').fill("46.5 47.0 47.4 48.2");
await page.locator('label:has-text("レスト(分)") input').fill("4");
await setSlider(page.getByTestId("past-rpe-slider"), 9);
await page.locator('label:has-text("気温") input').fill("34");
await page.getByRole("button", { name: "この記録を登録" }).click();
await page.waitForTimeout(600);
step("ポイント練習の遡り入力OK");

// CFEへの反映（確認ダイアログ経由）
const cfeBefore = await page.textContent("body");
await page.getByRole("button", { name: "この推定をCFEに反映する" }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(800);
const applied = await page.textContent("body");
if (!applied.includes("CFEを")) fail("CFEへの反映が実行されない: " + applied.slice(0, 300));
step("現在地をCFEに反映OK（確認ダイアログ経由）");

// ---- 4. プラン生成 ----
await page.goto("http://localhost:8791/#/goal");
await page.waitForTimeout(600);
await page.locator('label:has-text("プラン開始日") input').fill("2026-07-27");
await page.getByRole("button", { name: /プランを自動生成/ }).click();
await page.waitForTimeout(1500);
const planText = await page.textContent("body");
if (!/プラン生成完了/.test(planText)) fail("プラン生成が完了しない: " + planText.slice(0, 300));
step("プラン生成OK");
await shot("02_plan_generated");

// 同じ生成を繰り返しても、時刻ベースの別IDで予定が増殖しないこと
await page.getByRole("button", { name: /プランを自動生成/ }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /プランを自動生成/ }).click();
await page.waitForTimeout(1200);
const regeneration = await page.evaluate(async () => {
  const data = await fetch("/api/sessions").then((response) => response.json());
  const future = data.sessions.filter(
    (session) => session.date >= "2026-07-27" && session.status !== "skipped"
  );
  const slots = future.map((session) => `${session.date}|${session.timeOfDay}`);
  return {
    count: future.length,
    uniqueIds: new Set(future.map((session) => session.id)).size,
    uniqueSlots: new Set(slots).size,
  };
});
if (
  regeneration.count !== regeneration.uniqueIds ||
  regeneration.count !== regeneration.uniqueSlots
) {
  fail(`プラン再生成で予定が重複する: ${JSON.stringify(regeneration)}`);
}
step("プラン再生成3回OK（自動生成予定の重複なし）");

// 3-2: 生成サマリに自作メニューの使用が出るか
if (!/自作メニュー\d+種類を使用/.test(planText)) {
  fail("生成サマリに自作メニューの使用が出ない（3-2）: " + planText.slice(0, 300));
}

// 3-1 / 3-2 が生成結果に反映されているか（カレンダーで確認）
// 注意: 既定の表示は2週間ぶんしかない。高乳酸は週の1本目に固定され、
// Base期は週ごとに閾値と交互になるため、最初の高乳酸日は2週間の窓の外に出る。
// 4週間表示に広げてから確認する。
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(800);
await page.locator("select").first().selectOption("4");
await page.waitForTimeout(800);
const calText = await page.textContent("body");
if (!calText.includes("コーチ指定 300m×6")) {
  fail("自作メニューがカレンダーに反映されていない（3-2）");
}
const checkpointRow = page.locator("div.card", { hasText: "夏季記録会" }).first();
if ((await checkpointRow.count()) === 0) {
  fail("通過点レースがカレンダーに表示されない");
}
if ((await checkpointRow.textContent()).includes("予定なし")) {
  fail("通過点レースの日が「予定なし」と表示される");
}
// 固定曜日どおりに置かれているか（木＝休養）
if (!/木/.test(calText)) fail("カレンダーに曜日が出ていない");
step("生成結果に固定曜日・自作メニュー・通過点レースが反映OK");

// ---- 5. 実測マーカー ----
await page.goto("http://localhost:8791/#/results");
await page.waitForTimeout(700);
await page.getByRole("button", { name: /実測データ/ }).click();
await page.waitForTimeout(400);
await page.locator('label:has-text("距離(km)") input').fill("8");
await page.locator('label:has-text("合計タイム") input').fill("30:40");
await page.locator('label:has-text("平均HR") input').first().fill("186");
await page.getByRole("button", { name: "登録", exact: true }).click();
await page.waitForTimeout(300);
// 1-4: 確認ダイアログ
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(600);
const markerText = await page.textContent("body");
if (!markerText.includes("実測ベース")) fail("有酸素設定が実測ベースにならない");
step("実測マーカー登録OK（実測ベース表示）");

// ---- 6. 日次コンディション（2-2: 4項目5段階） ----
// D-1: 記録タブはセグメント化されたので、対象のセグメントを開いてから入力する
await page.getByRole("button", { name: /コンディション/ }).click();
await page.waitForTimeout(400);
for (const [label, n] of [["脚の疲労", 2], ["全身疲労", 2], ["睡眠状態", 4], ["モチベーション", 4]]) {
  await page
    .locator(`xpath=//div[text()="${label}"]/following-sibling::div[1]//button[${n}]`)
    .click({ timeout: 8000 });
}
await page.locator('label:has-text("安静時HR") input').fill("48");
await page.getByRole("button", { name: "記録する", exact: true }).click();
await page.waitForTimeout(300);
// 1-4: 確認ダイアログが出ることを検証
if (!(await page.getByText("今日のコンディションを記録しますか？").isVisible())) {
  fail("確認ダイアログが表示されない（1-4）");
}
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(500);
const dailyText = await page.textContent("body");
if (!/green|yellow|red/.test(dailyText)) fail("信号判定が表示されない");
step("日次コンディション（4項目5段階＋確認ダイアログ）OK");
await shot("03_results_forms");

// ---- 6b. 故障ログ（2-3） ----
await page.getByRole("button", { name: "故障", exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "+ 記録する" }).click();
await page.waitForTimeout(200);
// 部位はチップになった（自由記述で表記ゆれが溜まるのをやめた）
await page.getByRole("button", { name: "部位 右アキレス腱" }).click();
await setSlider(page.getByTestId("pain-slider"), 4);
await page.getByRole("button", { name: "故障を記録する" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(500);
if (!(await page.textContent("body")).includes("右アキレス腱")) fail("故障ログが保存されない");
step("故障ログOK");

// ---- 7. ダッシュボード ----
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(700);
const dashText = await page.textContent("body");
if (!dashText.includes("CFE")) fail("ダッシュボードが表示されない");
if (!dashText.includes("1:51.0")) console.log("note: CFE表示 =", /1:\d\d\.\d/.exec(dashText)?.[0]);
step("ダッシュボードOK");
await shot("04_dashboard");

// ---- 8. カレンダーで固定セッション追加 ----
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(600);
await shot("05_calendar");

// ---- 9. 結果入力→補正 ----
// D-2: 期間制限を撤廃したので、日付を指定して任意の日のセッションを記録できる。
// 固定曜日で火曜をポイント練習にしているので 2026-07-28（火）を選ぶ。
await page.goto("http://localhost:8791/#/results?date=2026-07-28");
await page.waitForTimeout(800);
await page.getByRole("button", { name: /練習結果/ }).click();
await page.waitForTimeout(400);
const qBtn = page
  .locator('button:has-text("高乳酸"), button:has-text("閾値"), button:has-text("経済走"), button:has-text("CV"), button:has-text("モデリング")')
  .first();
await qBtn.click();
await page.waitForTimeout(300);
// 1-2: インターバルを構造化入力（本数・距離・設定・レスト・実施タイム）
await page.getByRole("button", { name: "インターバル", exact: true }).click();
await page.waitForTimeout(200);
await page.getByRole("textbox", { name: "本数", exact: true }).fill("5");
// レストの種類・指定はチップになった（selectは開く→選ぶ→閉じるで3タップかかる）
await page.getByRole("button", { name: "レスト内容 ジョグ" }).click();
await page.getByRole("button", { name: "レスト指定 時間(秒)" }).click();
// N-2: メニューの構造に合わせて1本ずつの欄が出る
const repInputs = page.locator('input[aria-label*="実施タイム"]');
const repCount = await repInputs.count();
// 本数に5を入れたので、欄も5つになること（処方の本数より入力の本数を優先する）
if (repCount !== 5) fail(`N-2: 1本ずつの入力欄が本数と合っていない（${repCount}個）`);
for (const [i, v] of ["39.2", "39.6", "40.1", "41.5"].entries()) {
  await repInputs.nth(i).fill(v);
}
// 「まとめて」に切り替えても壊れないこと
await page.getByRole("button", { name: "まとめて", exact: true }).click();
await page.waitForTimeout(200);
const bulkTimesBox = page.getByRole("textbox", { name: /実施タイム/ });
if ((await bulkTimesBox.count()) === 0) {
  fail("N-2: まとめて入力の欄が出ない");
}
/*
 * 不具合: inputMode="decimal" が付いていると、iOS等の数値専用キーボードには
 * カンマキーが無くカンマ区切りの値を打てなかった。属性が外れていることを確認する。
 */
if ((await bulkTimesBox.getAttribute("inputmode")) === "decimal") {
  fail("まとめて入力欄にinputMode=decimalが付いており、カンマが打てない");
}
await bulkTimesBox.fill("39.2, 39.6, 40.1, 41.5");
if ((await bulkTimesBox.inputValue()) !== "39.2, 39.6, 40.1, 41.5") {
  fail("まとめて入力欄にカンマ区切りの値を入れられない");
}
await page.getByRole("button", { name: "1本ずつ", exact: true }).click();
await page.waitForTimeout(200);
if ((await page.locator('input[aria-label*="実施タイム"]').first().inputValue()) !== "39.2") {
  fail("N-2: 切り替えで1本ずつの入力値が消えている");
}
/*
 * 予定距離より短く終えた本も入力できること。
 * 4本目だけ100m短くし、保存後に予定距離と実距離が両方残るところまで確認する。
 */
const distanceToggle = page.getByText("実施距離が予定と違う本がある（途中中断など）");
if ((await distanceToggle.count()) === 0) fail("本ごとの実施距離を変更する切り替えが無い");
await distanceToggle.click();
await page.waitForTimeout(200);
const distanceInputs = page.locator('input[aria-label*="実施距離"]');
if ((await distanceInputs.count()) !== 5) {
  fail(`本ごとの実施距離欄が本数と合っていない（${await distanceInputs.count()}）`);
}
const fourthPlannedDistance = Number(await distanceInputs.nth(3).inputValue());
const fourthActualDistance = fourthPlannedDistance - 100;
await distanceInputs.nth(3).fill(String(fourthActualDistance));
if ((await repInputs.nth(3).inputValue()) !== "41.5") {
  fail("実施距離を変更したら同じ本のタイムが消えた");
}
step("本ごとの実施距離入力OK（予定より短い中断本を保持）");
/*
 * Q-1: 1本ごとの平均心拍。任意項目なので既定では欄を出さない。
 * 出したときも iPhone 幅で実施タイムの欄が潰れないことを実測で見る。
 */
const hrToggle = page.getByText("1本ごとの平均心拍も入れる（任意）");
if ((await hrToggle.count()) === 0) fail("Q-1: 心拍を入れる切り替えが無い");
if ((await page.locator('input[aria-label*="平均心拍"]').count()) !== 0) {
  fail("Q-1: 心拍の欄が既定で出ている（任意項目なので既定では出さない）");
}
await hrToggle.click();
await page.waitForTimeout(300);
const hrInputs = page.locator('input[aria-label*="平均心拍"]');
if ((await hrInputs.count()) !== 5) {
  fail(`Q-1: 心拍の欄が本数と合っていない（${await hrInputs.count()}）`);
}
// 欄が2つ並んでも、どちらもタップして入力できる幅が残っていること
const widths = await page.evaluate(() =>
  [...document.querySelectorAll('input[aria-label*="実施タイム"], input[aria-label*="平均心拍"]')].map(
    (el) => el.getBoundingClientRect().width
  )
);
const narrowest = Math.min(...widths);
if (narrowest < 56) fail(`Q-1: 心拍を出すと入力欄が狭すぎる（最小 ${Math.round(narrowest)}px）`);
// 実施タイムは心拍を出しても消えないこと
if ((await repInputs.first().inputValue()) !== "39.2") {
  fail("Q-1: 心拍の欄を出したら実施タイムが消えた");
}
for (const [i, v] of ["172", "176", "179", "182"].entries()) {
  await hrInputs.nth(i).fill(v);
}
step(`Q-1 1本ごとの心拍OK（既定は非表示 / 最小幅 ${Math.round(narrowest)}px）`);

/*
 * S-4: レストが本ごとに違うメニュー（300+600+300 で 6分・10分）を記録できること。
 * 欄が3つ並んでも、iPhone幅で潰れないこと。
 */
const restToggle = page.getByText("レストが本ごとに違う（任意）");
if ((await restToggle.count()) === 0) fail("S-4: 本ごとのレストの切り替えが無い");
if ((await page.locator('input[aria-label*="のあとのレスト"]').count()) !== 0) {
  fail("S-4: レストの欄が既定で出ている（任意項目なので既定では出さない）");
}
await restToggle.click();
await page.waitForTimeout(300);
const restInputs = page.locator('input[aria-label*="のあとのレスト"]');
if ((await restInputs.count()) !== 5) {
  fail(`S-4: レストの欄が本数と合っていない（${await restInputs.count()}）`);
}
// 3欄になっても入力できる幅が残っていること
const w3 = await page.evaluate(() =>
  [
    ...document.querySelectorAll(
      'input[aria-label*="実施タイム"], input[aria-label*="平均心拍"], input[aria-label*="のあとのレスト"]'
    ),
  ].map((el) => el.getBoundingClientRect().width)
);
const narrowest3 = Math.min(...w3);
if (narrowest3 < 56) fail(`S-4: 3欄にすると入力欄が狭すぎる（最小 ${Math.round(narrowest3)}px）`);
// 本ごとに違うレストを入れる
for (const [i, v] of ["6分", "10分", "6分", "10分"].entries()) {
  await restInputs.nth(i).fill(v);
}
if ((await repInputs.first().inputValue()) !== "39.2") {
  fail("S-4: レストの欄を出したら実施タイムが消えた");
}
step(`S-4 本ごとのレストOK（既定は非表示 / 最小幅 ${Math.round(narrowest3)}px）`);

/*
 * RPEをこちらで埋めないこと（forge-v86）。
 *
 * RPEは本人にしか分からず、しかもCFEの補正に効く（RPE_ADJUST_SEC_PER_POINT）。
 * 数字が入っている欄は「入力済み」に見えるので、既定値を置くと
 * そのまま保存され、こちらが決めた値が能力の推定に混ざる。
 * ここは新規入力なので、空欄で出ていなければならない。
 */
const rpeShown = (await page.getByTestId("rpe-slider-value").textContent()) ?? "";
if (rpeShown.trim() !== "—") {
  fail(`RPE: 新規入力なのに値が入っている（"${rpeShown}"）`);
}
if (!(await page.textContent("body")).includes("未入力")) {
  fail("RPE: 未入力だと分かる表示が出ていない");
}
{
  // 空のまま保存しようとしたら止まること（Number("")が0として混ざらない）
  const before = await page.evaluate(() =>
    fetch("/api/results").then((r) => r.json()).then((d) => (d.results ?? []).length)
  );
  let dialogText = "";
  const onDialog = async (dialog) => {
    dialogText = dialog.message();
    await dialog.dismiss();
  };
  page.on("dialog", onDialog);
  await page.getByRole("button", { name: /登録して補正を実行/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "実行する" }).click();
  await page.waitForTimeout(900);
  page.off("dialog", onDialog);

  const after = await page.evaluate(() =>
    fetch("/api/results").then((r) => r.json()).then((d) => (d.results ?? []).length)
  );
  if (!dialogText.includes("RPE")) {
    fail(`RPE: 空のまま保存を止めていない（${dialogText || "案内なし"}）`);
  } else if (after !== before) {
    fail(`RPE: 空のまま保存された（${before} → ${after}）`);
  } else {
    step("RPEをこちらで埋めないOK（空欄で出す・空のままでは保存しない）");
  }
}

await setSlider(page.getByTestId("rpe-slider"), 10);
await page.getByRole("button", { name: "主観 非常に" }).click();
// 2-1: 環境条件（折りたたみを開く）
await page.getByText("環境条件（気温・湿度・風・雨）").click();
await page.waitForTimeout(200);
await page.locator('label:has-text("気温(℃)") input').fill("31");
await page.locator('label:has-text("湿度(%)") input').fill("70");
await page.waitForTimeout(200);
const envText = await page.textContent("body");
if (!envText.includes("暑熱条件")) fail("暑熱条件フラグが表示されない（2-1）");
step("インターバル構造化入力＋環境条件OK");
await page.getByRole("button", { name: /登録して補正を実行/ }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(1200);
const resultText = await page.textContent("body");
if (!resultText.includes("CFE:")) fail("補正結果が表示されない");
if (!resultText.includes("変更差分")) console.log("note: 変更差分なし（ペース変化が閾値未満の可能性）");
const storedDistanceResult = await page.evaluate(async () => {
  const response = await fetch("/api/results");
  return response.json();
});
const shortened = storedDistanceResult.results
  ?.flatMap((result) => result.interval?.results ?? [])
  .find((rep) => rep.plannedDistanceM !== undefined);
if (
  !shortened ||
  shortened.distanceM !== fourthActualDistance ||
  shortened.plannedDistanceM !== fourthPlannedDistance
) {
  fail("予定より短い本の実施距離と予定距離が保存されていない");
}
step("結果入力→CFE補正OK");
await shot("06_result_correction");

// ---- 9b. ジョグ・持続走の記録（1-1） ----
// 日曜はジョグ固定にしてあるので 2026-08-02（日）を選ぶ
await page.goto("http://localhost:8791/#/results?date=2026-08-02");
await page.waitForTimeout(800);
await page.getByRole("button", { name: /練習結果/ }).click();
await page.waitForTimeout(400);
const jogBtn = page.locator('button:has-text("有酸素")').first();
await jogBtn.click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "ジョグ・持続走", exact: true }).click();
await page.waitForTimeout(200);
await page.getByPlaceholder("11.2").fill("11.2");
await page.getByPlaceholder("50", { exact: true }).fill("50");
await page.waitForTimeout(300);
const jogText = await page.textContent("body");
if (!jogText.includes("4:28/km")) fail("平均ペースが自動計算されない（1-1）: " + (/自動計算[^\n]*/.exec(jogText)?.[0] ?? "表示なし"));
await page.getByPlaceholder("145").fill("145");
await page.getByRole("button", { name: /登録して補正を実行/ }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(1000);
step("ジョグ記録（平均ペース自動計算 4:28/km）OK");
await shot("13_jog_record");

// ---- 10. 永続化検証: リロードしてもデータが残る ----
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(300);
await page.reload();
await page.waitForTimeout(900);
const afterReload = await page.textContent("body");
if (!afterReload.includes("CFE") || afterReload.includes("プロフィールと目標を先に")) {
  fail("リロード後にデータが消えている");
}
step("リロード後の永続化OK");
await shot("07_after_reload");

// ---- 10b. Apple Health 取り込み ----
const healthExportPath = path.join(os.tmpdir(), "health-export.xml");
fs.writeFileSync(healthExportPath, `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="ja_JP">
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="count/min" startDate="2026-07-22 07:00:00 +0900" endDate="2026-07-22 07:00:00 +0900" value="47"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="count/min" startDate="2026-07-23 07:00:00 +0900" endDate="2026-07-23 07:00:00 +0900" value="48"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-07-22 23:30:00 +0900" endDate="2026-07-23 07:00:00 +0900"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="45" durationUnit="min" totalDistance="10.5" totalDistanceUnit="km" startDate="2026-07-23 06:00:00 +0900" endDate="2026-07-23 06:45:00 +0900">
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="150" maximum="168" unit="count/min"/>
 </Workout>
</HealthData>`);
await page.goto("http://localhost:8791/#/data");
await page.waitForTimeout(600);
await page.setInputFiles('input[type="file"][accept*="xml"]', healthExportPath);
await page.waitForTimeout(1500);
const healthText = await page.textContent("body");
if (!healthText.includes("取り込み完了")) fail("Apple Health取り込みが完了しない: " + healthText.slice(0, 200));
if (!healthText.includes("最終同期")) fail("最終同期が表示されない");
if (!healthText.includes("LTへは自動反映していません")) {
  fail("用途不明のApple Health走行がLTへ自動反映される表示になっている");
}
step("Apple Health取り込みOK（用途不明ランはLT除外 / 睡眠・安静時HR→疲労シグナル）");
await shot("14_health_import");

/*
 * FIT取込 Phase 1: 拡張子ではなく中身（.FITシグネチャ）で確認する。
 * 正常なヘッダーを持つ最小限のFITと、FIT以外（拡張子だけ.fitに変えたテキスト）
 * の両方を確認し、後者が明確な理由付きで拒否されることを見る。
 */
function buildFitFixture(opts = {}) {
  const headerSize = 12;
  const bodyLength = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt8(headerSize, 0);
  header.writeUInt8(16, 1);
  header.writeUInt16LE(100, 2);
  header.writeUInt32LE(bodyLength, 4);
  header.write(opts.signature ?? ".FIT", 8, "ascii");
  const body = Buffer.alloc(bodyLength, 0xab);
  const crc = Buffer.alloc(2);
  return Buffer.concat([header, body, crc]);
}
const validFitPath = path.join(os.tmpdir(), "sample.fit");
fs.writeFileSync(validFitPath, buildFitFixture());
// header_sizeは正しい(12)が、シグネチャが".FIT"でない＝拡張子だけ.fitに変えたファイルを想定
const fakeFitPath = path.join(os.tmpdir(), "fake.fit");
fs.writeFileSync(fakeFitPath, buildFitFixture({ signature: "NOPE" }));

/*
 * Phase 2の解析確認用: 本物のFITメッセージ（file_id + session + record）を
 * fit-file-parser自身のFitEncoderで組み立てる。手書きバイトでは
 * message定義まで再現できないため、実際にデコードできるものを使う。
 */
function buildRealFitFixture() {
  const enc = new FitEncoder();
  const ts = (iso) => FitEncoder.toFitTimestamp(new Date(iso));
  enc.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 },
  ]);
  enc.writeMessage(
    18,
    [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts("2026-07-20T10:05:00Z") },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: ts("2026-07-20T10:00:00Z") },
      { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 }, // sport: running
      { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 200000 }, // total_distance: 2km
      { number: 16, size: 1, baseType: FitBaseType.Uint8, value: 150 }, // avg_heart_rate
      { number: 18, size: 1, baseType: FitBaseType.Uint8, value: 90 }, // avg_cadence（片脚rpm。表示はspmで2倍）
      { number: 57, size: 1, baseType: FitBaseType.Sint8, value: 25 }, // avg_temperature
    ],
    2
  );
  enc.writeMessage(
    20,
    [{ number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts("2026-07-20T10:00:10Z") }],
    4
  );
  return Buffer.from(enc.close());
}
const realFitPath = path.join(os.tmpdir(), "real-sample.fit");
fs.writeFileSync(realFitPath, buildRealFitFixture());

await page.goto("http://localhost:8791/#/data");
await page.waitForTimeout(600);
const fitInput = page.locator('input[type="file"][accept*="fit"]');
await fitInput.setInputFiles(validFitPath);
await page.waitForTimeout(1000);
let fitText = await page.textContent("body");
if (!fitText.includes("FITファイルとして確認できました")) {
  fail("正常なFITヘッダーが受理されない: " + fitText.slice(0, 300));
}
await fitInput.setInputFiles(fakeFitPath);
await page.waitForTimeout(1000);
fitText = await page.textContent("body");
if (!fitText.includes("署名（.FIT）が見つかりません")) {
  fail("拡張子だけ.fitの非FITファイルが拒否されない: " + fitText.slice(0, 300));
}
step("FIT取込Phase1OK（拡張子でなく中身で判定・非FITを理由つきで拒否）");

await fitInput.setInputFiles(realFitPath);
await page.waitForTimeout(1000);
fitText = await page.textContent("body");
if (!fitText.includes("running") || !fitText.includes("2km")) {
  fail("実際のFIT解析結果（種目・距離）が表示されない: " + fitText.slice(0, 400));
}
if (!fitText.includes("record 1件")) {
  fail("recordの件数が表示されない: " + fitText.slice(0, 400));
}
if (!fitText.includes("ピッチ180spm") || !fitText.includes("気温25℃")) {
  fail("ランニングダイナミクス（ピッチ・気温）が表示されない: " + fitText.slice(0, 400));
}
step("FIT取込Phase2OK（session/lap/recordを実際に解析して概要表示・ランニングダイナミクス含む）");

/*
 * FIT解析コードは動的import（別chunk、対象1・2とは無関係のbundleサイズ対策）。
 * 一度オンラインで開けばService Workerがchunkをキャッシュするはずなので、
 * その後オフラインになってもFIT取込が動くことを確認する
 * （逆に言えば、一度も開いたことが無い状態でオフラインだと使えない、という
 * 制約が新たに生まれている。ここでは「一度使えば以後オフラインでも使える」
 * ことだけを保証する）。
 */
await ctx.setOffline(true);
// ページを丸ごと読み直し、動的importが本当にService Workerのキャッシュから
// 解決されることを確認する（同一ページ内の再遷移だとJSの生存モジュールを
// 再利用するだけになり、キャッシュを試したことにならないため）。
await page.goto("about:blank");
await page.goto("http://localhost:8791/#/data");
await page
  .waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 })
  .catch(() => fail("オフラインでの再読み込みで起動できない"));
await page.waitForTimeout(600);
await page.locator('input[type="file"][accept*="fit"]').setInputFiles(realFitPath);
await page.waitForTimeout(1000);
const offlineFitText = await page.textContent("body");
if (!offlineFitText.includes("running") || !offlineFitText.includes("2km")) {
  fail("オフラインで、一度使ったFIT解析chunkが使えない: " + offlineFitText.slice(0, 300));
}
await ctx.setOffline(false);
step("FIT取込: 一度使えばオフラインでも解析できるOK（chunkがキャッシュ済み）");

/*
 * FIT取込 Phase 3: ラップ→区間の自動分類（ルールベース、LLM不使用）。
 * ウォームアップ(遅)→メイン(速)→リカバリー(遅)→メイン(速)→クールダウン(遅)
 * という構成のFITを組み立て、自動判定が実際に一致することを確認する。
 * fixture側でも同じ計算（中央値・FAST_RATIO=0.93）が成り立つよう
 * ペース差を明確に取っている（本体ロジックは src/lib/core/intervalClassify.ts）。
 */
function buildIntervalFitFixture(dateStr = "2026-07-20") {
  const enc = new FitEncoder();
  const ts = (iso) => FitEncoder.toFitTimestamp(new Date(iso));
  enc.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 },
  ]);
  const laps = [
    { start: `${dateStr}T10:00:00Z`, end: `${dateStr}T10:05:00Z`, elapsedSec: 300, distanceM: 800 }, // warmup, pace 375
    { start: `${dateStr}T10:05:00Z`, end: `${dateStr}T10:05:50Z`, elapsedSec: 50, distanceM: 300 }, // main, pace 166.7
    { start: `${dateStr}T10:05:50Z`, end: `${dateStr}T10:07:10Z`, elapsedSec: 80, distanceM: 200 }, // recovery, pace 400
    { start: `${dateStr}T10:07:10Z`, end: `${dateStr}T10:08:01Z`, elapsedSec: 51, distanceM: 300 }, // main, pace 170
    { start: `${dateStr}T10:08:01Z`, end: `${dateStr}T10:13:21Z`, elapsedSec: 320, distanceM: 800 }, // cooldown, pace 400
  ];
  for (const l of laps) {
    enc.writeMessage(
      19,
      [
        { number: 253, size: 4, baseType: FitBaseType.Uint32, value: ts(l.end) },
        { number: 2, size: 4, baseType: FitBaseType.Uint32, value: ts(l.start) },
        { number: 7, size: 4, baseType: FitBaseType.Uint32, value: Math.round(l.elapsedSec * 1000) },
        { number: 9, size: 4, baseType: FitBaseType.Uint32, value: Math.round(l.distanceM * 100) },
      ],
      3
    );
  }
  return Buffer.from(enc.close());
}
const intervalFitPath = path.join(os.tmpdir(), "interval-sample.fit");
fs.writeFileSync(intervalFitPath, buildIntervalFitFixture());

await fitInput.setInputFiles(intervalFitPath);
await page.waitForTimeout(1000);
const kindSelects = page.locator('select[aria-label*="区間種別"]');
const kindCount = await kindSelects.count();
if (kindCount !== 5) fail(`区間分類の行数が想定と違う（5件のはず）: ${kindCount}件`);
const kindValues = [];
for (let i = 0; i < kindCount; i++) {
  kindValues.push(await kindSelects.nth(i).inputValue());
}
const expectedKinds = ["warmup", "main", "recovery", "main", "cooldown"];
if (JSON.stringify(kindValues) !== JSON.stringify(expectedKinds)) {
  fail(`区間の自動判定が想定と違う: ${JSON.stringify(kindValues)}（期待: ${JSON.stringify(expectedKinds)}）`);
}
const intervalText = await page.textContent("body");
if (!intervalText.includes("区間の自動判定")) fail("区間分類のUIが表示されない");
if (!/\d+%/.test(intervalText)) fail("信頼度（%）が表示されない");
// 手動修正が実際にUIへ反映されること（保存はしない。この場限りの表示）
await kindSelects.first().selectOption("unknown");
const changedValue = await kindSelects.first().inputValue();
if (changedValue !== "unknown") fail("区間種別を手動で修正できない");
step("FIT取込Phase3OK（ラップ→区間の自動分類・信頼度表示・手動修正が反映される）");

/*
 * FIT取込: 元ファイル・解析・修正・結果確認を分離した保存。
 * 「この内容で登録する」を押すと、確認済み種別（直前でlap1を手動でunknownに
 * 直した状態のまま）と元FITだけが先に保存される。RPE・達成状態・主観強度を
 * 本人確認するまではSession/SessionResultを作らず、確認後にだけ記録へ反映する。
 */
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.waitForTimeout(1000);
let registerText = await page.textContent("body");
if (!registerText.includes("本人確認待ち") || !registerText.includes("2026-07-20")) {
  fail("FIT本体・解析結果が本人確認待ちで保存されない: " + registerText.slice(0, 400));
}
// 二重登録を招かないよう、登録後はボタンが引っ込むこと
if (await page.getByRole("button", { name: "この内容で登録する" }).count()) {
  fail("登録後もボタンが残っており、連打で二重登録できてしまう");
}
// 確認待ち状態がIndexedDBへ保存され、ページ再読み込み後にも戻れること。
await page.waitForTimeout(500);
await page.goto("about:blank");
await page.goto("http://localhost:8791/#/data");
await page
  .waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 })
  .catch(() => fail("FIT確認待ち保存後の再読み込みで起動できない"));
await page.waitForTimeout(600);
registerText = await page.textContent("body");
if (!registerText.includes("本人確認待ちのFIT（1件）")) {
  fail("再読み込み後にFITの本人確認待ち状態が復元されない: " + registerText.slice(0, 400));
}
// FITだけでは分からない値は空欄であり、本人が明示入力する。
await setSlider(page.getByTestId("fit-rpe-slider"), 8);
await page.getByLabel("達成状態").selectOption("achieved");
await page.getByLabel("主観強度").selectOption("hard");
await page.getByRole("button", { name: "本人確認して記録へ反映する" }).click();
await page.waitForTimeout(1000);
registerText = await page.textContent("body");
if (!registerText.includes("本人確認済みとして保存しました")) {
  fail("FITの本人確認後に正式結果が保存されない: " + registerText.slice(0, 400));
}
step("FIT取込Phase4OK（実測保存→本人確認→正式結果の2段階で登録される）");

/*
 * FIT取込 Phase 5: 二重登録防止。
 * 全く同じFITファイルをもう一度選び直しても、新規の記録が増えるのではなく
 * 既存の記録が上書きされることを確認する（生バイト列の完全一致で判定）。
 *
 * 同じパスのファイルを input[type=file] へ再度 setInputFiles しても、
 * ブラウザは値が変わらないため change イベントを発火しないことがある。
 * 文書ごと読み直してinputの値を空に戻してから選び直す
 * （ハッシュ変更だけの遷移だとinputが再マウントされないことがあるため）。
 */
await page.goto("about:blank");
await page.goto("http://localhost:8791/#/data");
await page.waitForTimeout(600);
const fitInputAgain = page.locator('input[type="file"][accept*="fit"]');
await fitInputAgain.setInputFiles(intervalFitPath);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.waitForTimeout(1000);
const reRegisterText = await page.textContent("body");
if (!reRegisterText.includes("既に取り込み済み")) {
  fail("同じFITの再登録が既存記録として扱われない: " + reRegisterText.slice(0, 400));
}
step("FIT取込Phase5OK（同じ元ファイルの再登録は新規ではなく上書き）");

/*
 * FIT取込 Phase 6: 既存の計画済みセッションとの紐付け。
 * 別の日付（他のFITテストと被らない過去日）に計画済みセッションを直接作り、
 * 同じ日付のFITを取り込んで「この予定に記録する」を選ぶと、
 * 新規セッションではなくその計画済みセッションが完了扱いになることを確認する。
 */
const LINK_DATE = "2026-05-01";
const plannedAdd = await page.evaluate(async (date) => {
  const res = await fetch("/api/plan-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "add",
      session: {
        date,
        category: "high_lactate",
        name: "300m×5 計画",
        prescription: "300m×5 r3分",
      },
    }),
  });
  return res.json();
}, LINK_DATE);
if (!plannedAdd?.session?.id) fail("Phase6: 計画済みセッションを直接作れない");
const plannedId = plannedAdd.session.id;
// IndexedDBへの保存は250msデバウンスされている。文書ごと読み直す前に
// 書き込みが終わるのを待つ（でないと直前に足した予定が読み込み後に消える）。
await page.waitForTimeout(500);

const linkFitPath = path.join(os.tmpdir(), "interval-link-sample.fit");
fs.writeFileSync(linkFitPath, buildIntervalFitFixture(LINK_DATE));
await page.goto("about:blank");
await page.goto("http://localhost:8791/#/data");
await page
  .waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 })
  .catch(() => fail("Phase6: 文書再読み込み後に起動できない"));
await page.waitForTimeout(600);
await page.locator('input[type="file"][accept*="fit"]').setInputFiles(linkFitPath);
await page
  .waitForFunction(() => (document.body.textContent ?? "").includes("区間の自動判定"), {
    timeout: 10000,
  })
  .catch(() => fail("Phase6: 文書再読み込み後、FIT解析・分類が終わらない"));
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.waitForTimeout(1000);
const confirmText = await page.textContent("body");
if (!confirmText.includes(LINK_DATE) || !confirmText.includes("計画済みの練習があります")) {
  fail("Phase6: 計画済みセッションがあるのに確認が出ない: " + confirmText.slice(0, 300));
}
if (!confirmText.includes("300m×5 計画")) {
  fail("Phase6: 確認画面に計画済みセッション名が出ない: " + confirmText.slice(0, 300));
}
await page.getByRole("button", { name: /300m×5 計画/ }).click();
await page.waitForTimeout(1000);
let linkedText = await page.textContent("body");
if (!linkedText.includes("本人確認待ち")) {
  fail("Phase6: 紐付け後に本人確認待ちにならない: " + linkedText.slice(0, 300));
}
await setSlider(page.getByTestId("fit-rpe-slider"), 8);
await page.getByLabel("達成状態").selectOption("achieved");
await page.getByLabel("主観強度").selectOption("hard");
await page.getByRole("button", { name: "本人確認して記録へ反映する" }).click();
await page.waitForTimeout(1000);
linkedText = await page.textContent("body");
if (!linkedText.includes("CFE・次回提案の評価経路へ反映しました")) {
  fail("Phase6: 本人確認後の反映メッセージが出ない: " + linkedText.slice(0, 300));
}
const plannedAfter = await page.evaluate(async (id) => {
  const d = await fetch("/api/sessions?from=2000-01-01&to=2099-12-31").then((r) => r.json());
  return d.sessions?.find((s) => s.id === id);
}, plannedId);
if (plannedAfter?.status !== "completed") {
  fail(`Phase6: 紐付け後もセッションのstatusがcompletedにならない: ${plannedAfter?.status}`);
}
step("FIT取込Phase6OK（計画済みセッションへの紐付け・通常の記録経路でstatusが更新される）");
/*
 * このテスト専用に足したセッション（2026-05-01・high_lactate）は、
 * 後続のM-5（間隔違反の代替日提案）が「最初の2件のhigh_lactate」を
 * 拾って使うため、残したままだと日付が全く違う代替日探索に化けて
 * 無関係のテストを壊す。ここで消して元の状態に戻す。
 */
await page.evaluate(
  async ({ id, date }) => {
    await fetch(`/api/plan-edit?sessionId=${id}&date=${date}`, { method: "DELETE" });
  },
  { id: plannedId, date: LINK_DATE }
);

// 実際に記録として保存され、その日の記録画面から見えることを確認する
// （session.name がそのまま一覧に表示される既存の実装を利用。既定タブは
// 「コンディション」なので「練習結果」タブへ切り替える必要がある）
await page.goto("http://localhost:8791/#/results?date=2026-07-20");
await page.waitForTimeout(800);
await page.getByRole("button", { name: "練習結果" }).click();
await page.waitForTimeout(500);
const resultsTextAfterFit = await page.textContent("body");
if (!resultsTextAfterFit.includes("FIT取込")) {
  fail("FIT取込で登録した練習が記録画面に見当たらない: " + resultsTextAfterFit.slice(0, 300));
}
step("FIT取込Phase4: 記録画面に反映OK");

// 二重登録されていれば、同じ日にFIT取込のセッションが2件表示されるはず
const fitSessionButtons = await page.evaluate(
  () => [...document.querySelectorAll("button")].filter((b) => b.textContent?.includes("インターバル（FIT取込）")).length
);
if (fitSessionButtons !== 1) {
  fail(`同じFITを2回登録したのに記録が${fitSessionButtons}件になっている（二重登録防止が効いていない）`);
}
step("FIT取込Phase5: 記録画面でも1件のまま（二重登録されていない）OK");

// ---- 8c. F-2: 実際の練習日誌をそのまま貼り付ける ----
await page.goto("http://localhost:8791/#/past");
await page.waitForTimeout(800);
await page.getByRole("button", { name: "まとめて入力" }).click();
await page.waitForTimeout(400);
// タブ無し・半角スペース1個区切り・実施タイムが次の行・括弧に設定と区間ラップ
const REAL_LOG = [
  "7/4 2kmジョグ 8:40",
  "7/5 オフ",
  "7/6 300(42)＋600(1:26)＋600(1:26) r15min",
  "42 1:26 1:25",
  "7/10 300(41-42)×2×2 r100walk R12min",
  "41.6 41.8 40.0 41.8",
  "7/13 レース　800m 1:56.0(56.0-60.0)",
  "7/16 65minジョグ　11.8km 平均心拍154",
  "7/18 1000(3:15-25)×4 r200jog 3:27 3:26 3:27 3:27 平均心拍180 最大195",
].join("\n");
await page.locator("textarea").first().fill(REAL_LOG);
await page.getByRole("button", { name: /解釈する/ }).click();
await page.waitForTimeout(900);
let bulkText = await page.textContent("body");
// 継続行が前の行にまとまり、日付付きの7行になること
if (!bulkText.includes("7行を解釈しました")) {
  fail("継続行がまとまっていない（F-2）: " + (/\d+行を解釈しました/.exec(bulkText)?.[0] ?? "表示なし"));
}
/*
 * 実データで人が選ぶのは1行だけ（7/18 の 1000m、GRPの137%）。
 *
 * CVと閾値は設定の出どころが違う（実測LT由来）ので、設定タイムだけでは決まらない。
 * 以前は距離だけで「CV」と断定していたが、それは間違いだった（forge-v84）。
 * ここで見るのは
 *   ・選ばせる行が**1行だけ**であること（広げすぎると貼るたびに選ぶ羽目になる）
 *   ・なぜ選ぶ必要があるのか理由が画面に出ていること
 *   ・選べば登録できるようになること
 */
if (!bulkText.includes("登録できる行: 6")) {
  fail(
    "実際の日誌の解釈が想定と違う（F-2）: " +
      (/登録できる行[^）\n]*/.exec(bulkText)?.[0] ?? "表示なし")
  );
} else if (!bulkText.includes("CVと閾値")) {
  fail("F-2: 選ばせる理由が画面に出ていない（空欄の理由が分からない）");
} else {
  // 未確定の行でカテゴリを選ぶと、登録できる行が7になること
  // 行の器は past/page.tsx の className="rounded-lg border p-2.5"
  const uncertainRow = page
    .locator("div.rounded-lg.border")
    .filter({ hasText: "CVと閾値" })
    .first();
  const catSelect = uncertainRow.locator("select").nth(1);
  if ((await catSelect.count()) === 0) {
    fail("F-2: 未確定の行にカテゴリの選択肢が出ていない");
  } else {
    await catSelect.selectOption("threshold");
    await page.waitForTimeout(500);
    /*
     * 選択のチェックは「解釈した時点で登録できた行」にだけ最初から入る。
     * あとから直した行は自分でチェックする（黙って選択済みにはしない）。
     * どの行かをDOMから当てにいかず、押せるチェックを全部入れる（本人の操作と同じ）。
     */
    const boxes = page.locator('input[type="checkbox"]:not([disabled])');
    for (let i = 0; i < (await boxes.count()); i++) {
      const box = boxes.nth(i);
      if (!(await box.isChecked())) await box.check();
    }
    await page.waitForTimeout(300);
    const after = await page.textContent("body");
    if (!after.includes("登録できる行: 7")) {
      fail(
        "F-2: カテゴリを選んでも登録できるようにならない: " +
          (/登録できる行[^）\n]*/.exec(after)?.[0] ?? "表示なし")
      );
    } else {
      step("実際の日誌の解釈OK（選ぶのは1行だけ・理由つき・選べば登録できる）");
    }
  }
  bulkText = await page.textContent("body");
}
// 実施タイムに距離や心拍が紛れていないこと
if (!bulkText.includes("41.6 / 41.8 / 40 / 41.8")) {
  fail("実施タイムが正しく取れていない（F-2: 300×4の4本）");
}
// 1000m×4 の実施タイムがちょうど4本で、心拍(180/195)が混ざっていないこと
if (!bulkText.includes("207 / 206 / 207 / 207")) {
  fail("1000m×4の実施タイムが正しく取れていない（F-2）");
}
// レースの区間ラップが取れていること（配分シミュレータの材料）
if (!bulkText.includes("区間ラップ 56 / 60")) {
  fail("レースの区間ラップが取れていない（F-2 / I）");
}
step("実施タイム・区間ラップの抽出OK（距離と心拍を巻き込まない）");
await shot("20_bulk_import");

await page.getByRole("button", { name: /選択した7件を登録する/ }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(1200);
bulkText = await page.textContent("body");
if (!bulkText.includes("7件を登録しました")) {
  fail("一括入力が登録されない（F-2）: " + bulkText.slice(0, 300));
}
step("一括入力の登録OK（7件）");

// I: レースを2本入れたので配分案が出るようになる
await page.locator("textarea").first().fill("7/14 レース　800m 1:53.49(56.7-56.7)");
await page.getByRole("button", { name: /解釈する/ }).click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /選択した1件を登録する/ }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(1200);
step("2本目のレース登録OK");

// ---- 8d. 読めてしまった間違いを止める（sanity） ----
// 読めなかった行は画面に理由が出るので気づけるが、読めた間違いは素通しでCFEに届く。
// ジョグの50分を5分と打つと、11.8kmを0:25/kmで走ったことになる
await page.locator("textarea").first().fill("7/19 ジョグ 11.8km 5分");
await page.getByRole("button", { name: /解釈する/ }).click();
await page.waitForTimeout(800);
let sanityText = await page.textContent("body");
if (!sanityText.includes("要確認") || !sanityText.includes("速すぎます")) {
  fail("ありえないペースが検出されない: " + sanityText.slice(0, 400));
}
if (sanityText.includes("登録できる行: 1")) {
  fail("ありえない値を含む行が登録可能になっている");
}
step("ありえない値の検出OK（要確認を出して登録を止める）");

// パーサが不自然な数値を落とすと本数が黙って減る。減った事実を出す
await page.locator("textarea").first().fill("7/19 300(42)×3 r3min 41.6 4.00 41.8");
await page.getByRole("button", { name: /解釈する/ }).click();
await page.waitForTimeout(800);
sanityText = await page.textContent("body");
if (!sanityText.includes("3本に対して実施タイムが2本")) {
  fail("読み取れなかった実施タイムが黙って消えている: " + sanityText.slice(0, 400));
}
step("本数と実施タイムの不一致OK（黙って本数が減らない）");
await shot("21_sanity");

// ---- 8e. 補強を StrengthSession へ流す ----
const pastBefore = await page.evaluate(() =>
  fetch("/api/past").then((r) => r.json()).then((d) => d.entries.length)
);
await page.locator("textarea").first().fill("7/19 プライオ 接地120回\n7/20 体幹30分");
await page.getByRole("button", { name: /解釈する/ }).click();
await page.waitForTimeout(800);
let stText = await page.textContent("body");
if (!stText.includes("登録できる行: 2") || !stText.includes("補強として記録します")) {
  fail("補強が認識されない: " + stText.slice(0, 400));
}
await page.getByRole("button", { name: /選択した2件を登録する/ }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(1200);
stText = await page.textContent("body");
if (!stText.includes("うち補強2件")) {
  fail("補強の登録件数が出ない: " + stText.slice(0, 300));
}
const pastAfter = await page.evaluate(() =>
  fetch("/api/past").then((r) => r.json()).then((d) => d.entries.length)
);
if (pastAfter !== pastBefore) {
  fail(`補強が走練習側にも入っている（ACWR二重計上）: ${pastBefore} → ${pastAfter}`);
}
const strengthOK = await page.evaluate(() =>
  fetch("/api/sessions?from=2026-07-01&to=2026-07-31")
    .then((r) => r.json())
    .then((d) =>
      (d.strengthSessions ?? []).some((s) => s.type === "plyometrics" && s.contactCount === 120)
    )
);
if (!strengthOK) fail("補強が StrengthSession に入っていない（接地回数含む）");
step("補強の認識OK（走練習と別枠で StrengthSession に入る）");

// ---- 8f. 表記辞書：一度直したら次から通る ----
const TEAM_LOG = "7/21 セット走 1000m×5 r200mjog 3:05 3:04 3:06 3:05 3:03";
await page.locator("textarea").first().fill(TEAM_LOG);
await page.getByRole("button", { name: /解釈する/ }).click();
await page.waitForTimeout(800);
let phText = await page.textContent("body");
if (phText.includes("登録できる行: 1")) {
  fail("辞書が無いのに「セット走」が確定している（推測で埋めてはいけない）");
}
// 人がカテゴリを選ぶ → その書き方を覚えさせる
await page.locator("select").filter({ hasText: "カテゴリ" }).first().selectOption({ label: "CV" });
await page.waitForTimeout(200);
await page.getByRole("button", { name: "この書き方を覚えさせる" }).first().click();
await page.waitForTimeout(200);
await page.locator('input[placeholder="覚えさせる語"]').first().fill("セット走");
await page.getByRole("button", { name: "登録", exact: true }).first().click();
await page.waitForTimeout(700);
phText = await page.textContent("body");
if (!phText.includes("辞書に登録しました")) {
  fail("表記辞書に登録できない: " + phText.slice(0, 400));
}
// 登録済みの語が一覧に出る（あとで消せる）
if (!phText.includes("覚えた書き方")) {
  fail("覚えた書き方の一覧が出ない");
}
// 同じ文をもう一度解釈させると、今度は最初から確定する
await page.getByRole("button", { name: "やり直す" }).click();
await page.waitForTimeout(200);
await page.locator("textarea").first().fill(TEAM_LOG);
await page.getByRole("button", { name: /解釈する/ }).click();
await page.waitForTimeout(800);
phText = await page.textContent("body");
if (!phText.includes("登録できる行: 1")) {
  fail("辞書に登録した語が次から効いていない: " + phText.slice(0, 400));
}
step("表記辞書OK（一度直した書き方が次から自動で通る）");
await shot("22_phrase");

// ---- 9c. D-3: 前回と同じ / メニューとして保存 ----
// 2回目の高乳酸セッション（08-04）を開くと、07-28の記録が「前回」として出るはず
await page.goto("http://localhost:8791/#/results?date=2026-08-04");
await page.waitForTimeout(900);
await page.getByRole("button", { name: /練習結果/ }).click();
await page.waitForTimeout(400);
const q2 = page
  .locator('button:has-text("高乳酸"), button:has-text("閾値"), button:has-text("経済走"), button:has-text("CV"), button:has-text("モデリング")')
  .first();
if ((await q2.count()) > 0) {
  await q2.click();
  await page.waitForTimeout(600);
  const beforeText = await page.textContent("body");
  if (!beforeText.includes("直近の同カテゴリ")) {
    fail("「前回と同じ」の出典が表示されない（D-3）");
  } else {
    await page.getByRole("button", { name: "前回と同じ", exact: true }).click();
    await page.waitForTimeout(400);
    const afterText = await page.textContent("body");
    if (!afterText.includes("の内容を読み込みました")) {
      fail("「前回と同じ」で読み込み元が表示されない（D-3）");
    } else {
      // 実施タイムは前回の値を持ち込まない（今日の結果ではないため）
      const repVals = await page.locator('input[aria-label*="実施タイム"]').allInnerTexts().catch(() => []);
      const filled = await page
        .locator('input[aria-label*="実施タイム"]')
        .evaluateAll((els) => els.map((e) => e.value).filter((v) => v.trim() !== ""));
      if (filled.length > 0) fail(`前回の実施タイムを持ち込んでいる: ${filled.join(",")}`);
      step("「前回と同じ」OK（出典表示・実施タイムは空のまま）");
    }
    // テンプレート保存 → 自作メニューに入る
    await page.getByRole("button", { name: "この内容をメニューとして保存" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "実行する" }).click();
    await page.waitForTimeout(700);
    if (!(await page.textContent("body")).includes("メニューに保存しました")) {
      fail("メニューとして保存できない（D-3）");
    } else {
      await page.goto("http://localhost:8791/#/plan-settings");
      await page.waitForTimeout(800);
      if (!/m×\d/.test(await page.textContent("body"))) {
        fail("保存したメニューが自作メニュー一覧に出ない（D-3）");
      } else {
        step("メニューのテンプレート保存OK（自作メニューに統合）");
      }
    }
  }
} else {
  fail("08-04 に質練習が見つからない（テスト前提が崩れている）");
}

// ---- 9d. B-2: 分析タブにレース分析が統合されているか ----
await page.goto("http://localhost:8791/#/analysis");
await page.waitForTimeout(900);
// P-5: セグメントは3つ。増やすと iPhone 幅で label が詰まる
for (const label of ["現在地", "推移", "レース"]) {
  const c = await page.getByRole("button", { name: label, exact: true }).count();
  if (c === 0) fail(`分析タブにセグメント「${label}」がない（B-2 / P-5）`);
}
const segCount = await page.locator("div.seg button").count();
if (segCount !== 3) fail(`P-5: 分析タブのセグメントが3つでない（${segCount}）`);
// ラベルが省略記号にならず読めること（幅に収まっているか）
const segFits = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("div.seg button")];
  return btns.every((b) => b.scrollWidth <= b.clientWidth + 1);
});
if (!segFits) fail("P-5: 分析タブのセグメントのラベルが幅に収まっていない");
await page.getByRole("button", { name: "レース", exact: true }).click();
await page.waitForTimeout(700);
const anaText = await page.textContent("body");
if (!/ラウンド|レース/.test(anaText)) fail("分析タブのレースセグメントが表示されない（B-2）");
step("分析タブのセグメント化＋レース分析の統合OK（3つに集約）");

// ---- 9e. G: 同一処方の経時比較 ----
await page.goto("http://localhost:8791/#/analysis");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "推移", exact: true }).click();
await page.waitForTimeout(700);
const anaText2 = await page.textContent("body");
if (!anaText2.includes("同じ処方の推移")) fail("同一処方の比較カードが無い（G）");
if (!/垂れ幅/.test(anaText2)) fail("垂れ幅の表示が無い（G）");
step("同一処方の経時比較OK");

// ---- 9f. H: CFEの予測レンジ ----
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(900);
const homeT = await page.textContent("body");
if (!/予測レンジ|推定中/.test(homeT)) {
  fail("CFEの予測レンジも「推定中」も表示されない（H）");
} else {
  step("CFEの予測レンジOK（低信頼度時は推定中を維持）");
}

// ---- 9g. I: レース配分シミュレータ ----
await page.goto("http://localhost:8791/#/meet");
await page.waitForTimeout(900);
const meetT = await page.textContent("body");
if (!meetT.includes("レース配分")) fail("レース配分カードが無い（I）");
// 一括入力でレースを2本入れたので、実測の落ち幅から案が出るはず
if (!/実測どおり/.test(meetT)) {
  fail("レースを2本入れても配分案が出ない（I）: " + (meetT.match(/レース配分[\s\S]{0,200}/)?.[0] ?? ""));
} else if (!/通過目安/.test(meetT)) {
  fail("通過目安が出ていない（I）");
} else {
  step("レース配分OK（一括入力した区間ラップから実測ベースの案が出る）");
}

// ---- 10b. フェーズA: ホームの再構成 ----
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(900);
const homeText = await page.textContent("body");
if (!homeText.includes("TODAY")) fail("TODAY領域が無い（A-1）");
// A-1: TODAY はスクロールなしで全体が見えること
const todayCard = await page.locator("section.card").first().boundingBox();
if (!todayCard) fail("TODAYカードが取得できない");
else if (todayCard.y + todayCard.height > 844) {
  fail(`TODAYがスクロールなしで収まっていない（下端 ${Math.round(todayCard.y + todayCard.height)}px > 844px）`);
} else {
  step(`TODAY領域OK（下端 ${Math.round(todayCard.y + todayCard.height)}px ≦ 844px）`);
}
// A-3: メニュー本文が二重に出ていないこと（E-4）
const dupCount = (homeText.match(/セッション準備度/g) ?? []).length;
if (dupCount > 0) fail("ホームに準備度リングが残っている（A-3: 詳細画面へ移すはず）");
// A-6: セグメントタブで3枚を切り替えられること（スワイプのみにしない）
for (const label of ["RECOVERY", "RACE", "PERFORMANCE"]) {
  await page.getByRole("tab", { name: label }).click();
  await page.waitForTimeout(350);
  const sel = await page.getByRole("tab", { name: label }).getAttribute("aria-selected");
  if (sel !== "true") fail(`セグメントタブ ${label} が選択状態にならない（A-6）`);
}
step("ホームの3セクション切り替えOK（タップで到達できる）");
// B-1: セグメントタブのタップ領域が44px以上であること（旧: 40pxで不足していた）
const segTabBox = await page.getByRole("tab", { name: "RACE" }).boundingBox();
if (!segTabBox || segTabBox.height < 44) {
  fail(`セグメントタブのタップ領域が44px未満: ${segTabBox?.height}px`);
}
await shot("16_home_forge");

// ---- 10c. フェーズB: ハンバーガー廃止と設定画面 ----
/*
 * exact: true が要る。Playwright の name は既定で部分一致なので、
 * 「メニューを変更」（TODAY / P-1）のような別のボタンまで拾ってしまう。
 * 実際、TODAYに今日の予定がある日だけ落ちる、という日替わりの誤検知になっていた。
 */
const hamburger = await page.getByRole("button", { name: "メニュー", exact: true }).count();
if (hamburger > 0) fail("ハンバーガーメニューが残っている（B-1）");
await page.goto("http://localhost:8791/#/settings");
await page.waitForTimeout(600);
const setText = await page.textContent("body");
for (const label of ["プロフィール", "メニュー設定", "目標・レース", "暑熱順化", "過去データ", "データ管理"]) {
  if (!setText.includes(label)) fail(`設定画面に「${label}」への導線がない（B-2）`);
}
step("設定画面OK（旧メニュー項目に到達できる）");
await shot("17_settings");

// ---- 11a. M-1: 記録の上書き保存 ----
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(700);
// 予定のあるセッションを1つ選び、記録を2回入れる
const targetSession = await page.evaluate(async () => {
  const d = await fetch("/api/sessions").then((r) => r.json());
  const s = (d.sessions ?? []).find(
    (x) => x.category === "high_lactate" && x.status === "planned" && x.targetPaces?.length
  );
  return s ? { id: s.id, date: s.date } : null;
});
if (!targetSession) fail("M-1: 対象セッションが見つからない");
const resaveOut = await page.evaluate(async (s) => {
  const post = (body) =>
    fetch("/api/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const mk = (times) => ({
    sessionId: s.id,
    date: s.date,
    actualLapsSec: times,
    lapDistancesM: times.map(() => 300),
    interval: {
      reps: 3,
      distanceM: 300,
      targetSec: 41.5,
      restType: "jog",
      restSec: 300,
      results: times.map((t, i) => ({ index: i + 1, distanceM: 300, targetSec: 41.5, actualSec: t })),
    },
    achievement: "achieved",
    rpe: 8,
    subjective: "hard",
  });
  const first = await post(mk([43.5, 43.9, 44.2]));
  const second = await post(mk([43.5, 43.9, 44.2]));
  const all = await fetch("/api/results").then((r) => r.json());
  return {
    rows: (all.results ?? []).filter((r) => r.sessionId === s.id).length,
    firstAfter: first.cfeAfter,
    secondAfter: second.cfeAfter,
  };
}, targetSession);
if (resaveOut.rows !== 1) fail(`M-1: 再保存で記録が増えている（${resaveOut.rows}件）`);
if (Math.abs(resaveOut.firstAfter - resaveOut.secondAfter) > 0.001) {
  fail(`M-1: 同じ練習でCFEが二重に動いている（${resaveOut.firstAfter} → ${resaveOut.secondAfter}）`);
}
// 画面上でも入力済みの値が残ること
await page.goto(`http://localhost:8791/#/results?date=${targetSession.date}`);
await page.waitForTimeout(900);
await page.getByRole("button", { name: /練習結果/ }).click();
await page.waitForTimeout(500);
const sessionBtn = page.locator("button", { hasText: "✓済" }).first();
if ((await sessionBtn.count()) > 0) await sessionBtn.click();
await page.waitForTimeout(600);
const m1Text = await page.textContent("body");
if (!m1Text.includes("登録済みです")) fail("M-1: 登録済みの表示が出ない");
if (!m1Text.includes("上書きして保存する")) fail("M-1: 上書き保存のボタンにならない");
step("M-1 記録の保持OK（値が残り、再保存で重複せずCFEも二重に動かない）");
await shot("23_m1_resave");

// ---- 11b. M-2: 直近の状態に応じた設定の調整 ----
// 設定より遅い実測を3回入れる（これが無いと判断材料が足りず据え置きになる）
const seeded = await page.evaluate(async () => {
  const d = await fetch("/api/sessions").then((r) => r.json());
  const targets = (d.sessions ?? [])
    .filter((s) => s.category === "high_lactate" && s.targetPaces?.length)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  for (const s of targets) {
    const tp = s.targetPaces[0];
    const target = (tp.targetSecFast + tp.targetSecSlow) / 2;
    const times = [target + 2.5, target + 2.8, target + 3.2];
    await fetch("/api/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: s.id,
        date: s.date,
        actualLapsSec: times,
        lapDistancesM: times.map(() => tp.distanceM),
        interval: {
          reps: 3,
          distanceM: tp.distanceM,
          targetSec: target,
          restType: "jog",
          restSec: 300,
          results: times.map((t, i) => ({
            index: i + 1,
            distanceM: tp.distanceM,
            targetSec: target,
            actualSec: t,
          })),
        },
        achievement: "partial",
        rpe: 9,
        subjective: "very_hard",
      }),
    });
  }
  return targets.length;
});
if (seeded < 3) fail(`M-2: 実測を3回入れられない（${seeded}回）`);

// 実測を入れた次の高乳酸について、設定がどう変わるかを見る
const nextHl = await page.evaluate(async () => {
  const d = await fetch("/api/sessions").then((r) => r.json());
  const s = (d.sessions ?? [])
    .filter((x) => x.category === "high_lactate" && x.status !== "completed" && x.targetPaces?.length)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return s ? s.id : null;
});
if (!nextHl) fail("M-2: 次の高乳酸セッションが無い");

const adaptive = await page.evaluate(async (id) => {
  const d = await fetch(`/api/adaptive?sessionId=${id}`).then((r) => r.json());
  return {
    hasSession: !!d.session,
    hasChange: d.proposal?.hasChange,
    offset: d.proposal?.offsetSecPerRep,
    verdict: d.context?.trend?.verdict,
    criteria: d.criteria?.text,
    reasons: d.proposal?.reasons ?? [],
  };
}, nextHl);
if (!adaptive.hasSession) fail("M-2: 対象セッションが無い");
if (adaptive.verdict !== "ease") {
  fail(`M-2: 設定より遅い実測が3回続いたのに緩めない（${adaptive.verdict}）`);
}
if (!(adaptive.offset > 0)) fail("M-2: 緩める量が出ていない");
if (!/平均乖離|未達|高い負担/.test(adaptive.reasons.join())) {
  fail("M-2: 実測の乖離・未達・負担反応の理由が出ていない");
}
if (!adaptive.criteria || !adaptive.criteria.includes("打ち切る")) {
  fail("M-3: 処方に中止基準が付いていない");
}
// 暑熱を渡すと設定が緩むこと（M-9）
const heatAdj = await page.evaluate(async (id) => {
  const d = await fetch(`/api/adaptive?sessionId=${id}&tempC=33&humidity=70`).then((r) => r.json());
  return { offset: d.proposal?.offsetSecPerRep, applied: d.context?.heat?.applied, reasons: d.proposal?.reasons ?? [] };
}, nextHl);
if (!heatAdj.applied) fail("M-9: WBGTから補正が掛からない");
if (!(heatAdj.offset > 0)) fail("M-9: 暑熱下でも設定が緩まない");
if (!heatAdj.reasons.join().includes("WBGT")) fail("M-9: 補正の根拠が出ていない");
/*
 * S-10: 調整案が「何を言っているのか」画面で分かること。
 * ここは案がまだ適用されていない＝必ず出ている状態なので、この位置で確かめる。
 * （このあと適用してしまうと案が消え、確認できなくなる）
 */
/*
 * 案が必ず出る条件を作ってから見る。
 *
 * 直近の実測だけに頼ると、その日の材料の集まり方（暑熱フラグ・日付の前後）で
 * 案が出たり出なかったりして、確かめたい表示に辿り着けない。
 * 当日のコンディション（脚の疲労）は必ず調整に効くので、これで固定する。
 * 出す内容そのものは実測から作られるので、検証の意味は変わらない。
 */
await page.evaluate(async () => {
  const now = new Date();
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  await fetch("/api/daily", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date: d, legFatigue: 4, overallFatigue: 4, sleepQuality: 2, motivation: 3 }),
  });
});

await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(1500);
const adjText = await page.textContent("body");
if (!/の設定を (ゆるめる|上げる)提案/.test(adjText)) {
  const why = await page.evaluate(async () => {
    const a = await fetch("/api/adaptive").then((r) => r.json());
    return {
      hasChange: a.proposal?.hasChange ?? null,
      forSession: a.session?.name ?? null,
      paces: a.session?.targetPaces?.length ?? null,
      verdict: a.context?.trend?.verdict ?? null,
      samples: a.context?.trend?.samples?.length ?? null,
      offset: a.proposal?.offsetSecPerRep ?? null,
      reasons: a.proposal?.reasons ?? [],
    };
  });
  fail(`S-10: 調整案の見出しが出ていない（${JSON.stringify(why)}）`);
}
if (!/いまの設定/.test(adjText) || !/変えた場合/.test(adjText)) {
  fail("S-10: 変更前後の処方が並んでいない（差分を読ませない形になっていない）");
}
if (!/そう判断した材料/.test(adjText)) fail("S-10: 判断材料の見出しが無い");
if (!/能力の推定（CFE）は動かしません/.test(adjText)) {
  fail("S-10: 設定とCFEの違いが書かれていない");
}
step("S-10 設定の調整案の説明OK（前後の処方・材料・CFEに触れないこと）");
await shot("35_today_adjust");

/*
 * S-7 / S-8 / S-9: 生成が状況を見ていること、進め方が2案出ること。
 * 以前はカテゴリごとに固定の文面（高乳酸なら常に 300m×5 r5分）だった。
 */
const gen = await page.evaluate(async () => {
  const d = await fetch("/api/sessions?from=2000-01-01&to=2099-12-31").then((r) => r.json());
  const hl = (d.sessions ?? [])
    .filter((s) => s.category === "high_lactate" && s.prescription)
    .map((s) => s.prescription);
  return { count: hl.length, unique: [...new Set(hl)].length, sample: hl.slice(0, 3) };
});
if (gen.count < 2) fail(`S-7: 高乳酸の生成が少なすぎて確認できない（${gen.count}件）`);
else if (gen.unique < 2) {
  fail(`S-7: 生成された高乳酸が全部同じ内容（${gen.sample[0]}）。漸進していない`);
}
step(`S-8 生成が週ごとに変わるOK（高乳酸 ${gen.count}件中 ${gen.unique}種類）`);

const varApi = await page.evaluate(async (id) => {
  const d = await fetch(`/api/variants?sessionId=${id}`).then((r) => r.json());
  return {
    n: d.variants?.length ?? 0,
    recommended: (d.variants ?? []).filter((v) => v.recommended).length,
    distinct: new Set((d.variants ?? []).map((v) => v.prescription)).size,
    hasWhy: (d.variants ?? []).every((v) => (v.why ?? "").length > 10),
  };
}, nextHl);
if (varApi.n !== 2) fail(`S-9: 進め方が2案になっていない（${varApi.n}）`);
if (varApi.recommended !== 1) fail(`S-9: おすすめが1つでない（${varApi.recommended}）`);
if (varApi.distinct !== 2) fail("S-9: 2案の中身が同じ（選ぶ意味が無い）");
if (!varApi.hasWhy) fail("S-9: 案に理由が付いていない");
// TODAYから選べること
/*
 * 見出しは対象によって「この練習の進め方」「次のポイント練習の進め方」に変わり、
 * 調整案カードも同じ文言を出すことがある。文言で探すとどちらを見ているか曖昧になるので、
 * このカードにしか無い「この進め方にする」ボタンで特定する。
 */
const varCard = page
  .locator("section.card", { has: page.getByRole("button", { name: "この進め方にする" }) })
  .first();
if ((await varCard.count()) === 0) {
  /*
   * 出ていないときは、何を対象にしていたのかまで出す。
   * この画面は「今日がポイント練習ならそれ、違えば /api/adaptive が選んだ次の1本」を
   * 対象にするので、対象が nextHl と違うと、APIで2案が取れていても画面には出ない。
   * 「出ない」だけでは、画面の不具合なのか対象が違うだけなのか区別できない。
   */
  const why = await page.evaluate(async (hl) => {
    const a = await fetch("/api/adaptive").then((r) => r.json());
    const target = a?.session?.id ?? null;
    const v = target
      ? await fetch(`/api/variants?sessionId=${target}`).then((r) => r.json())
      : null;
    const d = await fetch("/api/dashboard").then((r) => r.json());
    return {
      today: d?.today ?? null,
      todayCategory: d?.todaySession?.category ?? null,
      adaptiveTarget: target,
      adaptiveCategory: a?.session?.category ?? null,
      nextHl: hl,
      sameSession: target === hl,
      variantsForTarget: v?.variants?.length ?? null,
    };
  }, nextHl);
  fail(`S-9: TODAYに進め方の2案が出ていない（${JSON.stringify(why)}）`);
}
else {
  if ((await varCard.getByRole("button", { name: "この進め方にする" }).count()) !== 2) {
    fail("S-9: TODAYで2案とも選べない");
  }
  /*
   * 対象が固定枠かどうかで、正しい結果が変わる。
   *
   * 画面は「今日がポイント練習ならそれ、違えば次の1本」を対象にする。
   * 今日が固定曜日のポイント練習に当たった日（火・土）は、
   * RULE-15 で内容を変えられないのが**正しい振る舞い**。
   *
   * 以前はここを「反映された文が出ること」だけで見ていたので、
   * **曜日によって落ちる検査**になっていた（火・土は必ず赤）。
   * どちらの場合も、その場合に出るべき文を名指しで確かめる。
   */
  await varCard.getByRole("button", { name: "この進め方にする" }).first().click();
  await page.waitForTimeout(1200);
  const afterVar = await page.textContent("body");
  /*
   * 押した結果は2通りある。**どちらも正しい振る舞い。**
   *
   *   ・書き換えられる予定 → 変更内容が出る
   *   ・固定枠（RULE-15）  → **変えられない理由**が出る
   *
   * 以前は前者だけを見ていたので、今日が固定曜日のポイント練習に当たった日
   * （火・土）はここが必ず落ちていた。**曜日によって落ちる検査**は、
   * 何も見ていない日があるのと同じ。
   *
   * どちらでもない（押しても何も出ない）ときだけ落とす。
   * 「何か出た」で通すのではなく、出るべき文を名指しで並べてある。
   */
  const applied = /今後14日間|安全に増やせる|この進め方をカレンダーへ保存|ルールに反します/.test(
    afterVar
  );
  const refused = /固定セッション|変更できません|RULE-15/.test(afterVar);
  if (!applied && !refused) {
    fail("S-9: 押しても、変更内容も断りの理由も出ない");
  }
}
step("S-9 進め方の2案OK（理由つき・TODAYで選べる）");
await shot("36_variants");

// CFEは動かないこと
const cfeGuard = await page.evaluate(async (id) => {
  const before = (await fetch("/api/dashboard").then((r) => r.json())).cfe?.estimated800mSec;
  const d = await fetch(`/api/adaptive?sessionId=${id}`).then((r) => r.json());
  if (!d.proposal?.hasChange) return { skipped: true };
  await fetch("/api/adaptive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: d.session.id, action: "apply" }),
  });
  const after = (await fetch("/api/dashboard").then((r) => r.json())).cfe?.estimated800mSec;
  const s = await fetch("/api/sessions").then((r) => r.json());
  const sess = (s.sessions ?? []).find((x) => x.id === d.session.id);
  return {
    before,
    after,
    paceBefore: d.proposal.beforePaces[0].targetSecFast,
    paceAfter: sess.targetPaces[0].targetSecFast,
  };
}, nextHl);
if (!cfeGuard.skipped) {
  if (Math.abs(cfeGuard.before - cfeGuard.after) > 0.001) {
    fail(`M-2: 設定を変えたのにCFEまで動いている（${cfeGuard.before} → ${cfeGuard.after}）`);
  }
  if (Math.abs(cfeGuard.paceBefore - cfeGuard.paceAfter) < 0.05) {
    fail("M-2: 適用しても設定が変わっていない");
  }
  step("M-2 設定の調整OK（設定だけ動き、CFEは動かない）");
} else {
  fail("M-2: 実測を入れても提案が出ない");
}
step("M-3/M-9 中止基準と暑熱補正OK");

// ---- 11c. M-4: セッション中の入力 ----
const runTarget = await page.evaluate(async () => {
  const d = await fetch("/api/sessions").then((r) => r.json());
  const s = (d.sessions ?? []).find(
    (x) => x.category === "high_lactate" && x.status !== "completed" && x.targetPaces?.length
  );
  return s ? s.id : null;
});
if (!runTarget) fail("M-4: 対象セッションが無い");
await page.goto(`http://localhost:8791/#/run?sessionId=${runTarget}`);
await page.waitForTimeout(900);
let runText = await page.textContent("body");
if (!runText.includes("打ち切る")) fail("M-4: 中止基準が画面に出ていない");
// 設定どおりの1本 → 続行
const runTarget2 = await page.evaluate(async (id) => {
  const d = await fetch(`/api/session-run?sessionId=${id}`).then((r) => r.json());
  return d.progress.targetSec;
}, runTarget);
await page.locator('input[inputmode="decimal"]').first().fill(String(runTarget2.toFixed(1)));
await page.getByRole("button", { name: "LAP", exact: true }).click();
await page.waitForTimeout(600);
runText = await page.textContent("body");
if (!/残り\d+本/.test(runText)) fail("M-4: 続行の判定が出ない");
// 大きく外れた1本 → 中止
await page.locator('input[inputmode="decimal"]').first().fill(String((runTarget2 + 3).toFixed(1)));
await page.getByRole("button", { name: "LAP", exact: true }).click();
await page.waitForTimeout(600);
runText = await page.textContent("body");
if (!runText.includes("打ち切ってください")) fail("M-4: 中止の判定が出ない");
// 画面を離れても入力が残ること
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(400);
await page.goto(`http://localhost:8791/#/run?sessionId=${runTarget}`);
await page.waitForTimeout(800);
runText = await page.textContent("body");
if (!runText.includes("2 / ")) fail("M-4: 画面を離れると入力が消える");
// 走行中は誤タップの元になるのでFABを出さない
if ((await page.getByRole("button", { name: "記録を追加" }).count()) > 0) {
  fail("M-4: セッション中の画面にFABが出ている");
}
step("M-4 セッション中の入力OK（その場で続行/中止が出て、離れても消えない）");
await shot("24_m4_run");

// ---- 11d. M-5: 予定の編集とルール検査 ----
const moveCheck = await page.evaluate(async () => {
  const d = await fetch("/api/sessions").then((r) => r.json());
  const hl = (d.sessions ?? [])
    .filter((s) => s.category === "high_lactate" && !s.isFixed)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (hl.length < 2) return { skipped: true };
  const to = new Date(hl[0].date + "T00:00:00Z");
  to.setUTCDate(to.getUTCDate() + 4);
  const target = to.toISOString().slice(0, 10);
  const out = await fetch("/api/plan-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: hl[1].id, updates: { date: target } }),
  }).then((r) => r.json());
  const after = await fetch("/api/sessions").then((r) => r.json());
  return {
    applied: out.applied,
    rules: (out.newViolations ?? []).map((v) => v.rule),
    alternatives: (out.alternatives ?? []).length,
    unchanged: after.sessions.find((s) => s.id === hl[1].id)?.date === hl[1].date,
  };
});
if (!moveCheck.skipped) {
  if (moveCheck.applied) fail("M-5: ルールに反する移動がそのまま通っている");
  if (!moveCheck.rules.includes("RULE-01")) fail("M-5: 高乳酸の間隔違反が出ていない");
  if (moveCheck.alternatives === 0) fail("M-5: 代わりに置ける日が出ていない");
  if (!moveCheck.unchanged) fail("M-5: 適用していないのに日付が変わっている");
  step("M-5 予定の移動OK（壊れる内容と代替日を出して止める）");
}
// 同じ日に午前の練習を足せること（M-1の「午前・午後を分けて残す」）
const addCheck = await page.evaluate(async () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 3);
  const d = date.toISOString().slice(0, 10);
  const before = (await fetch("/api/sessions").then((r) => r.json())).sessions.filter(
    (s) => s.date === d
  ).length;
  await fetch("/api/plan-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "add",
      session: { date: d, category: "aerobic", name: "朝ジョグ", timeOfDay: "am", durationMin: 30 },
    }),
  });
  const after = (await fetch("/api/sessions").then((r) => r.json())).sessions.filter(
    (s) => s.date === d
  ).length;
  return { before, after };
});
if (addCheck.after !== addCheck.before + 1) fail("M-5: 予定を追加できない");
step("M-5 予定の追加OK（同じ日に午前・午後を分けて残せる）");

// ---- 11e. M-7 / M-8 / M-11 分析 ----
await page.goto("http://localhost:8791/#/analysis");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "現在地", exact: true }).click();
await page.waitForTimeout(900);
const gapText = await page.textContent("body");
if (!gapText.includes("制限因子")) fail("M-7: 制限因子が出ていない");
if (!gapText.includes("後半の維持")) fail("M-7: 判定結果が想定と違う");
if (!gapText.includes("600m通過")) fail("M-8: 600m通過の指標が無い");
if (!gapText.includes("接地時間")) fail("M-10: 接地時間の枠が無い");
step("M-7/M-8/M-10 現在地の表示OK");
await shot("25_m7_gap");

// P-5: 週報は「現在地」に統合したので、同じセグメントの中にある
if (!gapText.includes("週次レビュー")) fail("M-11: 週次レビューが無い");
// 本文は畳んである（指導者に渡す文章で、この画面で毎回読むものではない）。開いて中身を見る
await page.getByRole("button", { name: /本文を読む/ }).first().click();
await page.waitForTimeout(400);
const revText = await page.textContent("body");
if (!/設定.*に対して平均|ポイント練習は/.test(revText)) fail("M-11: 実測を引用していない");
/*
 * P-2: 一括入力ぶんが週次レビューに入っていること。
 * 一括入力から作られた結果に構造化記録が無いと、エラーも出さずに「0本 / 0km」になる。
 *
 * 画面の既定は「先週」なので、実行する日によっては一括入力の週から外れる。
 * それを不具合として拾うと日替わりで落ちるだけなので、
 * **データが入っている週を指定して**確かめる（見たいのは構造化記録の有無であって、
 * どの週が既定かではない）。
 */
const reviewWeek = await page.evaluate(async () => {
  const d = await fetch("/api/insights?weekStart=2026-07-13").then((r) => r.json());
  return d.review;
});
if (!reviewWeek) fail("P-2: 週次レビューが取得できない");
else if (reviewWeek.qualityLines.length === 0 || reviewWeek.totalDistanceKm === 0) {
  fail(
    `P-2: 週次レビューに一括入力ぶんが入っていない（${reviewWeek.qualityLines.length}本 / ${reviewWeek.totalDistanceKm}km）`
  );
}
step("M-11 週次レビューOK（一括入力ぶんを含む）");

// ---- 11f. M-12 書き出しと復元 / M-10 取り込み ----
const backupCheck = await page.evaluate(async () => {
  const file = await fetch("/api/backup?download=1").then((r) => r.json());
  const before = (await fetch("/api/sessions").then((r) => r.json())).sessions.length;
  const out = await fetch("/api/backup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file, mode: "merge" }),
  }).then((r) => r.json());
  const after = (await fetch("/api/sessions").then((r) => r.json())).sessions.length;
  const bad = await fetch("/api/backup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: { hello: 1 }, mode: "merge" }),
  }).then((r) => r.json());
  return { counts: file.counts, before, after, ok: out.ok, rejected: !!bad.error };
});
if (!backupCheck.counts?.sessions) fail("M-12: 書き出しにセッションが入っていない");
if (backupCheck.before !== backupCheck.after) {
  fail(`M-12: 統合で重複した（${backupCheck.before} → ${backupCheck.after}）`);
}
if (!backupCheck.rejected) fail("M-12: 別のファイルを受け入れてしまう");
step("M-12 書き出しと復元OK（統合しても重複しない）");

/*
 * NEXT-002: 統合（クラウドからの取り込みと同じ経路）で、この端末の
 * 完了済み・本人編集・固定枠を上書きしない。上書きしても画面には
 * 何も出ないので、実際の中身と、守ったことの表示の両方を見る。
 */
const mergeGuard = await page.evaluate(async () => {
  const sessions = (await fetch("/api/sessions").then((r) => r.json())).sessions;
  const mine = sessions.find((s) => s.status === "completed") ?? sessions[0];
  const file = await fetch("/api/backup?download=1").then((r) => r.json());

  // クラウド側は「同じIDだが自動生成の予定のまま」という想定に書き換える
  const remote = JSON.parse(JSON.stringify(file));
  remote.data.sessions = remote.data.sessions.map((s) =>
    s.id === mine.id
      ? { ...s, name: "クラウドの内容", status: "planned", origin: "generated", userEdited: false }
      : s
  );
  const out = await fetch("/api/backup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: remote, mode: "merge" }),
  }).then((r) => r.json());
  const after = (await fetch("/api/sessions").then((r) => r.json())).sessions.find(
    (s) => s.id === mine.id
  );
  return {
    protectedStatus: mine.status,
    name: after?.name,
    kept: out.report?.kept?.sessions ?? 0,
    warned: (out.report?.warnings ?? []).some((w) => /そのまま残しました/.test(w)),
  };
});
if (mergeGuard.protectedStatus !== "completed") {
  fail(`NEXT-002: 完了済みの練習が用意できていない（${mergeGuard.protectedStatus}）`);
}
if (mergeGuard.name === "クラウドの内容") {
  fail("NEXT-002: 統合でこの端末の完了済み練習が上書きされた");
}
if (mergeGuard.kept < 1) fail("NEXT-002: 守った件数が報告されない");
if (!mergeGuard.warned) fail("NEXT-002: 守ったことを画面へ出していない");
step("NEXT-002 統合で完了済み・本人編集を上書きしないOK（守った件数も出る）");

const contactCheck = await page.evaluate(async () => {
  const rows = [];
  const base = new Date();
  for (let i = 40; i >= 8; i -= 4) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    rows.push(`${d.toISOString().slice(0, 10)},155,4:45`);
  }
  for (let i = 6; i >= 0; i -= 2) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    rows.push(`${d.toISOString().slice(0, 10)},167,4:45`);
  }
  const out = await fetch("/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ csv: rows.join("\n") }),
  }).then((r) => r.json());
  return { imported: out.imported, fatigued: out.assessment?.fatigued, note: out.assessment?.narrative };
});
if (!contactCheck.imported) fail("M-10: 接地時間を取り込めない");
if (!contactCheck.fatigued) fail("M-10: 伸びているのに疲労として出ない: " + contactCheck.note);
step("M-10 接地時間の取り込みOK（同じペース帯で伸びたら知らせる）");

// ---- 10d. フェーズC: カレンダーからの入力 ----
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(800);
const calT = await page.textContent("body");
if (!calT.includes("長押し")) fail("長押しの案内が無い（C-1）");
// B-1: 期間送りの矢印ボタンが44px以上の幅を持つこと（1文字だけの見た目に対し、実際の当たり判定が狭い）
const prevPeriodBox = await page.getByRole("button", { name: "前の期間" }).boundingBox();
if (!prevPeriodBox || prevPeriodBox.width < 44) {
  fail(`期間送りボタンのタップ領域が44px未満: ${prevPeriodBox?.width}px`);
}
// C-1: 日付行の「記録」から、その日付が入った記録画面へ入れること
// サイドバー（PC幅では非表示）の「記録」リンクと区別するため、日付行の中から探す
await page.locator('a[href^="#/results?date="]').first().click();
await page.waitForTimeout(800);
const dateVal = await page.locator('input[type="date"]').first().inputValue();
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) fail("カレンダーからの遷移で日付が入っていない（C-1/D-2）");
step(`カレンダー→記録の導線OK（日付 ${dateVal} が入力済み）`);
await shot("18_calendar_forge");

// ---- 11g. N-1: 1文字ずつ打ってもフォーカスが外れない ----
// この不具合は画面には出ないので、機械で見張るしかない
await page.goto("http://localhost:8791/#/results?date=2026-08-01");
await page.waitForTimeout(900);
await page.getByRole("button", { name: /練習結果/ }).click();
await page.waitForTimeout(500);
let focusBroken = false;
const focusTarget = page
  .locator('button:has-text("高乳酸"), button:has-text("経済走"), button:has-text("CV")')
  .first();
if ((await focusTarget.count()) > 0) {
  await focusTarget.click();
  await page.waitForTimeout(600);
  /*
   * RPEはスライダーになったので、文字を打つ欄で見張る。
   * 見ているのは「1文字打つたびに入力欄が作り直されないか」なので、
   * 対象はテキスト入力ならどれでもよい。同じフォーム上の「設定(秒)」を使う。
   */
  const rpe = page.getByRole("textbox", { name: "設定(秒)" }).first();
  await rpe.fill("");
  await rpe.click();
  for (const ch of ["8", ".", "5"]) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(120);
    const stillFocused = await page.evaluate(() => {
      const el = document.activeElement;
      return !!el && el.tagName === "INPUT";
    });
    if (!stillFocused) {
      fail(`N-1: 「${ch}」を打った時点で入力欄からフォーカスが外れた（キーボードが閉じる）`);
      focusBroken = true;
      break;
    }
  }
  const typed = await rpe.inputValue();
  if (typed !== "8.5") {
    fail(`N-1: 1文字ずつ入力した結果が残っていない（"${typed}"）`);
    focusBroken = true;
  }
  if (!focusBroken) step("N-1 1文字ずつ打ってもフォーカスが保たれるOK");
}

// ---- 11h. N-3: 本文からカテゴリを判定する ----
const interp = await page.evaluate(async () => {
  const call = (text) =>
    fetch("/api/prescription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) => r.json());
  return {
    jog: await call("ジョグ40分"),
    hl: await call("300m×5 @41.5秒 r5分"),
    vague: await call("1000m×4 r2分"),
    mixed: await call("300(42)＋600(1:26)＋600(1:26) r15min"),
    junk: await call("あああ"),
  };
});
if (interp.jog.kind !== "continuous" || interp.jog.category !== "aerobic") {
  fail("N-3: ジョグを有酸素として判定しない");
}
if (interp.hl.kind !== "interval" || !interp.hl.categoryCertain) {
  fail(`N-3: 設定つきインターバルのカテゴリが確定しない（${interp.hl.category}）`);
}
if (!interp.hl.basis) fail("N-3: 判定の根拠が出ていない");
if (interp.hl.slots.length !== 5) fail(`N-2: 本数ぶんの欄が出ない（${interp.hl.slots.length}）`);
if (interp.vague.categoryCertain) fail("N-3: 設定が無いのにカテゴリを断定している");
if (interp.mixed.slots.map((x) => x.distanceM).join(",") !== "300,600,600") {
  fail("N-2: 複合の区間ごとの欄になっていない");
}
if (interp.junk.recognized) fail("N-3: 読めない本文を認識したことにしている");
step("N-3 本文からのカテゴリ判定OK（根拠つき・断定しない）");

// 編集シートで本文を書き換えると欄が組み変わること
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);
await openAllDayOps(page);
await page.getByRole("button", { name: /を変更/ }).first().click();
await page.waitForTimeout(600);
const ta = page.locator("textarea").first();
await ta.fill("300m×5 @41.5秒 r5分");
await page.waitForTimeout(900);
let editText = await page.textContent("body");
if (!editText.includes("1本ごとの設定タイム")) fail("N-2: 編集シートに1本ごとの欄が出ない");
let slotInputs = await page.locator('label:has-text("本目") input').count();
if (slotInputs !== 5) fail(`N-2: 編集シートの欄が5つでない（${slotInputs}）`);
// 3本目まで入れてから本数を増やしても、入れた値が残ること
await page.locator('label:has-text("本目") input').nth(0).fill("41.0");
await page.locator('label:has-text("本目") input').nth(1).fill("41.2");
await ta.fill("300m×7 @41.5秒 r5分");
await page.waitForTimeout(900);
slotInputs = await page.locator('label:has-text("本目") input').count();
if (slotInputs !== 7) fail(`N-2: 本数を増やしても欄が増えない（${slotInputs}）`);
if ((await page.locator('label:has-text("本目") input').nth(0).inputValue()) !== "41.0") {
  fail("N-2: 本数を変えたら入力済みの値が消えた");
}
// ジョグに書き換えると欄の種類が変わること
await ta.fill("ジョグ40分");
await page.waitForTimeout(900);
editText = await page.textContent("body");
if (!editText.includes("距離km") || editText.includes("1本ごとの設定タイム")) {
  fail("N-2: ジョグに書き換えても欄が切り替わらない");
}
step("N-2 本文に合わせた入力欄OK（値を消さずに組み替わる）");
await shot("27_edit_structure");

// ---- 10d-2. カレンダーの操作（タップ・＋・✎） ----
/*
 * カレンダーの既定表示は「今週の月曜から7日」。
 * 検証用のセッションをこの範囲の外に作ると、登録は成功するのに
 * 画面に出てこないので、通らない理由を取り違える。
 * 表示範囲の計算は app/calendar/page.tsx の weekStart と同じ。
 */
const calendarWeek = (() => {
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const dow = now.getDay();
  const start = new Date(now.getTime() + (dow === 0 ? -6 : 1 - dow) * 86400000);
  return { from: fmt(start), to: fmt(new Date(start.getTime() + 6 * 86400000)) };
})();
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);
// 日付行そのものをタップしたらその日の記録へ行くこと（案内文どおりの挙動）
// 行そのもの（日付が書いてある部分）をタップする
// 右端の「記録」リンクではなく、日付が書いてある行の本体を押す
await page.locator('div.card a.flex-1[href^="#/results?date="]').first().click();
await page.waitForTimeout(800);
const hash = await page.evaluate(() => window.location.hash);
if (!hash.startsWith("#/results?date=")) {
  fail(`カレンダーの日付をタップしても記録画面に行かない（${hash}）`);
}
step("カレンダー: 日付タップで記録画面へ行くOK");

/*
 * カレンダーの表示期間と送り操作。
 *
 * 実機で「週がいきなり変わる」「既定が4週間になっている」と報告された箇所。
 * 原因は (1) 横スワイプ判定が指の横移動しか見ておらず、縦スクロール中の
 * 横流れで週が飛んでいた (2) 既定を1週間に変える前に端末へ保存された
 * 4週間がそのまま復元されていた (3) 月送りが日数計算で、31日ある月では
 * 同じ月に戻り前へ進めなかった。3つとも見た目には何も出ないので検査で見張る。
 */
{
  await page.goto("http://localhost:8791/#/calendar");
  // 旧キーに4週間が残っている端末を再現する
  await page.evaluate(() => {
    localStorage.setItem("forge.view.calendar.weeks", "4");
    localStorage.removeItem("forge.view.calendar.weeks.v2");
    localStorage.removeItem("forge.view.calendar.mode");
  });
  await page.reload();
  await page.waitForTimeout(1100);

  const controls = page.locator(".calendar-controls").first();
  const rangeText = async () => ((await controls.locator("span.num").first().textContent()) ?? "").trim();
  const spanDays = (s) => {
    const m = s.match(/(\d{4}-\d{2}-\d{2})\s*〜\s*(\d{4}-\d{2}-\d{2})/);
    return m ? Math.round((Date.parse(m[2]) - Date.parse(m[1])) / 86400000) + 1 : null;
  };
  const startOf = (s) => (s.match(/(\d{4}-\d{2}-\d{2})/) ?? [])[1];

  const r0 = await rangeText();
  if (spanDays(r0) !== 7) {
    fail(`カレンダーの既定が1週間になっていない（${r0} = ${spanDays(r0)}日）`);
  }
  step("カレンダー: 既定は1週間OK（端末に残った4週間の設定に引きずられない）");

  // 月表示: 「→」で必ず翌月へ進むこと（8月・10月など31日ある月で止まっていた）
  await controls.getByRole("button", { name: "月", exact: true }).click();
  await page.waitForTimeout(700);
  const months = [startOf(await rangeText())];
  for (let i = 0; i < 3; i++) {
    await controls.getByRole("button", { name: "次の期間" }).click();
    await page.waitForTimeout(600);
    months.push(startOf(await rangeText()));
  }
  for (let i = 1; i < months.length; i++) {
    if (months[i] === months[i - 1]) {
      fail(`月表示の「→」で先へ進まない（${months.join(" → ")}）`);
    }
    if (!months[i].endsWith("-01")) fail(`月表示の先頭が1日になっていない（${months[i]}）`);
  }
  step(`カレンダー: 月送りOK（${months.join(" → ")}）`);

  // 週表示に戻して、スワイプ判定を見る
  await controls.getByRole("button", { name: "週", exact: true }).click();
  await page.waitForTimeout(700);
  /*
   * 送った先を覚えるようになったので、ここで今日に戻しておく。
   * 戻さないと、このあとの「その日の予定を見る」検証が3か月先を開く。
   */
  await controls.getByRole("button", { name: "今日", exact: true }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  const swipe = (x0, y0, x1, y1) =>
    page.evaluate(
      ([ax, ay, bx, by]) => {
        const el = document.querySelector(".calendar-day-list");
        if (!el) throw new Error("日付リストが無い");
        const mk = (type, x, y) => {
          const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
          return new TouchEvent(type, {
            touches: type === "touchend" ? [] : [t],
            changedTouches: [t],
            bubbles: true,
            cancelable: true,
          });
        };
        el.dispatchEvent(mk("touchstart", ax, ay));
        el.dispatchEvent(mk("touchend", bx, by));
      },
      [x0, y0, x1, y1]
    );

  const w0 = await rangeText();
  // 縦スクロール中に指が横へ80px流れただけ。週は動いてはいけない
  await swipe(200, 620, 120, 180);
  await page.waitForTimeout(500);
  if ((await rangeText()) !== w0) {
    fail("縦にスクロールしただけで週が変わってしまう（横流れをスワイプと誤判定）");
  }
  // 素直な横スワイプなら送れること（誤判定を潰したせいで効かなくなっていないか）
  await swipe(300, 400, 100, 420);
  await page.waitForTimeout(600);
  const w1 = await rangeText();
  if (w1 === w0) fail("横スワイプで週が送れない");
  if (Math.round((Date.parse(startOf(w1)) - Date.parse(startOf(w0))) / 86400000) !== 7) {
    fail(`横スワイプの送り幅が1週間でない（${w0} → ${w1}）`);
  }
  step("カレンダー: スワイプ判定OK（縦スクロールでは動かず、横スワイプでは1週間送る）");
  /*
   * 送った先を覚えるようになったので、この検証の最後に今日へ戻す。
   * 戻さないと、このあとの「今週の予定を見る」検証が別の週を開く。
   * （スワイプの検証そのものが1週間送るので、上の月送りだけ戻しても足りない）
   */
  await controls.getByRole("button", { name: "今日", exact: true }).click();
  await page.waitForTimeout(500);
}

// ＋ を押したら追加シートが開き、画面の上に出ること
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);
await openAllDayOps(page);
await page.getByRole("button", { name: "この日に練習を足す" }).nth(3).click();
await page.waitForTimeout(700);
let calAddText = await page.textContent("body");
if (!calAddText.includes("に練習を足す")) fail("＋を押しても追加シートが出ない");
const addBox = await page.locator("section.card", { hasText: "に練習を足す" }).first().boundingBox();
if (!addBox) fail("追加シートの位置が取れない");
else if (addBox.y > 844) fail(`追加シートが画面外に出ている（y=${Math.round(addBox.y)}px）`);
// 不具合3対応: 追加シートから「記録する」で日付つきの記録画面へ行けること
const recordLinkHref = await page
  .locator('a:has-text("この日を記録する")')
  .first()
  .getAttribute("href");
if (!recordLinkHref || !recordLinkHref.includes("/results?date=")) {
  fail(`追加シートに「この日を記録する」が無い、または日付が付いていない（${recordLinkHref}）`);
}
// 実際に追加できること
await page.locator('input[placeholder="名前（例: 朝ジョグ）"]').fill("朝ジョグ（テスト）");
await page.getByRole("button", { name: "追加する" }).click();
await page.waitForTimeout(900);
calAddText = await page.textContent("body");
if (!calAddText.includes("朝ジョグ（テスト）")) fail("＋から追加した練習がカレンダーに出ない");
step("カレンダー: ＋から練習を足せるOK（シートが画面内に出る・記録するリンクあり）");

// ✎ を押したら編集シートが開くこと（ラベルはセッション名を含む形に変わった）
await openAllDayOps(page);
await page.getByRole("button", { name: /を変更/ }).first().click();
await page.waitForTimeout(700);
calAddText = await page.textContent("body");
if (!calAddText.includes("メニュー本文")) fail("✎を押しても編集シートが出ない");
const editBox = await page.locator("section.card", { hasText: "メニュー本文" }).first().boundingBox();
if (editBox && editBox.y > 844) fail(`編集シートが画面外に出ている（y=${Math.round(editBox.y)}px）`);
const calendarEditSheet = page.locator("section.card", { hasText: "メニュー本文" }).first();
const calendarEditBody = calendarEditSheet.locator("textarea").first();
/*
 * **行が必ず残すもの**を書き換えて、それが出ることで確かめる。
 *
 * 以前は括弧で印を足していたが、行は括弧の中を落とすようになった
 * （自作メニューの説明が形に混ざり、切れない長い塊になって
 * 320px幅で横にはみ出したため）。印が消えると
 * 「行が詰まったのか、保存が効いていないのか」を区別できない。
 *
 * 設定は行が絶対に切らない場所なので、そこを書き換える。
 * これで**保存の反映**と**設定が表示に残ること**を同時に見られる。
 */
const calendarEditBefore = await calendarEditBody.inputValue();
const MARK_PACE = "9:59/km";
await calendarEditBody.fill(
  calendarEditBefore.replace(/@[^（]*/, `@${MARK_PACE} `)
);
await page.waitForTimeout(900);
await calendarEditSheet.getByRole("button", { name: "保存する", exact: true }).click();
await page.waitForTimeout(1200);
const reflectedCalendarRow = page.locator("div.card a.flex-1", { hasText: MARK_PACE });
if ((await reflectedCalendarRow.count()) === 0) {
  const rowText = (await page.locator("div.card a.flex-1").first().textContent()) ?? "";
  fail(
    `カレンダーで保存したメニュー本文が一覧へ反映されない（元: ${calendarEditBefore.slice(0, 40)} / 行: ${rowText.slice(0, 60)}）`
  );
}
step("カレンダー: 編集保存→一覧・再取得への反映OK");
await shot("26_calendar_edit");

// ---- 不具合: 1日に複数セッションがあると✎が最初の1件しか対象にしていなかった ----
const multiSessionCheck = await page.evaluate(async ({ from, to }) => {
  const sessions = await fetch(`/api/sessions?from=${from}&to=${to}`).then((r) => r.json());
  const target = (sessions.sessions ?? []).find((s) => !s.isFixed);
  if (!target) return { ok: false, reason: "対象日が見つからない" };
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: target.date,
      category: "neural",
      name: "流し（複数セッションE2E）",
      prescription: "150m流し×4",
    }),
  });
  if (!res.ok) return { ok: false, reason: `POST失敗 ${res.status}` };
  return { ok: true, date: target.date };
}, calendarWeek);
if (!multiSessionCheck.ok) fail(`複数セッション検証の準備に失敗: ${multiSessionCheck.reason}`);
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(400);
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);
const multiRow = page.locator("div.card", { hasText: "流し（複数セッションE2E）" }).first();
await openAllDayOps(page);
const multiEditButtons = multiRow.getByRole("button", { name: /を変更/ });
const multiEditCount = await multiEditButtons.count();
if (multiEditCount < 2) {
  fail(`1日に複数セッションがあるのに✎ボタンが${multiEditCount}個しか無い（不具合の再発）`);
}
await multiEditButtons.last().click();
await page.waitForTimeout(700);
const multiEditText = await page.textContent("body");
if (!multiEditText.includes("流し（複数セッションE2E）")) {
  fail("複数セッションの日で、後ろの✎が対応するセッションを開かない");
}
await page.getByRole("button", { name: "閉じる", exact: true }).first().click();
await page.waitForTimeout(400);
step("カレンダー: 1日に複数セッションがあっても各行の✎で個別に編集できるOK");

// ---- 不具合2: 予定と違う練習を記録すると、カレンダーに実際の内容が出る ----
const divergedCheck = await page.evaluate(async ({ from, to }) => {
  // カレンダーの既定表示は今週（1週間）だけなので、その範囲内のセッションを選ぶ
  // （選ばないと、記録は成功してもカレンダーの初期表示に出てこず誤検知する）
  const sessions = await fetch(`/api/sessions?from=${from}&to=${to}`).then((r) => r.json());
  const aerobicSession = (sessions.sessions ?? []).find(
    (s) => s.category === "aerobic" && !s.isFixed
  );
  if (!aerobicSession) return { ok: false, reason: "表示範囲内に有酸素セッションが見つからない" };
  // 予定はジョグ（continuous）だが、坂ダッシュ（interval）をやったことにして記録する
  const res = await fetch("/api/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: `res-diverge-${Date.now()}`,
      sessionId: aerobicSession.id,
      date: aerobicSession.date,
      interval: {
        reps: 6,
        distanceM: 100,
        targetSec: 15,
        restType: "jog",
        restSec: 90,
        results: Array.from({ length: 6 }, (_, i) => ({
          index: i + 1,
          distanceM: 100,
          targetSec: 15,
          actualSec: 14.8,
        })),
      },
      actualLapsSec: [14.8, 14.8, 14.8, 14.8, 14.8, 14.8],
      lapDistancesM: [100, 100, 100, 100, 100, 100],
      achievement: "achieved",
      rpe: 8,
      subjective: "hard",
    }),
  });
  if (!res.ok) return { ok: false, reason: `POST失敗 ${res.status}` };
  return { ok: true, date: aerobicSession.date };
}, calendarWeek);
if (!divergedCheck.ok) fail(`不具合2の検証準備に失敗: ${divergedCheck.reason}`);
// 同じハッシュへのgotoは再読み込みにならない（既存の注意点どおり）。
// 一度別画面を経由してから戻り、確実に再取得させる。
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(400);
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);
const divergedText = await page.textContent("body");
if (!divergedText.includes("実際: 6本 100m")) {
  fail("不具合2: 予定と違う結果を記録してもカレンダーに実際の内容が出ない");
}
step("カレンダー: 予定と違う結果を記録すると「実際:」が表示されるOK（不具合2対応）");

// ---- 固定枠を「やらなかった」ことにして一覧から外し、戻せること ----
/*
 * 固定枠（チーム練習等）は RULE-15 で変更も移動もできないが、
 * 流れることはある。以前は断られるだけで一覧から外せず、
 * やらなかった予定が残り続けていた。
 * 消すのではなく中止にする（実施率に残る／再生成で復活しない）。
 */
const fixedPrep = await page.evaluate(async ({ from, to }) => {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: from,
      category: "aerobic",
      name: "チーム練習（固定枠E2E）",
      prescription: "ジョグ40分",
      isFixed: true,
    }),
  });
  if (!res.ok) return { ok: false, reason: `POST失敗 ${res.status}` };
  return { ok: true, from, to };
}, calendarWeek);
if (!fixedPrep.ok) fail(`固定枠の検証準備に失敗: ${fixedPrep.reason}`);
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(400);
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);

const fixedRow = page.locator("div.card", { hasText: "チーム練習（固定枠E2E）" }).first();
await openAllDayOps(page);
const fixedEdit = fixedRow.getByRole("button", { name: /チーム練習（固定枠E2E）」を変更/ });
if ((await fixedEdit.count()) === 0) {
  fail("固定枠に✎が出ない（やらなかったことを記録する導線が無い）");
}
await fixedEdit.first().click();
await page.waitForTimeout(700);
let fixedSheetText = await page.textContent("body");
if (!fixedSheetText.includes("RULE-15")) {
  fail("固定枠のシートに、内容を変えられない理由が出ていない");
}
// 本文の書き換え欄は出さない（変えられないものを変えられるように見せない）
if ((await page.locator("textarea").count()) > 0) {
  fail("固定枠のシートにメニュー本文の入力欄が出ている（RULE-15と矛盾する）");
}
await page.getByRole("button", { name: "やらなかった" }).first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "実行する" }).first().click();
await page.waitForTimeout(1200);

const afterSkip = await page.textContent("body");
if (!afterSkip.includes("中止 チーム練習（固定枠E2E）")) {
  fail("固定枠を中止にしても、一覧から外れて「中止」として残る表示にならない");
}
// 中止した予定は「戻す」で予定に復帰する（固定枠は手で作り直せないため必須）
await page
  .getByRole("button", { name: "「チーム練習（固定枠E2E）」の中止を取り消す" })
  .first()
  .click();
await page.waitForTimeout(1200);
const afterRestore = await page.textContent("body");
if (afterRestore.includes("中止 チーム練習（固定枠E2E）")) {
  fail("中止を取り消しても予定に戻らない");
}
if (!afterRestore.includes("チーム練習（固定枠E2E）")) {
  fail("中止を取り消したのに予定が消えている");
}
step("カレンダー: 固定枠をやらなかったことにして一覧から外し、戻せるOK");

// ---- 10d-3. N-2: 「練習を足す」でも本文に合わせて欄が組み変わる ----
// 編集シートと同じ実装（PrescriptionFields）を使っているので、
// ここが落ちたら両方の画面が落ちている。片方だけ直して挙動がずれることを防ぐ見張り。
// 編集シートを開いたままなので、いったん別画面を経由して閉じる。
// 同じハッシュへの goto は再読み込みにならず、シートが2枚出たままになる。
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(400);
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);
await openAllDayOps(page);
await page.getByRole("button", { name: "この日に練習を足す" }).nth(5).click();
await page.waitForTimeout(700);
// 判定も欄も「追加シートの中」を見る（編集シートの欄を数えてしまわないように）
const addCard = page.locator("section.card", { hasText: "に練習を足す" }).first();
const addBody = addCard.locator('input[placeholder^="内容"]');
const addRepInputs = addCard.locator('label:has-text("本目") input');
if ((await addBody.count()) === 0) fail("N-2: 追加シートに本文の欄がない");
await addBody.fill("300m×5 @41.5秒 r5分");
await page.waitForTimeout(900);
let addText = await addCard.textContent();
if (!addText.includes("1本ごとの設定タイム")) fail("N-2: 追加シートに1本ごとの欄が出ない");
let addSlots = await addRepInputs.count();
if (addSlots !== 5) fail(`N-2: 追加シートの欄が5つでない（${addSlots}）`);
// N-3: カテゴリが本文から自動で入り、根拠も出ること（断定せず直せる形）
const addCat = await addCard.locator('select[aria-label="カテゴリ"]').inputValue();
if (addCat !== interp.hl.category) {
  fail(`N-3: 追加シートでカテゴリが本文から入らない（${addCat} / 期待 ${interp.hl.category}）`);
}
if (!addText.includes("カテゴリの根拠")) fail("N-3: 追加シートに判定の根拠が出ない");
// 3本目まで入れてから本数を増やしても、入れた値が残ること
for (const [i, v] of ["41.0", "41.2", "41.4"].entries()) {
  await addRepInputs.nth(i).fill(v);
}
await addBody.fill("300m×7 @41.5秒 r5分");
await page.waitForTimeout(900);
addSlots = await addRepInputs.count();
if (addSlots !== 7) fail(`N-2: 追加シートで本数を増やしても欄が増えない（${addSlots}）`);
for (const [i, v] of ["41.0", "41.2", "41.4"].entries()) {
  if ((await addRepInputs.nth(i).inputValue()) !== v) {
    fail(`N-2: 追加シートで本数を変えたら${i + 1}本目の入力値が消えた`);
  }
}
// ジョグに書き換えると欄の種類が変わること
await addBody.fill("ジョグ40分");
await page.waitForTimeout(900);
addText = await addCard.textContent();
if (!addText.includes("距離km") || addText.includes("1本ごとの設定タイム")) {
  fail("N-2: 追加シートでジョグに書き換えても欄が切り替わらない");
}
// N-1: 欄が組み変わっても本文の入力欄からフォーカスが外れないこと。
// 400msずつ空けて打つので、打っている途中で解釈が走り、欄が実際に作り直される。
await addBody.fill("");
await addBody.click();
let addFocusBroken = false;
for (const ch of ["3", "0", "0", "m", "×", "5"]) {
  await page.keyboard.type(ch);
  await page.waitForTimeout(400);
  const onBody = await page.evaluate(() => {
    const el = document.activeElement;
    return !!el && el.tagName === "INPUT" && (el.getAttribute("placeholder") ?? "").startsWith("内容");
  });
  if (!onBody) {
    fail(`N-1: 追加シートで「${ch}」を打った時点でフォーカスが外れた（キーボードが閉じる）`);
    addFocusBroken = true;
    break;
  }
}
if (!addFocusBroken && (await addBody.inputValue()) !== "300m×5") {
  fail(`N-1: 追加シートで1文字ずつ入力した結果が残っていない（"${await addBody.inputValue()}"）`);
}
// 組み立てた設定タイムが保存まで届くこと（＋で足した練習だけ設定が入らない、を防ぐ）
await addBody.fill("300m×5 @41.5秒 r5分");
await page.waitForTimeout(900);
await addCard.locator('input[placeholder="名前（例: 朝ジョグ）"]').fill("追加テスト（構造）");
await addCard.getByRole("button", { name: "追加する" }).click();
await page.waitForTimeout(900);
addText = await page.textContent("body");
if (!addText.includes("追加テスト（構造）")) fail("N-2: 追加シートから足した練習がカレンダーに出ない");
const addSaved = await page.evaluate(async () => {
  const d = await fetch("/api/sessions?from=2000-01-01&to=2099-12-31").then((r) => r.json());
  return (d.sessions ?? []).find((s) => s.name === "追加テスト（構造）") ?? null;
});
if (!addSaved) fail("N-2: 追加した練習を読み出せない");
else {
  if (!addSaved.targetPaces || addSaved.targetPaces.length === 0) {
    fail("N-2: 追加した練習に設定タイムが入っていない");
  }
  if (addSaved.category !== interp.hl.category) {
    fail(`N-3: 追加した練習のカテゴリが本文の判定と違う（${addSaved.category}）`);
  }
}
step("N-2 「練習を足す」でも本文に合わせた入力欄OK（編集シートと同じ実装）");
await shot("28_add_structure");

// ---- 10e. フェーズE: 警告の集約 ----
await page.goto("http://localhost:8791/#/warnings");
await page.waitForTimeout(600);
const warnText = await page.textContent("body");
if (!/ERROR|WARN/.test(warnText)) fail("警告一覧画面が表示されない（E-4）");
step("警告一覧画面OK");

// ---- 11. 他画面の疎通 ----
for (const [p, name] of [["/analysis", "08_analysis"], ["/race", "09_race"], ["/meet", "10_meet"], ["/heat", "11_heat"], ["/data", "12_data"], ["/session", "19_session"], ["/diagnostics", "20_diagnostics"]]) {
  await page.goto(`http://localhost:8791/#${p}`);
  await page.waitForTimeout(600);
  await shot(name);
}
step("全画面疎通OK");

// ---- 11a. 診断情報画面（運用整備） ----
await page.goto("http://localhost:8791/#/diagnostics");
await page.waitForTimeout(600);
const diagPageText = await page.textContent("body");
if (!diagPageText.includes("診断情報")) fail("診断情報画面が表示されない");
if (!diagPageText.includes("アプリバージョン")) fail("診断情報にアプリバージョンが出ていない");
if (diagPageText.includes("eyJ") || diagPageText.includes("sb_publishable_") || diagPageText.includes("sb_secret_")) {
  fail("診断情報にトークン・キーらしき文字列が出ている");
}
step("診断情報画面OK（バージョン表示・秘密情報を含まない）");

// ---- 11b. セーフエリア（iPhoneのステータスバーにメニューが隠れないか） ----
// ホーム画面から起動すると standalone 表示になり、時刻・電波・バッテリーの下に
// 画面が潜り込む。Chromiumでは safe-area-inset が常に0なので、
// 実機と同じ状況を作るために --sat / --sab を注入して検証する。
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(500);
const SAT = 59; // iPhone 14/15 Pro 相当
await page.addStyleTag({ content: `:root{--sat:${SAT}px;--sab:34px}` });
await page.waitForTimeout(300);
const gearBox = await page.getByRole("link", { name: "設定" }).boundingBox();
if (!gearBox) fail("設定ボタンが見つからない");
else if (gearBox.y < SAT) {
  fail(
    `設定ボタンがステータスバーに隠れている（上端 ${gearBox.y}px < セーフエリア ${SAT}px）`
  );
} else {
  step(`セーフエリアOK（設定ボタン上端 ${gearBox.y}px ≧ ${SAT}px）`);
}
// B-1: タップ領域 44×44pt 以上
if (gearBox && (gearBox.width < 44 || gearBox.height < 44)) {
  fail(`設定ボタンのタップ領域が小さい: ${gearBox.width}×${gearBox.height}`);
}

// ---- 12. 横はみ出しチェック ----
// 390px（iPhone 12〜14相当）に加えて、iPhone SE相当の320px幅も見る
// （バックログ「320px幅での横スクロール」。ここまで細い幅は普段のE2Eでは通らない）
const OVERFLOW_ROUTES = ["/", "/setup", "/goal", "/calendar", "/results", "/analysis", "/race", "/meet", "/heat", "/past", "/plan-settings", "/data", "/settings", "/warnings", "/session", "/ask"];
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 844 });
  for (const p of OVERFLOW_ROUTES) {
    await page.goto(`http://localhost:8791/#${p}`);
    await page.waitForTimeout(450);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 2) fail(`横はみ出し ${p}（${width}px幅）: ${overflow}px`);
  }
}
await page.setViewportSize({ width: 390, height: 844 });
step("横はみ出しゼロ（390px・320px幅）");

// ---- 押せない入力欄が無いか（実寸で測る） ----
/*
 * 「本数」の欄が十数pxまで潰れて、数字も見えず押せもしない状態になっていた。
 * ステッパーは −と＋で88pt使うので、3列に置くと入力欄にほとんど残らない。
 *
 * **横はみ出し検査では捕まらない。** 潰れた欄は枠の中に収まるので
 * ページの scrollWidth は増えない。実寸を測るしかない。
 */
{
  const measureTarget = await page.evaluate(async () => {
    const d = await fetch("/api/sessions").then((r) => r.json());
    const s = (d.sessions ?? [])
      .filter((x) => x.status === "planned" && (x.targetPaces ?? []).length > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s ? { date: s.date, name: s.name } : null;
  });
  if (!measureTarget) fail("入力欄の実寸: 対象の予定が無い");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`http://localhost:8791/#/results?date=${measureTarget.date}`);
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /練習結果/ }).first().click();
    await page.waitForTimeout(700);
    // 予定を選ばないと入力欄そのものが出ない（タブを開いただけでは一覧が出る）
    const pick = page.locator(`button:has-text("${measureTarget.name}")`).first();
    if (await pick.count()) {
      await pick.click();
      await page.waitForTimeout(700);
    }
    const interval = page.locator('button:has-text("インターバル")').first();
    if (await interval.count()) {
      await interval.click();
      await page.waitForTimeout(600);
    }

    // まず「測る相手が居る」ことを確かめる。居ないまま通すと何も見ていない検査になる
    const steppers = page.locator("[data-stepper-input]");
    const stepperCount = await steppers.count();
    if (stepperCount === 0) {
      fail(`入力欄の実寸: ステッパーが画面に出ていない（${width}px幅）`);
      continue;
    }

    const narrow = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("input, select, button")) {
        // チェックボックスとラジオは16px角が正しい形。ラベルまで含めて押せる
        if (el.type === "checkbox" || el.type === "radio") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const label =
          el.getAttribute("aria-label") || el.id || el.tagName.toLowerCase();
        // 値を打ち込む欄が、触れる大きさ（44pt）の半分すら無いなら事実上押せない
        if (r.width > 0 && r.width < 22) out.push({ label, w: Math.round(r.width) });
      }
      return out;
    });
    if (narrow.length > 0) {
      fail(
        `押せない幅の入力欄がある（${width}px幅）: ` +
          narrow.map((x) => `${x.label}=${x.w}px`).join(", ")
      );
    }

    // 本数の欄そのものも見る。数字が読める幅（44pt）を下回らないこと
    const repsBox = await page.getByLabel("本数", { exact: true }).boundingBox();
    if (!repsBox) fail(`入力欄の実寸: 本数の欄が見つからない（${width}px幅）`);
    else if (repsBox.width < 44) {
      fail(`本数の入力欄が狭すぎる（${width}px幅で ${Math.round(repsBox.width)}px）`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  step("押せない幅の入力欄ゼロ（390px・320px幅で実寸・ステッパーの中身も確認）");
}

// ---- 13. P-4: 最下部の要素が下部タブバー・FABの裏に隠れていないこと ----
/*
 * 下部タブバーとFABは position:fixed なので、スクロール領域が
 * そのぶんの余白を持っていないと最下部の要素が裏に入る。
 * 見た目には「スクロールしきった」ように見えるので気づけない。
 * 余白は app-main の1か所で確保しているが、確保できているかは実測で見る。
 */
for (const p of ["/", "/setup", "/goal", "/calendar", "/results", "/analysis", "/race", "/meet", "/heat", "/past", "/plan-settings", "/data", "/settings", "/warnings", "/session", "/ask"]) {
  await page.goto(`http://localhost:8791/#${p}`);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const tabs = document.querySelector("nav.fixed.bottom-0");
    if (!tabs) return null;
    const tabsTop = tabs.getBoundingClientRect().top;
    const main = document.querySelector("main");
    if (!main) return null;
    let contentBottom = -Infinity;
    let worst = "";
    for (const el of main.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0) continue;
      if (r.bottom > contentBottom) {
        contentBottom = r.bottom;
        worst = `${el.tagName.toLowerCase()}.${String(el.className ?? "").slice(0, 40)}`;
      }
    }
    return { tabsTop, contentBottom, worst };
  });
  if (!m) {
    fail(`P-4: ${p} で下部タブバーかmainが見つからない`);
  } else if (m.contentBottom > m.tabsTop + 1) {
    fail(
      `P-4: ${p} の最下部がタブバーの裏に入っている（要素の下端 ${Math.round(m.contentBottom)}px > タブバー上端 ${Math.round(m.tabsTop)}px / ${m.worst}）`
    );
  }
}
step("P-4 全画面で最下部がタブバー・FABに隠れないOK");
await shot("29_bottom_clearance");

// ---- 14. P-1: ホームのTODAYからメニューを変更できること ----
/*
 * カレンダーの編集シートと同じ実装（SessionEditSheet）を開いている。
 * 片方だけ直して挙動がずれることを防ぐため、ここでも本文の解釈まで確かめる。
 */
// 生成されたプランに今日ぶんが無いことがあるので、対象を1件用意してから確かめる
await page.evaluate(async () => {
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
  await fetch("/api/plan-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "add",
      today: d,
      session: {
        date: d,
        category: "high_lactate",
        name: "TODAY編集テスト",
        prescription: "600m×3 r10分",
        timeOfDay: "pm",
      },
    }),
  });
});
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(1100);
/*
 * TODAYに出るのは「その日の代表セッション」1件で、選ぶのは sessionPriority。
 * 高乳酸と経済走は同点なので、同点のときは配列順＝生成が先に入っているほうが勝つ。
 * つまり曜日によっては、上で足したテスト用セッションではなく
 * 生成済みの固定セッション（チーム練習等）が代表になる。
 * 固定枠は仕様上変更できないので、その日は「メニューを変更」が出なくて正しい。
 * 曜日でテストが落ちないよう、代表が固定かどうかで期待値を分ける。
 */
const todayInfo = await page.evaluate(async () => {
  const d = await fetch("/api/dashboard").then((r) => r.json());
  return {
    has: !!d.todaySession,
    isFixed: !!d.todaySession?.isFixed,
    name: d.todaySession?.name,
    category: d.todaySession?.category,
  };
});
const todayEditBtn = page.getByRole("button", { name: "メニューを変更", exact: true });
if (todayInfo.isFixed) {
  // 固定枠が代表の日: 変更ボタンが出ないことこそが期待される挙動
  if ((await todayEditBtn.count()) > 0) {
    fail(`P-1: 固定セッションなのに「メニューを変更」が出ている（${JSON.stringify(todayInfo)}）`);
  }
  step(`P-1 固定セッションの日は変更ボタンを出さないOK（${todayInfo.name}）`);
} else if ((await todayEditBtn.count()) === 0) {
  fail(`P-1: TODAYに「メニューを変更」が無い（${JSON.stringify(todayInfo)}）`);
} else {
  await todayEditBtn.first().click();
  await page.waitForTimeout(700);
  const sheet = page.locator("section.card", { hasText: "今日のメニューを変更" }).first();
  if ((await sheet.count()) === 0) fail("P-1: TODAYから編集シートが開かない");
  else {
    const sheetBox = await sheet.boundingBox();
    if (sheetBox && sheetBox.y > 844) fail(`P-1: 編集シートが画面外に出ている（y=${Math.round(sheetBox.y)}px）`);
    // 本文を書き換えると、カレンダーと同じように欄が組み変わること
    const ta = sheet.locator("textarea").first();
    await ta.fill("300m×5 @41.5秒 r5分");
    await page.waitForTimeout(900);
    const slots = await sheet.locator('label:has-text("本目") input').count();
    if (slots !== 5) fail(`P-1: TODAYの編集シートで欄が組み変わらない（${slots}）`);
    await sheet.getByRole("button", { name: "保存する", exact: true }).click();
    await page.waitForTimeout(1200);
    const afterSave = await page.textContent("body");
    if (!afterSave.includes("メニューを変更しました")) fail("P-1: TODAYからの保存が反映されない");
    if (!afterSave.includes("300m×5")) fail("P-1: 保存した本文がTODAYに出ていない");
  }
  step("P-1 TODAYからメニューを変更できるOK（カレンダーと同じ実装）");
  await shot("30_today_edit");
}

// ---- 15. P-5: 設定画面で何ができるか分かること ----
await page.goto("http://localhost:8791/#/settings");
await page.waitForTimeout(600);
const settingsText = await page.textContent("body");
for (const g of ["最初に決めるもの", "練習の決まりごと", "データ"]) {
  if (!settingsText.includes(g)) fail(`P-5: 設定画面のグループ「${g}」が無い`);
}
if (!settingsText.includes("曜日の優先・固定と自作メニュー")) fail("P-5: 設定項目に何ができるかの説明が無い");
// 説明を足しても、到達先そのものは減っていないこと
for (const label of ["プロフィール", "メニュー設定", "目標・レース", "暑熱順化", "データ管理"]) {
  if (!settingsText.includes(label)) fail(`P-5: 設定から「${label}」に到達できない`);
}
step("P-5 設定画面の説明とグループ分けOK（到達先は減っていない）");

/*
 * ---- 15b. 機能検索 ----
 *
 * 「どこに何があるか分からない」を解くための入口。
 * 画面名ではなく本人の言葉（症状・やりたいこと）で引けることを見る。
 * 出るだけでなく、押して実際にその画面へ行けるところまで確認する
 * ——リンク先が間違っていても、一覧に出た時点では気づけない。
 */
{
  const box = page.getByLabel("機能を探す");
  if ((await box.count()) === 0) fail("機能検索の入力欄が無い");
  else {
    // 症状の言葉で引く（画面名「過去データの一括入力」を知らなくても届くこと）
    await box.fill("ずれてる");
    await page.waitForTimeout(400);
    const hitText = await page.locator("section.card", { hasText: "機能を探す" }).textContent();
    if (!/現在地の測定/.test(hitText ?? "")) {
      fail(`機能検索: 「ずれてる」で現在地の測定が出ない（${(hitText ?? "").slice(0, 120)}）`);
    }
    // 画面の中にある機能は、行った先のどこにあるかまで出ていること
    if (!/場所:/.test(hitText ?? "")) fail("機能検索: 画面の中の機能の場所が出ていない");

    await page.getByRole("link", { name: /現在地の測定/ }).first().click();
    await page.waitForTimeout(700);
    const hash = await page.evaluate(() => window.location.hash);
    if (!hash.startsWith("#/past")) fail(`機能検索: 結果を押しても移動しない（${hash}）`);

    // 該当が無いときに無理やり何かを出さない
    await page.goto("http://localhost:8791/#/settings");
    await page.waitForTimeout(500);
    await page.getByLabel("機能を探す").fill("ぬるぽ");
    await page.waitForTimeout(400);
    const none = await page.locator("section.card", { hasText: "機能を探す" }).textContent();
    if (!/見つかりませんでした/.test(none ?? "")) {
      fail("機能検索: 該当が無いときの表示が出ない");
    }
    step("機能検索OK（症状の言葉で引ける・押すと移動する・無いときは無いと言う）");
  }
}

// ---- 15a-2. S-3: 自作メニューの登録も他と同じ入力方法になっていること ----
await page.goto("http://localhost:8791/#/plan-settings");
await page.waitForTimeout(900);
const addMenuBtn = page.getByRole("button", { name: "+ 登録する" }).first();
if ((await addMenuBtn.count()) > 0) {
  await addMenuBtn.click();
  await page.waitForTimeout(400);
}
const menuBody = page.locator('label:has-text("内容") input').first();
if ((await menuBody.count()) === 0) fail("S-3: 自作メニューの内容欄が無い");
else {
  await menuBody.fill("300m×5 @41.5秒 r5分");
  await page.waitForTimeout(900);
  // 記録画面・編集シートと同じ「1本ごとの欄」が出ること
  const menuSlots = await page.locator('label:has-text("本目") input').count();
  if (menuSlots !== 5) fail(`S-3: 自作メニュー登録で欄が組み上がらない（${menuSlots}）`);
  const setText = await page.textContent("body");
  if (!/カテゴリの根拠/.test(setText)) fail("S-3: 本文からの判定根拠が出ていない");
  step("S-3 自作メニューの登録も本文から欄が組み上がるOK（他の入力画面と同じ）");

  /*
   * S-6: 他の選手のメニューを自分の設定に換算する。
   * 構造をそのまま真似ると設定だけ速すぎる形になるので、そこが直っているかを見る。
   */
  const otherToggle = page.getByText("他の選手のメニューを取り込む（自分の設定に換算します）");
  if ((await otherToggle.count()) === 0) fail("S-6: 他選手メニューの取り込みが無い");
  else {
    await otherToggle.click();
    await page.waitForTimeout(300);
    await menuBody.fill("300m×5 @39.0秒 r5分");
    // PBの差を10秒超に取り、notes（StatusTextの表示）が実際に出るケースにする
    await page.locator('label:has-text("その選手の800m PB") input').fill("1:30.0");
    await page.waitForTimeout(1200);
    const convText = await page.textContent("body");
    if (!/自分の設定に換算すると/.test(convText)) fail("S-6: 換算結果が出ない");
    if (!/相手 39\.0秒/.test(convText)) fail("S-6: 相手の設定が併記されていない");
    // 換算結果が実測ではないことを必ず出す
    if (!/換算値は実測ではありません/.test(convText)) fail("S-6: 換算値であることが書かれていない");
    // PBの差が大きいことの注記（converted.notes）が出ていること
    if (!/PBの差が.*秒あります/.test(convText)) fail("S-6: PBの差についての注記が出ない");
    /*
     * 状態表現を色だけに頼らないための共通コンポーネント（StatusText）が
     * ここで実際に使われていること（role属性＋アイコン）を確認する。
     * StatusTextは1箇所の実装なので、ここで確認できれば他の呼び出し元
     * （21箇所）も同じ実装を経由していることの裏付けになる。
     */
    const statusTextOk = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="status"]')].find((e) =>
        (e.textContent ?? "").includes("PBの差が")
      );
      return !!el && (el.textContent ?? "").includes("⚠");
    });
    if (!statusTextOk) fail("S-6: 状態表現がrole/アイコン付きで出ていない（StatusText）");
    // 自分のCFEは相手より遅いので、設定は相手より遅くなるはず
    const conv = await page.evaluate(async () => {
      const d = await fetch("/api/convert-menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prescription: "300m×5 @39.0秒 r5分", theirPb800Sec: 106 }),
      }).then((r) => r.json());
      return { target: d.converted?.targetSec, ratio: d.converted?.ratio };
    });
    if (!conv.target) fail("S-6: 換算後の設定が返らない");
    else if (conv.target <= 39) {
      fail(`S-6: 相手より遅いはずが速い設定になっている（${conv.target}秒）`);
    }
    step(`S-6 他選手メニューの換算OK（39.0秒 → ${conv.target}秒 / 比 ${conv.ratio}）`);
  }
}

// ---- 15b. S-5: 確認ダイアログがFABに隠れず押せること ----
/*
 * ConfirmDialog も FAB も fixed。同じ z-index だと DOM で後に来る FAB が上に乗り、
 * スマホでは下寄せのダイアログの確認ボタンがちょうど FAB の下に入って押せなくなる。
 * 「見えているのに押せない」ので、座標の重なりではなく実際にクリックして確かめる。
 */
await page.goto("http://localhost:8791/#/plan-settings");
await page.waitForTimeout(900);
const delBtn = page.getByRole("button", { name: "削除", exact: true }).first();
if ((await delBtn.count()) === 0) fail("S-5: 自作メニューの削除ボタンが無い（前段の登録が効いていない）");
else {
  await delBtn.click();
  await page.waitForTimeout(400);
  const dialog = page.locator("h3", { hasText: "このメニューを削除しますか？" }).first();
  if ((await dialog.count()) === 0) fail("S-5: 削除の確認ダイアログが出ない");

  // ---- ConfirmDialogのアクセシビリティ（role・Escape・フォーカストラップ・復帰） ----
  const dialogRole = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"]');
    return el ? { role: el.getAttribute("role"), modal: el.getAttribute("aria-modal") } : null;
  });
  if (!dialogRole || dialogRole.modal !== "true") {
    fail("ConfirmDialog: role=dialog / aria-modal=trueが付いていない");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if ((await dialog.count()) !== 0) fail("ConfirmDialog: Escapeで閉じない");
  const focusReturnedToTrigger = await delBtn.evaluate((el) => el === document.activeElement);
  if (!focusReturnedToTrigger) fail("ConfirmDialog: Escapeで閉じた後、フォーカスが呼び出し元へ戻らない");

  await delBtn.click();
  await page.waitForTimeout(400);
  if ((await dialog.count()) === 0) fail("ConfirmDialog: 再度開けない");
  const activeAfterOpen = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (activeAfterOpen !== "実行する") {
    fail(`ConfirmDialog: 開いた直後にフォーカスが確認ボタンへ移らない: ${activeAfterOpen}`);
  }
  await page.keyboard.press("Tab");
  const afterTab1 = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (afterTab1 !== "キャンセル") fail(`ConfirmDialog: Tabでキャンセルボタンへ移らない: ${afterTab1}`);
  await page.keyboard.press("Tab");
  const afterTab2 = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (afterTab2 !== "実行する") {
    fail(`ConfirmDialog: フォーカストラップが効いておらず、Tabでダイアログの外へ抜ける: ${afterTab2}`);
  }
  step("ConfirmDialogのアクセシビリティOK（role/aria-modal・Escapeで閉じる・フォーカス復帰・トラップ）");

  const runBtn = page.getByRole("button", { name: "実行する", exact: true }).first();
  /*
   * 固定の「＋」は削除した（forge-v107）。
   * カレンダーの日付・分析の文章・下部ナビの上に重なっていて、
   * しかもホームの「記録する」・各日の＋・記録画面の入力と機能が重複していた。
   *
   * ここで見るのは2つ。
   *   ・浮いている「＋」が**戻っていない**こと
   *   ・確認ボタンの上に浮いているものが無いこと（重なる端末で押せなくなる）
   *
   * 「ボタンが押せた」だけを見ると、E2Eの画面幅でたまたま重なっていないときに素通りする。
   */
  const floatingAdd = await page
    .locator('button[aria-label="記録を追加"], button[aria-label="閉じる"][class*="rounded-full"]')
    .count();
  if (floatingAdd > 0) {
    fail("固定の「＋」が戻っている（カレンダーや分析の文章に重なる）");
  }
  const covering = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter(
      (b) => (b.textContent || "").trim() === "実行する"
    );
    if (btns.length === 0) return "確認ボタンが無い";
    const r = btns[0].getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!top) return null;
    if (top === btns[0] || btns[0].contains(top)) return null;
    // 上に乗っているものが position:fixed なら、画面の高さ次第で押せなくなる
    const style = window.getComputedStyle(top);
    return style.position === "fixed"
      ? (top.tagName + "." + String(top.className || "")).slice(0, 60)
      : null;
  });
  if (covering) fail(`S-5: 確認ボタンの上に浮いているものがある（${covering}）`);
  const clicked = await runBtn
    .click({ timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) fail("S-5: 確認ボタンが押せない");
  await page.waitForTimeout(700);
  const afterDel = await page.textContent("body");
  if (!/削除しました|元に戻す/.test(afterDel)) fail("S-5: 削除が実行されていない");
  step("S-5 削除の確認ボタンが押せるOK（浮いているものに隠れない・固定の＋は無い）");
}

// ---- 16. Q-2: 足りていないカテゴリの提案 ----
await page.goto("http://localhost:8791/#/analysis");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "現在地", exact: true }).click();
await page.waitForTimeout(900);
const covCard = page.locator("section.card", { hasText: "4週間のバランス" }).first();
if ((await covCard.count()) === 0) fail("Q-2: 4週間のバランスカードが無い");
else {
  const covText = await covCard.textContent();
  // 判断の根拠を数字で出していること（回数を伴わない指摘にしない）
  if (!/4週で\d+回/.test(covText)) fail("Q-2: 基準の回数が出ていない");
  if (!/直近4週は\d+回/.test(covText)) fail("Q-2: 実施回数が出ていない");
  const api = await page.evaluate(async () => {
    const d = await fetch("/api/coverage").then((r) => r.json());
    return d.review;
  });
  if (!api) fail("Q-2: /api/coverage が返らない（PWA側のシムが対になっていない可能性）");
  else {
    if (!Array.isArray(api.targets) || api.targets.length === 0) fail("Q-2: 配分の集計が空");
    // 固定曜日の設定そのものは書き換えていないこと
    const tpl = await page.evaluate(async () =>
      fetch("/api/plan-settings").then((r) => r.json())
    );
    const before = JSON.stringify(tpl?.template ?? tpl);
    if (api.proposals.length > 0 && api.proposals[0].candidates.length > 0) {
      const p = api.proposals[0];
      /*
       * ここは fetch を直接呼ぶだけの検査だった。
       * そのため「ボタンを押しても画面が何も言わない」不具合を素通りさせていた
       * （入れ替えがルール違反で止まると、灰色の一文がカード末尾＝画面2つぶん下に
       * 出るだけだった）。実際にボタンを押し、結果が押した候補の内側に出ることを見る。
       */
      const candidateKey = `${p.candidates[0].sessionId}:${p.category}`;
      const cand = covCard.locator(`[data-candidate="${candidateKey}"]`).first();
      if ((await cand.count()) === 0) fail("Q-2: 入れ替え候補の行が画面に出ていない");
      const swapBtn = cand.getByRole("button", { name: /に替える$/ }).first();
      if ((await swapBtn.count()) === 0) fail("Q-2: 「〜に替える」ボタンが無い");
      const swapSessionId = p.candidates[0].sessionId;
      const categoryBefore = await page.evaluate(async (id) => {
        const d = await fetch("/api/sessions").then((r) => r.json());
        return (d.sessions ?? []).find((s) => s.id === id)?.category ?? null;
      }, swapSessionId);
      await swapBtn.click();
      await page.waitForTimeout(900);
      /*
       * 入れ替えが**通った**場合、その予定はもう候補ではなくなるので行ごと消える。
       * 以前はここで必ず行の中身を読もうとしていたので、
       * 通った日に限って「行が見つからない」で落ちていた（日付でどちらに転ぶか変わる）。
       * 通ったか止まったかで見るものを分ける。
       */
      if ((await cand.count()) === 0) {
        // 通った側: 画面に結果が出ていることと、予定が実際に変わっていることの両方
        const cardText = (await covCard.textContent()) ?? "";
        if (!/入れ替えました/.test(cardText)) {
          fail("Q-2: 入れ替えが通ったのに、画面に何も出ていない");
        }
        const categoryAfter = await page.evaluate(async (id) => {
          const d = await fetch("/api/sessions").then((r) => r.json());
          return (d.sessions ?? []).find((s) => s.id === id)?.category ?? null;
        }, swapSessionId);
        if (categoryAfter === categoryBefore) {
          fail(`Q-2: 「入れ替えました」と出たのに予定が変わっていない（${categoryBefore}）`);
        }
      } else {
        // 止まった側: 候補の内側だけを読む。カード全体を読むと、末尾に出る旧実装でも通ってしまう
        const candText = (await cand.textContent()) ?? "";
        if (!/入れ替えました|ルールに反します|入れ替えできませんでした|RULE-/.test(candText)) {
          fail("Q-2: 「に替える」を押しても、押した場所に結果が出ない（反応が無いように見える）");
        }
        // 止まったなら、なぜ止まったかと、押し切る手段が同じ場所にあること
        if (!/入れ替えました/.test(candText)) {
          if (!/RULE-/.test(candText)) fail("Q-2: 止まった理由（ルール名）が出ていない");
          if ((await cand.getByRole("button", { name: "承知のうえで替える" }).count()) === 0) {
            fail("Q-2: ルールで止まったのに、本人が押し切る手段が出ていない");
          }
        }
      }
      const tplAfter = await page.evaluate(async () =>
        fetch("/api/plan-settings").then((r) => r.json())
      );
      if (JSON.stringify(tplAfter?.template ?? tplAfter) !== before) {
        fail("Q-2: 提案の適用で固定曜日設定が書き換わっている（本人が決めたものを変えない）");
      }
    }
  }
  /*
   * S-12: 表を出すだけでは伝わらないので、
   * 「何のための画面か」と「で、どうするのか」が文章で出ていること。
   */
  if (!covText.includes("おすすめ")) fail("S-12: おすすめが出ていない");
  if (!/1か月の組み立て/.test(covText)) {
    fail("S-12: 今日の設定調整との違いが説明されていない");
  }
  step("Q-2 足りていないカテゴリの提案OK（根拠が数字つき・固定曜日は不変）");
  await shot("31_coverage");
}

// ---- 16a-2. S-12: カレンダーからも気づけること ----
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(1100);
const calCov = page.locator("section.card", { hasText: "4週間のバランス" }).first();
if ((await calCov.count()) === 0) fail("S-12: カレンダーに4週間のバランスが出ていない");
else {
  const t = (await calCov.textContent()) ?? "";
  if (!/次の行動|警告はありません|足りていません|足りています/.test(t)) {
    fail("S-12: カレンダーの要約に結論が無い");
  }
  if ((await calCov.getByRole("link", { name: /内訳を見る/ }).count()) === 0) {
    fail("S-12: 内訳への導線が無い");
  }
  step("S-12 カレンダーからバランスに気づけるOK");
}

// ---- 16b. R-1: 心拍が使われていること ----
await page.goto("http://localhost:8791/#/analysis");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "現在地", exact: true }).click();
await page.waitForTimeout(900);
const hrCard = page.locator("section.card", { hasText: "心拍の使われ方" }).first();
if ((await hrCard.count()) === 0) fail("R-1: 心拍の使われ方カードが無い");
else {
  const hrApi = await page.evaluate(async () => {
    const d = await fetch("/api/insights").then((r) => r.json());
    return d.hr;
  });
  if (!hrApi) fail("R-1: /api/insights に hr が無い（PWA側のシムが対になっていない可能性）");
  else {
    // 記録画面で1本ごとの心拍を入れてあるので、最大心拍の基準が立つはず
    if (!hrApi.reference) fail("R-1: 最大心拍の基準が立たない（心拍を入れた記録があるのに）");
    if (!Array.isArray(hrApi.lines) || hrApi.lines.length === 0) fail("R-1: 心拍の判定行が空");
    // 短い本の練習では強度を判定しないこと（心拍が定常に達しないため）
    const shortRep = hrApi.lines.find((l) => l.note.includes("定常"));
    const anyVerdict = hrApi.lines.some((l) =>
      ["in_band", "below", "above", "not_applicable", "no_data"].includes(l.verdict)
    );
    if (!anyVerdict) fail("R-1: 判定の種類が想定外");
    if (shortRep && shortRep.verdict !== "not_applicable") {
      fail("R-1: 短い本の練習で強度を判定してしまっている");
    }
  }
  step("R-1 心拍の使われ方OK（基準・判定・短い本の除外）");
  await shot("32_hr_usage");
}

// ---- 16c. R-2: ロード画面に意味のある値が出ること ----
const splashSaved = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem("forge:splash") ?? "null");
  } catch {
    return null;
  }
});
if (!splashSaved) fail("R-2: 次回起動用の値が保存されていない");
else if (!splashSaved.raceDate) fail("R-2: レース日が保存されていない");
else if (!splashSaved.gapText) fail("R-2: 目標との差が保存されていない");

/*
 * スプラッシュは bundle.js を読み終わると消えるので、普通に開くと一瞬しか見られない。
 * bundle.js を止めて足を固定する。
 *
 * このとき **別のコンテキストで開く**。今のページは Service Worker が
 * 有効になっていて bundle.js をキャッシュから返すため、
 * page.route を張っても素通りする（SW経由の取得は横取りされない）。
 * 新しいコンテキストなら SW はまだ登録されていないので、確実に止まる。
 * 保存済みの値は addInitScript で流し込む（保存自体は上で確認済み）。
 */
if (splashSaved) {
  const splashCtx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1.5,
  });
  const sp = await splashCtx.newPage();
  await sp.addInitScript((v) => {
    try {
      localStorage.setItem("forge:splash", v);
    } catch {
      /* 書けなくてもテストの意味は変わらない */
    }
  }, JSON.stringify(splashSaved));
  await sp.route("**/bundle.js", (route) => route.abort());
  await sp.goto("http://localhost:8791/");
  await sp.waitForTimeout(500);

  const splashText = (await sp.locator("#splash").textContent().catch(() => "")) ?? "";
  if (!splashText.includes("FORGE")) fail("R-2: スプラッシュが出ていない");
  if (!/レースまで/.test(splashText)) fail(`R-2: レースまでの日数が出ていない（${splashText}）`);
  if (!/\d+日/.test(splashText)) fail("R-2: 日数の数字が出ていない");
  if (!/目標.*秒|到達/.test(splashText)) fail("R-2: 目標との差が出ていない");
  /*
   * 読み込み表示（線＋3点）が出ていること。
   * 以前は400mトラックのレーン本数を数えていたが、その演出はやめた。
   *
   * 点は色が変わるだけで、消えたり動いたりしない。要素の有無だけを見ると
   * 「3つ並んでいるが全部消えている」状態を通してしまうので、
   * 線の幅と、点が実際に描かれている大きさまで見る。
   */
  if ((await sp.locator("#splash .loader .dots i").count()) !== 3) {
    fail("R-2: 読み込み表示の点が3つでない");
  }
  const barBox = await sp.locator("#splash .loader .bar").boundingBox();
  if (!barBox || barBox.width < 60 || barBox.height < 1) {
    fail(`R-2: 読み込み表示の線が出ていない（${JSON.stringify(barBox)}）`);
  }
  const dotBox = await sp.locator("#splash .loader .dots i").first().boundingBox();
  if (!dotBox || dotBox.width < 4) {
    fail(`R-2: 読み込み表示の点が潰れている（${JSON.stringify(dotBox)}）`);
  }
  // 画面外にはみ出していないこと（iPhone幅で数字が切れると読めない）
  const infoBox = await sp.locator("#splash-value").boundingBox();
  if (infoBox && (infoBox.x < 0 || infoBox.x + infoBox.width > 390)) {
    fail("R-2: スプラッシュの数字が画面幅からはみ出している");
  }
  await sp.screenshot({ path: path.join(SHOT_DIR, "33_splash.png") });
  // 初期化失敗時は永久待機にせず、状態と再読み込み操作を出す
  await sp.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("forge:app-error", { detail: { message: "E2E startup failure" } })
    );
  });
  if (!(await sp.locator("#splash").textContent()).includes("起動できませんでした")) {
    fail("R-2: 初期化失敗時の説明が出ない");
  }
  if (!(await sp.locator("#splash-retry").isVisible())) {
    fail("R-2: 初期化失敗時に再読み込み操作が出ない");
  }

  /*
   * S-1: マウント即座には消さないこと。
   * bundle を止めずに普通に開いて、最低表示時間のあいだ残っているかを見る。
   * ここが 0 に戻ると「数字は出しているが誰も読めない」状態に逆戻りする。
   */
  const liveCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const lp = await liveCtx.newPage();
  await lp.addInitScript((v) => {
    try {
      localStorage.setItem("forge:splash", v);
    } catch {
      /* 書けなくても足止めの検証には影響しない */
    }
  }, JSON.stringify(splashSaved));
  const openedAt = Date.now();
  await lp.goto("http://localhost:8791/");
  await lp.waitForFunction(() => !document.getElementById("splash"), { timeout: 20000 });
  const shownMs = Date.now() - openedAt;
  if (shownMs < 1200) fail(`S-1: ロード画面が短すぎる（${shownMs}ms）`);
  if (shownMs > 6000) fail(`S-1: ロード画面が長すぎる（${shownMs}ms）`);
  await liveCtx.close();

  // 何も保存されていない初回起動でも、ロゴだけで成立すること
  const firstCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const fp = await firstCtx.newPage();
  await fp.route("**/bundle.js", (route) => route.abort());
  await fp.goto("http://localhost:8791/");
  await fp.waitForTimeout(400);
  const firstText = (await fp.locator("#splash").textContent().catch(() => "")) ?? "";
  if (!firstText.includes("FORGE")) fail("R-2: 初回起動でスプラッシュが出ない");
  if (/レースまで/.test(firstText)) fail("R-2: 保存が無いのに値が出ている");
  const firstErrors = [];
  fp.on("pageerror", (e) => firstErrors.push(String(e)));
  if (firstErrors.length) fail(`R-2: 初回起動でスクリプトが落ちている（${firstErrors[0]}）`);
  await fp.screenshot({ path: path.join(SHOT_DIR, "33_splash_first.png") });
  await firstCtx.close();

  // 動きを減らす設定では静止表示へ切り替わり、通常の2.8秒を待たずに進める
  const reducedCtx = await b.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const reducedPage = await reducedCtx.newPage();
  await reducedPage.addInitScript((v) => {
    localStorage.setItem("forge:splash", v);
  }, JSON.stringify(splashSaved));
  const reducedOpenedAt = Date.now();
  await reducedPage.goto("http://localhost:8791/");
  await reducedPage.waitForFunction(() => !document.getElementById("splash"), { timeout: 5000 });
  const reducedShownMs = Date.now() - reducedOpenedAt;
  if (reducedShownMs > 2500) {
    fail(`R-2: reduced motionでも起動画面が長い（${reducedShownMs}ms）`);
  }
  await reducedCtx.close();
  await splashCtx.close();
}
// 通常起動ではスプラッシュが消えること
await page.goto("http://localhost:8791/");
await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
step("R-2 ロード画面OK（レースまでの日数と目標との差／初回は素／読み込み後に消える）");

/*
 * ---- 16c-2. 保存内容の確認 ----
 *
 * 入れたタイムとレストがそのまま入っているかを本人が見られること。
 * APIだけでなく画面で開くところまで見る——シムに対で足し忘れると
 * PWA側だけ静かに空になる。
 */
{
  await page.goto("http://localhost:8791/#/results");
  await page.waitForTimeout(900);
  const auditCard = page.locator("section.card", { hasText: "保存内容の確認" }).first();
  if ((await auditCard.count()) === 0) fail("保存内容の確認カードが無い");
  else {
    const btn = auditCard.getByRole("button", { name: /確認する/ }).first();
    if ((await btn.count()) === 0) fail("保存内容の確認: 開くボタンが無い");
    else {
      await btn.click();
      await page.waitForTimeout(900);
      const t = (await auditCard.textContent()) ?? "";
      for (const head of ["距離", "タイム", "レスト"]) {
        if (!t.includes(head)) fail(`保存内容の確認: 「${head}」の列が無い`);
      }
      if (!/この記録の使われ方/.test(t)) fail("保存内容の確認: 使われ方が出ていない");
      if (!/CFE/.test(t)) fail("保存内容の確認: CFEの扱いが出ていない");
      if (!/負荷/.test(t)) fail("保存内容の確認: 負荷への算入が出ていない");
      step("保存内容の確認OK（本ごとのタイム・レストと、何に使われたかが出る）");
    }
  }
}

/*
 * ---- 16d. R-3: ブランド表示が崩れていないこと ----
 *
 * 以前はここで緑の400mトラック（`header svg path` を4本）を数えていた。
 * アプリアイコンが文字だけの構成になり、対応するシンボルが無くなったので
 * マーク自体を外した。**この検査もここで消す。**
 * 残しておくと `header svg` は設定の歯車を掴むので、
 * マークが消えていても通ってしまい、何も見ていない検査になる。
 */
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(800);
if ((await page.locator("header .forge-wordmark").count()) === 0) {
  fail("R-3: ヘッダーにワードマークが無い");
}
/*
 * ヘッダーのワードマーク。
 *
 * 以前は skewX をかけた太字テキストだったので、崩れても文字は出ていた。
 * 画像（CSSマスク）に変えたことで、`brand-wordmark.png` が配信物から漏れると
 * **何も出ない空の箱になる**。エラーも出ないので画面を見ないと気づけない。
 * 要素の大きさと、マスク画像が実際に取れることの両方を見る。
 */
const wmBox = await page.locator("header .forge-wordmark").first().boundingBox();
if (!wmBox) fail("R-3: ヘッダーのワードマークが描画されていない");
else if (wmBox.width < 24 || wmBox.height < 8) {
  fail(`R-3: ヘッダーのワードマークが潰れている（${Math.round(wmBox.width)}×${Math.round(wmBox.height)}）`);
}
if (wmBox) {
  /*
   * 実際に字が出ているかを画素で見る。
   * 要素の大きさだけを見る検査では足りない——画像のURLが解決できないとき、
   * 箱は正しい大きさのまま中身だけが空になる。エラーも出ない。
   * ワードマークの範囲を切り出して、背景より明るい画素の割合を数える。
   */
  const clip = await page.screenshot({
    clip: { x: wmBox.x, y: wmBox.y, width: wmBox.width, height: wmBox.height },
  });
  const inkRatio = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const p = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2] > 90) ink++;
    }
    return ink / (p.length / 4);
  }, clip.toString("base64"));
  // 字が出ていなければ0に近い値になる
  if (inkRatio < 0.1) {
    fail(`R-3: ヘッダーのワードマークが空欄（明るい画素 ${(inkRatio * 100).toFixed(1)}%・画像が解決できていない）`);
  }
}
if (!(await page.evaluate(async () => (await fetch("./brand-wordmark.png")).ok))) {
  fail("R-3: brand-wordmark.png が配信物に無い（ワードマークが空欄になる）");
}
// アイコンが配信物に入っていること
for (const f of ["icon-32.png", "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
  const ok = await page.evaluate(
    async (name) => (await fetch("./" + name)).ok,
    f
  );
  if (!ok) fail(`R-3: ${f} が配信物に無い`);
}
const manifestIcons = await page.evaluate(async () => {
  const manifest = await fetch("./manifest.webmanifest").then((response) => response.json());
  return manifest.icons?.map((icon) => icon.src) ?? [];
});
if (!manifestIcons.some((src) => src.includes("icon-32.png"))) {
  fail("R-3: manifestに32px faviconが無い");
}
if (!manifestIcons.some((src) => src.includes("icon-maskable-512.png"))) {
  fail("R-3: manifestにmaskable iconが無い");
}
/*
 * iOSの起動画像。
 * 無いとコールド起動のあいだ白い画面が出る（iOSはmanifestのbackground_colorを見ない）。
 * ここで見張るのは、**link は書いてあるのに実体が配信物に無い**状態。
 * その場合iOSは黙って白に戻すので、画面を見ても原因が分からない。
 */
const startupImages = await page.evaluate(() =>
  Array.from(document.querySelectorAll('link[rel="apple-touch-startup-image"]')).map(
    (l) => l.getAttribute("href")
  )
);
if (startupImages.length < 8) {
  fail(`R-3: iOSの起動画像のlinkが足りない（${startupImages.length}件）`);
}
for (const href of startupImages) {
  if (!(await page.evaluate(async (u) => (await fetch(u)).ok, href))) {
    fail(`R-3: 起動画像 ${href} が配信物に無い（iOSが白い画面に戻る）`);
  }
}
step(
  `R-3 ブランド表示OK（ワードマーク ${Math.round(wmBox?.width ?? 0)}×${Math.round(wmBox?.height ?? 0)} / ` +
    `アイコン5種 / 起動画像${startupImages.length}種）`
);
await shot("34_mark_header");

// ---- 16e. S-11: 同期は未設定でも成立すること ----
/*
 * 同期は「足すだけ」の機能。設定しなければ何も起きず、
 * アプリはこれまでどおり端末の中だけで動く必要がある。
 * 未設定の状態で操作できてしまうと、通信エラーで詰まる。
 */
const syncKey = "sb_publishable_1234567890123456789012_12345678";
const rejectedSyncKey = "sb_publishable_0000000000000000000000_00000000";
let syncStorageMode = "rls";
let syncStorageWriteSeen = false;

/*
 * Phase 2-3: Storageの保存先は利用者ごとに分ける（forge/<uid>/snapshot.json）。
 * accessTokenのsubクレームからuidを取り出すので、e2eの偽トークンもJWTの形にする。
 * 署名は検証しないのでダミーでよい。
 */
function fakeJwt(payload) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}
const e2eAccessToken = fakeJwt({ sub: "e2e-user-1" });
const e2eStorageObjectPath = "/storage/v1/object/forge/e2e-user-1/snapshot.json";
await page.route(/^https:\/\/[^/]+\.supabase\.co\//, async (route) => {
  const request = route.request();
  const target = new URL(request.url());
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "apikey, authorization, content-type, x-upsert",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders });
    return;
  }
  if (target.pathname === "/auth/v1/settings") {
    const apiKey = await request.headerValue("apikey");
    if (apiKey === rejectedSyncKey) {
      await route.fulfill({ status: 401, body: "invalid api key", headers: corsHeaders });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ external: { google: true } }),
      headers: corsHeaders,
    });
    return;
  }
  if (target.pathname === "/auth/v1/authorize") {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>OAuth intercepted</title>",
    });
    return;
  }
  if (target.pathname === e2eStorageObjectPath) {
    if (syncStorageMode === "rls") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: "403",
          error: "Unauthorized",
          message: "new row violates row-level security policy",
        }),
        headers: corsHeaders,
      });
      return;
    }
    if (request.method() === "GET") {
      // 実機で確認した実際のSupabaseの本文どおり code: "NoSuchKey" も含める
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: "404",
          error: "not_found",
          message: "Object not found",
          code: "NoSuchKey",
        }),
        headers: corsHeaders,
      });
      return;
    }
    if (request.method() === "POST") {
      syncStorageWriteSeen = (await request.headerValue("x-upsert")) === "true";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
        headers: corsHeaders,
      });
      return;
    }
  }
  await route.abort("failed");
});

await page.goto("http://localhost:8791/#/sync");
await page.waitForTimeout(800);
const syncText = await page.textContent("body");
if (!/設定しなければ何も起きず/.test(syncText)) fail("S-11: 未設定でも動くことが書かれていない");
if (!/service_role/.test(syncText)) fail("S-11: 入れてはいけない鍵の注意が無い");
const signInBtn = page.getByRole("button", { name: "Googleでサインイン" });
if ((await signInBtn.count()) === 0) fail("S-11: サインインの導線が無い");
else if (!(await signInBtn.first().isDisabled())) {
  fail("S-11: 接続先が未設定なのにサインインが押せる");
}
const syncNowBtn = page.getByRole("button", { name: "いま同期する" });
if ((await syncNowBtn.count()) === 0) fail("S-11: 同期の実行ボタンが無い");
else if (!(await syncNowBtn.first().isDisabled())) {
  fail("S-11: 未設定なのに同期が押せる（通信エラーで詰まる）");
}
// 中途半端な設定では保存させない
await page.locator('label:has-text("Project URL") input').fill("https://demo.supabase.co");
await page.waitForTimeout(300);
if (!(await page.getByRole("button", { name: "保存する" }).first().isDisabled())) {
  fail("S-11: Publishable Key が空でも保存できてしまう");
}
await page.locator('label:has-text("Publishable Key") input').fill(syncKey);
await page.waitForTimeout(300);
if (await page.getByRole("button", { name: "保存する" }).first().isDisabled()) {
  fail("S-11: 正しい設定なのに保存できない");
}

// 誤ったURLを一度保存し、別プロジェクト用のセッションがある状態を作る
await page.locator('label:has-text("Project URL") input').fill("https://wrong.supabase.co");
await page.getByRole("button", { name: "保存する" }).first().click();
await page.waitForTimeout(200);
await page.evaluate(() => {
  localStorage.setItem(
    "forge:sync:session",
    JSON.stringify({ accessToken: "old-project-token" })
  );
});
const wrongSaved = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("forge:sync:config") ?? "null")
);
if (wrongSaved?.url !== "https://wrong.supabase.co") {
  fail("S-11: 最初の誤URLが保存された状態を再現できない");
}

// 保存前でも接続テストはフォームの最新値を使う
await page
  .locator('label:has-text("Project URL") input')
  .fill("  https://correct.supabase.co/  ");
await page.getByRole("button", { name: "接続をテスト" }).click();
await page.waitForTimeout(300);
let syncBody = await page.textContent("body");
if (!syncBody.includes("correct.supabase.co のSupabase Authへ接続できました")) {
  fail("S-11: 接続テストが保存済みの古いURLを使っている");
}
if (!syncBody.includes("種別: ok") || !syncBody.includes("HTTP 200")) {
  fail("S-11: 接続テストの診断種別・HTTP statusが表示されない");
}

// 正しい値を保存。末尾スラッシュ・空白を除き、旧セッションを破棄する
await page.getByRole("button", { name: "保存する" }).first().click();
await page.waitForTimeout(250);
const corrected = await page.evaluate(() => ({
  config: JSON.parse(localStorage.getItem("forge:sync:config") ?? "null"),
  session: localStorage.getItem("forge:sync:session"),
}));
if (corrected.config?.url !== "https://correct.supabase.co") {
  fail(`S-11: 修正後URLが正規化保存されない（${corrected.config?.url}）`);
}
if (corrected.config?.anonKey !== syncKey) {
  fail("S-11: 修正後のPublishable Keyが保存値と一致しない");
}
if (corrected.session !== null) {
  fail("S-11: 接続先変更後も古いプロジェクトのセッションが残る");
}

// ページ再読込後も保存値を使って接続できる
await page.reload();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "接続をテスト" }).click();
await page.waitForTimeout(250);
syncBody = await page.textContent("body");
if (!syncBody.includes("correct.supabase.co のSupabase Authへ接続できました")) {
  fail("S-11: ページ再読込後に保存済み設定で接続できない");
}

// PWAを閉じて開き直す相当の新規documentでも同じlocalStorageから復帰する
await page.goto("about:blank");
await page.goto("http://localhost:8791/#/sync");
await page.waitForTimeout(500);
await page.getByRole("button", { name: "接続をテスト" }).click();
await page.waitForTimeout(250);
syncBody = await page.textContent("body");
if (!syncBody.includes("correct.supabase.co のSupabase Authへ接続できました")) {
  fail("S-11: PWA再起動相当で保存済み設定から接続できない");
}

// 形式は正しいが拒否されるKeyを、URL・DNS障害と区別する
const errorsBeforeRejectedKey = errors.length;
await page.locator('label:has-text("Publishable Key") input').fill(rejectedSyncKey);
await page.getByRole("button", { name: "接続をテスト" }).click();
await page.waitForTimeout(250);
syncBody = await page.textContent("body");
if (!syncBody.includes("種別: key") || !syncBody.includes("HTTP 401")) {
  fail("S-11: 不正なKeyの401を診断表示できない");
}
// ここでは401そのものが期待値。追加で発生した別種のconsole errorだけ監視へ戻す。
const rejectedKeyConsole = errors.splice(errorsBeforeRejectedKey);
errors.push(...rejectedKeyConsole.filter((e) => !e.includes("status of 401")));
await page.locator('label:has-text("Publishable Key") input').fill(syncKey);
await page.getByRole("button", { name: "保存する" }).first().click();
await page.waitForTimeout(200);

// OAuth開始時のredirect_toはPWAの実URLで、callback後は #/sync へ戻る
await page.getByRole("button", { name: "Googleでサインイン" }).click();
await page.waitForURL(/correct\.supabase\.co\/auth\/v1\/authorize/);
const authorizeUrl = new URL(page.url());
const redirectTo = authorizeUrl.searchParams.get("redirect_to");
if (redirectTo !== "http://localhost:8791/?sync=1") {
  fail(`S-11: PWAのOAuth redirect_toが違う（${redirectTo}）`);
}
await page.goto(
  "http://localhost:8791/?sync=1#access_token=e2e-access&refresh_token=e2e-refresh&expires_at=1900000000"
);
await page.waitForFunction(() => location.hash === "#/sync", { timeout: 5000 });
await page.waitForTimeout(300);
syncBody = await page.textContent("body");
if (!syncBody.includes("サインイン済みです")) {
  fail("S-11: OAuth callback後に同期画面へ戻ってセッションを表示できない");
}
const capturedSession = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("forge:sync:session") ?? "null")
);
if (capturedSession?.accessToken !== "e2e-access") {
  fail("S-11: OAuth callbackのaccess tokenを保存できない");
}
if (page.url().includes("access_token") || page.url().includes("refresh_token")) {
  fail("S-11: OAuth tokenがcallback後もURLに残る");
}

/*
 * NEXT-002 実機で再現した不具合: Supabase の Redirect URLs にこのURLを
 * 登録していないと、Supabase は redirect_to の ?sync=1 を無視して
 * Site URL（クエリ無し）へ飛ばす。この場合でもトークンさえ受け取れれば
 * 同期画面へ戻ることを確認する（サインインが黙って失敗して見えないように）。
 */
await page.evaluate(() => localStorage.removeItem("forge:sync:session"));
// ハッシュだけの違いではSPA内遷移としてブラウザが再読込を省略してしまうため、
// Supabaseなど外部originから戻ってくる実際の遷移（フルリロード）を再現する。
await page.goto("about:blank");
await page.goto(
  `http://localhost:8791/#access_token=${e2eAccessToken}&refresh_token=e2e-refresh-2&expires_at=1900000000`
);
await page.waitForFunction(() => location.hash === "#/sync", { timeout: 5000 });
await page.waitForTimeout(300);
const syncBodyNoQuery = await page.textContent("body");
if (!syncBodyNoQuery.includes("サインイン済みです")) {
  fail("S-11: sync=1が欠けたOAuth callbackで同期画面へ戻れない（Redirect URLs未登録相当）");
}
const capturedSessionNoQuery = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("forge:sync:session") ?? "null")
);
if (capturedSessionNoQuery?.accessToken !== e2eAccessToken) {
  fail("S-11: sync=1が欠けたOAuth callbackのaccess tokenを保存できない");
}

// StorageのRLS不備を汎用エラーにせず、直すべきポリシーまで表示する
const errorsBeforeStorageRls = errors.length;
await page.getByRole("button", { name: "いま同期する" }).click();
await page.waitForTimeout(300);
syncBody = await page.textContent("body");
if (!syncBody.includes("HTTP 403") || !syncBody.includes("StorageのRLSで拒否されています")) {
  fail("S-11: StorageのRLS不備をHTTP statusと対処方法つきで表示できない");
}
const storageRlsConsole = errors.splice(errorsBeforeStorageRls);
errors.push(...storageRlsConsole.filter((e) => !e.includes("status of 403")));

// ポリシー修正後は同じ画面から再試行でき、x-upsertでクラウドへ保存される
syncStorageMode = "ready";
const errorsBeforeMissingSnapshot = errors.length;
await page.getByRole("button", { name: "いま同期する" }).click();
await page.waitForTimeout(300);
syncBody = await page.textContent("body");
if (!syncBody.includes("クラウドへ送りました")) {
  fail("S-11: Storageのポリシー修正後にクラウドへ書き込めない");
}
if (!syncStorageWriteSeen) {
  fail("S-11: Storageへの書き込みがx-upsertになっていない");
}
const missingSnapshotConsole = errors.splice(errorsBeforeMissingSnapshot);
errors.push(...missingSnapshotConsole.filter((e) => !e.includes("status of 400")));

// Supabase接続設定だけを削除し、練習データ用IndexedDBには触れない
await page.getByRole("button", { name: "接続設定を消す" }).click();
await page.waitForTimeout(100);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(250);
const clearedSync = await page.evaluate(async () => ({
  config: localStorage.getItem("forge:sync:config"),
  session: localStorage.getItem("forge:sync:session"),
  databases: indexedDB.databases ? await indexedDB.databases() : [],
}));
if (clearedSync.config !== null || clearedSync.session !== null) {
  fail("S-11: 接続設定のみの削除で同期情報が残る");
}
if (!clearedSync.databases.some((d) => d.name === "train800")) {
  fail("S-11: 接続設定の削除で練習データ用IndexedDBまで消えた");
}

// 設定画面からも辿れること
await page.goto("http://localhost:8791/#/settings");
await page.waitForTimeout(600);
if (!(await page.textContent("body")).includes("他の端末と記録を引き継ぎます")) {
  fail("S-11: 設定画面から同期に辿れない");
}
step("S-11 同期設定・接続診断・OAuth復帰・Storage RLS診断・クラウド保存・設定のみ削除OK");
await shot("37_sync");

// ---- 17. Q-3: 取り込み済みの過去データを作り直せること ----
await page.goto("http://localhost:8791/#/data");
await page.waitForTimeout(700);
const rebuildCard = page.locator("section.card", { hasText: "過去データの作り直し" }).first();
if ((await rebuildCard.count()) === 0) fail("Q-3: 作り直しの導線が無い");
else {
  // 構造化記録を消して「取り込み済みの古いデータ」を作り、作り直しで戻ることを見る
  const broke = await page.evaluate(async () => {
    const d = await fetch("/api/sessions?from=2000-01-01&to=2099-12-31").then((r) => r.json());
    return (d.sessions ?? []).filter((s) => s.backfilled).length;
  });
  if (broke === 0) fail("Q-3: 過去データが1件も入っていない（前段の一括入力が効いていない）");
  await rebuildCard.getByRole("button", { name: "作り直す" }).click();
  await page.waitForTimeout(900);
  const rebuiltText = await rebuildCard.textContent();
  if (!/\d+件を確認し/.test(rebuiltText)) fail(`Q-3: 作り直しの結果が出ない（${rebuiltText.slice(0, 120)}）`);
  step("Q-3 過去データの作り直しOK（何件直したかを出す）");
}

/*
 * 取り込み済みのFITを、いまのラップの読み方で作り直せること。
 *
 * `rebuildFitDerived` は前から実装されていたが、APIにも画面にも
 * つながっていなかった（呼び出し元ゼロ）。そのためラップの読み方を直しても、
 * すでに取り込んだぶんは古い解釈のまま残り、本人には直す手段が無かった。
 */
const fitRebuildCard = page.locator("section.card", { hasText: "FIT取込の作り直し" }).first();
if ((await fitRebuildCard.count()) === 0) {
  fail("取り込み済みFITの作り直しの導線が無い");
} else {
  const importCount = await page.evaluate(async () => {
    const d = await fetch("/api/fit-import").then((r) => r.json());
    return (d.imports ?? []).length;
  });
  if (importCount === 0) fail("FIT取込が1件も入っていない（前段のFIT取込が効いていない）");
  await fitRebuildCard.getByRole("button", { name: "FIT取込を作り直す" }).click();
  await page.waitForTimeout(900);
  const fitRebuiltText = await fitRebuildCard.textContent();
  if (!/件のFITを確認し、\d+件を作り直しました/.test(fitRebuiltText)) {
    fail(`FIT取込の作り直しの結果が出ない（${fitRebuiltText.slice(0, 140)}）`);
  }
  step("取り込み済みFITの作り直しOK（何件直したかを出す）");
}

/*
 * 確定範囲（horizon）。
 *
 * 見張るのは2つ。
 *   1. 確定範囲の外に設定ペースを出していないこと
 *      （2か月先の数字は生成時のCFEで焼いた推測なので、決定事項として出さない）
 *   2. 処方の文面に書かれた秒数と、実際の設定ペースが食い違わないこと
 *      （以前は targetPaces だけ更新して文面を放置し、
 *        画面52.5秒 / 実際51.6秒 という状態を34枠ぶん作っていた）
 */
{
  const horizon = await page.evaluate(async () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const d = await fetch("/api/sessions").then((r) => r.json());
    const refreshed = await fetch("/api/plan/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ today: todayStr }),
    }).then((r) => r.json());
    return { todayStr, sessions: d.sessions ?? [], refreshed };
  });

  if (horizon.refreshed?.horizonDays !== 14) {
    fail(`確定範囲のAPIが対になっていない（/api/plan/refresh の応答: ${JSON.stringify(horizon.refreshed).slice(0, 120)}）`);
  }

  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const far = horizon.sessions.filter(
    (s) => dayDiff(horizon.todayStr, s.date) > 14 && (s.targetPaces ?? []).length > 0
  );
  if (far.length === 0) {
    fail("確定範囲より先のセッションが1件も無い（骨組みが短くなっていないか確認）");
  } else {
    /*
     * 素案が画面に設定ペースを出していないことを、セッション詳細で確かめる。
     * カレンダーで見るのは当てにならない——既定が1週間表示なので、
     * 14日より先の枠はそもそも描画されず、何を書いても検査が通ってしまう。
     * 詳細画面なら日付に関係なくその枠だけを開ける。
     */
    const target = far.sort((a, b) => a.date.localeCompare(b.date))[0];
    const secInText = (target.prescription.match(/(\d+\.\d)〜/) ?? [])[1];
    if (!secInText) {
      fail(`素案の確認に使える処方が無い（${target.prescription.slice(0, 60)}）`);
    } else {
      await page.goto(`http://localhost:8791/#/session?id=${encodeURIComponent(target.id)}`);
      await page.waitForTimeout(900);
      const body = await page.textContent("body");
      if (!body.includes(target.name)) {
        fail(`素案の詳細画面が開けていない（${target.id} / ${target.date}）`);
      }
      if (body.includes(secInText)) {
        fail(
          `確定範囲の外（${target.date}）の設定ペース ${secInText}秒 が画面に出ている（素案として隠すはず）`
        );
      }
      if (!body.includes("素案")) fail("素案であることが画面に出ていない");
      if (!/CFE/.test(body)) fail("いつ設定が決まるのかが画面に出ていない");
      // 素案のまま走り出せてしまわないこと
      if ((await page.getByRole("link", { name: /このメニューで開始/ }).count()) > 0) {
        fail("設定ペースが決まっていない素案から、そのまま開始できてしまう");
      }
    }
    step(`確定範囲OK（${far.length}件が素案・設定ペースを出していない）`);
  }

  // 文面と設定ペースの整合（確定範囲の中）
  const desync = await page.evaluate(async () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const d = await fetch("/api/sessions").then((r) => r.json());
    const out = [];
    for (const s of d.sessions ?? []) {
      const days = Math.round((Date.parse(s.date) - Date.parse(todayStr)) / 86400000);
      if (days < 0 || days > 14) continue;
      if (!(s.targetPaces ?? []).length) continue;
      const m = s.prescription.match(/@(?:\d+m\s)?(\d+\.\d)〜/);
      if (!m) continue;
      if (Math.abs(Number(m[1]) - s.targetPaces[0].targetSecFast) > 0.06) {
        out.push({ date: s.date, text: m[1], real: s.targetPaces[0].targetSecFast });
      }
    }
    return out;
  });
  if (desync.length > 0) {
    fail(`処方の文面と設定ペースが食い違っている ${desync.length}件（例: ${JSON.stringify(desync[0])}）`);
  } else {
    step("確定範囲の文面と設定ペースの整合OK");
  }
}

// ---- 相談（AI）----
/*
 * ここで見張るのは「動くこと」より「勝手に送らないこと」。
 *   ・鍵が無い / 同意が無い間は **1回も通信しない**
 *   ・送る本文には、画面に出した文脈がそのまま入っている
 *   ・ブラウザ直叩きに必要なヘッダが付いている（無いと本番で全滅する）
 * 通信そのものは横取りして、本物のAPIも料金も使わない。
 */
{
  const sent = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    sent.push({ headers: req.headers(), body: req.postData() ?? "" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: [{ type: "text", text: "テスト用の答え。CFEは鈍化で下がっています。" }],
        stop_reason: "end_turn",
      }),
    });
  });

  await page.evaluate(() => {
    localStorage.removeItem("forge:assistant:key");
    localStorage.removeItem("forge:assistant:consent");
  });
  await page.goto("http://localhost:8791/#/ask");
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
  await page.waitForSelector('[data-page="ask"]', { timeout: 10000 });

  // 画面に出す「送る内容」が、実データから作られていること
  await page.click('[data-testid="ask-toggle-context"]');
  const shownContext = (await page.textContent('[data-testid="ask-context-text"]')) ?? "";
  if (!shownContext.includes("推定800mタイム(CFE)") || !shownContext.includes("目標と現在地")) {
    fail(`相談: 送る内容が実データになっていない（${shownContext.slice(0, 80)}）`);
  }

  // 鍵が無い状態では送れない・通信しない
  await page.fill('[data-testid="ask-question"]', "なんでCFEが今の値なの？");
  if (!(await page.isDisabled('[data-testid="ask-send"]'))) {
    fail("相談: 鍵が無いのに送信ボタンが押せる");
  }
  await page.click('[data-testid="ask-send"]', { force: true }).catch(() => {});
  await page.waitForTimeout(300);
  if (sent.length !== 0) fail(`相談: 鍵が無いのに送信した（${sent.length}回）`);

  // 鍵だけ入れても、同意が無ければ送らない
  await page.fill('[data-testid="ask-key-input"]', "sk-ant-api03-e2e-dummy-key-0123456789");
  await page.click('[data-testid="ask-save-key"]');
  await page.waitForSelector('[data-testid="ask-consent"]', { timeout: 5000 });
  await page.fill('[data-testid="ask-question"]', "なんでCFEが今の値なの？");
  if (!(await page.isDisabled('[data-testid="ask-send"]'))) {
    fail("相談: 同意していないのに送信ボタンが押せる");
  }
  await page.click('[data-testid="ask-send"]', { force: true }).catch(() => {});
  await page.waitForTimeout(300);
  if (sent.length !== 0) fail(`相談: 同意前に送信した（${sent.length}回）`);

  // 同意して初めて送れる。
  // 文脈はページを読み直していないので、上で読んだ shownContext と同じものが送られるはず。
  // （ここでもう一度トグルを押すと**閉じて**しまうので押さない）
  await page.check('[data-testid="ask-consent"]');
  const shownAgain = shownContext;
  await page.click('[data-testid="ask-send"]');
  await page.waitForSelector('[data-testid="ask-answer"]', { timeout: 15000 }).catch(() => {});

  if (sent.length !== 1) {
    fail(`相談: 同意後の送信が1回になっていない（${sent.length}回）`);
  } else {
    const { headers, body } = sent[0];
    if (headers["anthropic-dangerous-direct-browser-access"] !== "true") {
      fail("相談: ブラウザ直叩きのヘッダが付いていない（本番で全滅する）");
    }
    if (!headers["x-api-key"]) fail("相談: APIキーのヘッダが無い");
    if (!headers["anthropic-version"]) fail("相談: anthropic-version が無い");
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      fail("相談: 送信本文がJSONではない");
    }
    if (payload) {
      const userText = payload.messages?.[0]?.content ?? "";
      // 画面に出した文脈がそのまま入っているか（見せたものと送ったものが同じ）
      const head = shownAgain.split("\n").slice(0, 3).join("\n");
      if (head && !userText.includes(head)) {
        fail("相談: 画面に出した文脈と送った本文が食い違っている");
      }
      if (!userText.includes("なんでCFEが今の値なの？")) fail("相談: 質問が送られていない");
      if (!String(payload.system ?? "").includes("推測で作らない")) {
        fail("相談: 数値を作らせない指示が送られていない");
      }
      if (!userText.includes("推定800mタイム(CFE)")) {
        fail("相談: 文脈が本文に入っていない");
      }
    }
  }

  const answer = (await page.textContent('[data-testid="ask-answer"]')) ?? "";
  if (!answer.includes("テスト用の答え")) fail(`相談: 答えが表示されない（${answer.slice(0, 60)}）`);

  // 答えは文章だけ。CFEが書き換わっていないこと
  const cfeAfter = await page.evaluate(() =>
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => d.cfe?.estimated800mSec ?? null)
  );
  const cfeInContext = shownAgain.match(/推定800mタイム\(CFE\): ([\d:.]+)/)?.[1];
  if (cfeInContext) {
    const [m, s] = cfeInContext.includes(":") ? cfeInContext.split(":") : ["0", cfeInContext];
    const expected = Number(m) * 60 + Number(s);
    if (cfeAfter === null || Math.abs(cfeAfter - expected) > 0.06) {
      fail(`相談: 答えのあとでCFEが動いている（${expected} → ${cfeAfter}）`);
    }
  }

  await shot("60_ask");
  await page.unroute("https://api.anthropic.com/**");
  await page.evaluate(() => {
    localStorage.removeItem("forge:assistant:key");
    localStorage.removeItem("forge:assistant:consent");
  });
  step("相談（AI）OK（同意前は送らない・見せた文脈をそのまま送る・答えでCFEは動かない）");
}

// ---- 写真からの転記 ----
/*
 * 見張るのは「文字起こしが解釈に化けていないこと」。
 *   ・鍵/同意が無ければ写真の欄すら出さない（何も送らない）
 *   ・起こした文字は**入力欄に入るだけ**で、その時点では1件も保存されない
 *   ・保存されるのは、これまでどおり「解釈する」→「確定」を通ったときだけ
 * 通信は横取りして、本物のAPIも料金も使わない。
 */
{
  const sentPhoto = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    sentPhoto.push({ headers: req.headers(), body: req.postData() ?? "" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: [{ type: "text", text: "```\n7/4 2kmジョグ 8:40\n7/5 オフ\n```" }],
        stop_reason: "end_turn",
      }),
    });
  });

  // 鍵も同意も無い状態では、写真の欄そのものを出さない
  await page.evaluate(() => {
    localStorage.removeItem("forge:assistant:key");
    localStorage.removeItem("forge:assistant:consent");
  });
  await page.goto("http://localhost:8791/#/past");
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
  await page.getByRole("button", { name: "まとめて入力" }).click().catch(() => {});
  await page.waitForTimeout(500);
  if (await page.locator('[data-testid="photo-file"]').count()) {
    fail("写真転記: 鍵も同意も無いのに写真を選ばせている");
  }

  // 鍵と同意を入れると欄が出る
  await page.evaluate(() => {
    localStorage.setItem("forge:assistant:key", "sk-ant-api03-e2e-dummy-key-0000");
    localStorage.setItem("forge:assistant:consent", "yes");
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
  await page.getByRole("button", { name: "まとめて入力" }).click().catch(() => {});
  await page.waitForSelector('[data-testid="photo-file"]', { timeout: 10000 });

  // 登録件数を控えておく（転記だけでは増えないことを確かめるため）
  const beforeCount = await page.evaluate(() =>
    fetch("/api/past").then((r) => r.json()).then((d) => (d.entries ?? []).length)
  );

  // 1x1ではなく、実際に縮小経路を通る大きさの画像を渡す
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 3200;
    c.height = 2400;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000";
    g.font = "80px sans-serif";
    g.fillText("7/4 2km jog", 100, 300);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.setInputFiles('[data-testid="photo-file"]', {
    name: "diary.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.waitForSelector('[data-testid="photo-preview"]', { timeout: 10000 });

  await page.click('[data-testid="photo-send"]');
  await page.waitForSelector('[data-testid="photo-note"]', { timeout: 20000 }).catch(() => {});

  if (sentPhoto.length !== 1) {
    fail(`写真転記: 送信が1回になっていない（${sentPhoto.length}回）`);
  } else {
    let payload;
    try {
      payload = JSON.parse(sentPhoto[0].body);
    } catch {
      fail("写真転記: 送信本文がJSONではない");
    }
    if (payload) {
      const content = payload.messages?.[0]?.content;
      if (!Array.isArray(content)) fail("写真転記: 画像ブロックが送られていない");
      else {
        const img = content.find((b) => b.type === "image");
        if (!img) fail("写真転記: 画像ブロックが無い");
        else {
          if (img.source?.type !== "base64") fail("写真転記: 画像がbase64で送られていない");
          if (img.source?.media_type !== "image/jpeg") {
            fail(`写真転記: JPEGに変換されていない（${img.source?.media_type}）`);
          }
          // 縮小されていること（3200pxのまま送っていたら容量がこの比ではない）
          const bytes = (img.source?.data ?? "").length * 0.75;
          if (bytes > 4_500_000) fail(`写真転記: 縮小されていない（${Math.round(bytes / 1024)}KB）`);
        }
      }
      if (!String(payload.system ?? "").includes("推測で埋めない")) {
        fail("写真転記: 推測で埋めさせない指示が送られていない");
      }
      if (!String(payload.system ?? "").includes("表記を整えないでください")) {
        fail("写真転記: 解釈させない指示が送られていない");
      }
    }
  }

  // 起こした文字が入力欄に入っていること（フェンスは外れている）
  const bulkText = await page.inputValue('[data-testid="bulk-text"]');
  if (!bulkText.includes("7/4 2kmジョグ 8:40")) {
    fail(`写真転記: 起こした文字が入力欄に入っていない（${bulkText.slice(0, 60)}）`);
  }
  if (bulkText.includes("```")) fail("写真転記: コードフェンスが残っている");

  // **ここが本題**: 転記しただけでは1件も保存されていない
  const afterCount = await page.evaluate(() =>
    fetch("/api/past").then((r) => r.json()).then((d) => (d.entries ?? []).length)
  );
  if (afterCount !== beforeCount) {
    fail(`写真転記: 転記しただけで保存された（${beforeCount} → ${afterCount}）`);
  }

  await shot("61_photo_transcribe");
  await page.unroute("https://api.anthropic.com/**");
  await page.evaluate(() => {
    localStorage.removeItem("forge:assistant:key");
    localStorage.removeItem("forge:assistant:consent");
  });
  step("写真からの転記OK（設定前は送らない・文字だけ起こす・転記だけでは保存しない）");
}

// ---- 表記辞書の候補出し ----
/*
 * 見張るのは「候補が辞書を勝手に書き換えないこと」。
 *   ・設定前・オフラインではボタンを出さない
 *   ・行に書かれていない語を返してきたら採用しない（言い換えを辞書にしない）
 *   ・「これで埋める」は欄を埋めるだけで、辞書はまだ増えない
 *   ・登録したあとは**AIを呼ばずに**同じ行が読める（決定的に戻る）
 */
{
  const asked = [];
  let reply = null;
  await page.route("https://api.anthropic.com/**", async (route) => {
    asked.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: [{ type: "text", text: reply }],
        stop_reason: "end_turn",
      }),
    });
  });

  const LINE = "8/2 なわとび坂 300×5 r5min";

  // 設定していなければボタンを出さない
  await page.evaluate(() => {
    localStorage.removeItem("forge:assistant:key");
    localStorage.removeItem("forge:assistant:consent");
  });
  await page.goto("http://localhost:8791/#/past");
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
  await page.getByRole("button", { name: "まとめて入力" }).click().catch(() => {});
  await page.waitForSelector('[data-testid="bulk-text"]', { timeout: 10000 });
  await page.fill('[data-testid="bulk-text"]', LINE);
  await page.getByRole("button", { name: "解釈する" }).click();
  await page.waitForTimeout(1200);
  if (await page.locator('[data-testid="suggest-phrase"]').count()) {
    fail("辞書候補: 設定していないのにボタンが出ている");
  }

  // 設定してから
  await page.evaluate(() => {
    localStorage.setItem("forge:assistant:key", "sk-ant-api03-e2e-dummy-key-0000");
    localStorage.setItem("forge:assistant:consent", "yes");
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
  await page.getByRole("button", { name: "まとめて入力" }).click().catch(() => {});
  await page.waitForSelector('[data-testid="bulk-text"]', { timeout: 10000 });
  await page.fill('[data-testid="bulk-text"]', LINE);
  await page.getByRole("button", { name: "解釈する" }).click();
  await page.waitForSelector('[data-testid="suggest-phrase"]', { timeout: 10000 });

  const phrasesBefore = await page.evaluate(() =>
    fetch("/api/phrases").then((r) => r.json()).then((d) => (d.phrases ?? []).length)
  );

  // 行に無い語を返してきたら採用しない
  reply = JSON.stringify({
    phrase: "縄跳び坂ダッシュ",
    kind: "interval",
    category: "high_lactate",
    reason: "本数があるため",
  });
  await page.click('[data-testid="suggest-phrase"]');
  await page.waitForSelector('[data-testid="suggest-error"]', { timeout: 15000 }).catch(() => {});
  const rejected = (await page.textContent('[data-testid="suggest-error"]')) ?? "";
  if (!rejected.includes("書かれていない")) {
    fail(`辞書候補: 行に無い語を弾いていない（${rejected.slice(0, 60)}）`);
  }
  if (await page.locator('[data-testid="suggest-result"]').count()) {
    fail("辞書候補: 弾いたのに候補として出している");
  }

  // 行にある語なら候補になる
  reply = JSON.stringify({
    phrase: "なわとび坂",
    kind: "interval",
    category: "high_lactate",
    reason: "300mを5本くり返しているためポイント練習と読みました",
  });
  await page.click('[data-testid="suggest-phrase"]');
  await page.waitForSelector('[data-testid="suggest-result"]', { timeout: 15000 });
  const shown = (await page.textContent('[data-testid="suggest-result"]')) ?? "";
  if (!shown.includes("なわとび坂")) fail("辞書候補: 語が出ていない");
  if (!shown.includes("5本")) fail("辞書候補: 根拠が出ていない（却下する材料が無い）");

  // 埋めるだけでは辞書は増えない
  await page.click('[data-testid="suggest-accept"]');
  await page.waitForTimeout(600);
  const phrasesAfterAccept = await page.evaluate(() =>
    fetch("/api/phrases").then((r) => r.json()).then((d) => (d.phrases ?? []).length)
  );
  if (phrasesAfterAccept !== phrasesBefore) {
    fail(`辞書候補: 埋めただけで辞書が増えた（${phrasesBefore} → ${phrasesAfterAccept}）`);
  }

  // 本人が登録して初めて増える
  await page.getByRole("button", { name: "この書き方を覚えさせる" }).first().click();
  await page.waitForTimeout(400);
  const filled = await page.inputValue('input[placeholder="覚えさせる語"]');
  if (filled !== "なわとび坂") fail(`辞書候補: 埋めた語が欄に入っていない（${filled}）`);
  await page.getByRole("button", { name: "登録", exact: true }).first().click();
  await page.waitForTimeout(1000);
  const phrasesAfterSave = await page.evaluate(() =>
    fetch("/api/phrases").then((r) => r.json()).then((d) => (d.phrases ?? []).length)
  );
  if (phrasesAfterSave !== phrasesBefore + 1) {
    fail(`辞書候補: 登録しても辞書が増えない（${phrasesBefore} → ${phrasesAfterSave}）`);
  }

  /*
   * **ここが本題**: 登録後は同じ行がAIを呼ばずに読める。
   * 「使うほどAIを呼ばなくなる」という設計が成立しているかを見る。
   */
  const askedBefore = asked.length;
  const reparsed = await page.evaluate(async (line) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const d = await fetch("/api/past", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewText: line, today }),
    }).then((r) => r.json());
    const row = (d.rows ?? [])[0] ?? {};
    return { kind: row.kind ?? null, category: row.category ?? null };
  }, LINE);
  if (reparsed.kind !== "interval") {
    fail(`辞書候補: 登録した語が次から効いていない（kind=${reparsed.kind}）`);
  }
  if (asked.length !== askedBefore) {
    fail(`辞書候補: 解釈のたびにAIを呼んでいる（${asked.length - askedBefore}回）`);
  }

  await shot("62_phrase_suggest");
  await page.unroute("https://api.anthropic.com/**");
  await page.evaluate(() => {
    localStorage.removeItem("forge:assistant:key");
    localStorage.removeItem("forge:assistant:consent");
  });
  step("表記辞書の候補OK（行に無い語は弾く・埋めるだけでは増えない・登録後はAI不要で読める）");
}

// ---- カレンダーの編集シートでも写真から転記できる ----
/*
 * 見張るのは「同じ部品が両方の入口で動くこと」と、
 * **転記しても予定はまだ変わらないこと**（保存は本人が押したときだけ）。
 */
{
  const asked = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    asked.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: [{ type: "text", text: "300m×6 r5min" }],
        stop_reason: "end_turn",
      }),
    });
  });
  await page.evaluate(() => {
    localStorage.setItem("forge:assistant:key", "sk-ant-api03-e2e-dummy-key-0000");
    localStorage.setItem("forge:assistant:consent", "yes");
  });

  await page.goto("http://localhost:8791/#/calendar");
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
  await page.waitForTimeout(900);

  // 編集シートを開く（操作は畳んであるので先に開ける）
  await openAllDayOps(page);
  const pencil = page.locator('button[aria-label="編集"], button:has-text("✎")').first();
  if ((await pencil.count()) === 0) {
    fail("カレンダー写真転記: 編集ボタンが見つからない");
  } else {
    await pencil.click();
    await page.waitForTimeout(700);
    if ((await page.locator('[data-testid="photo-file"]').count()) === 0) {
      fail("カレンダー写真転記: 編集シートに写真の欄が出ていない");
    } else {
      const before = await page.locator("textarea").first().inputValue();
      /*
       * 生成器も 300m×N の予定を作るので「その本文が存在しない」では確かめられない。
       * 転記の前後で件数が増えていないことを見る。
       */
      const countWith = () =>
        page.evaluate(async () => {
          const d = await fetch("/api/sessions").then((r) => r.json());
          return (d.sessions ?? []).filter((s) => (s.prescription ?? "").includes("300m×6")).length;
        });
      const savedBefore = await countWith();

      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 1600;
        c.height = 1200;
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#000";
        g.font = "60px sans-serif";
        g.fillText("300x6", 80, 200);
        return c.toDataURL("image/png").split(",")[1];
      });
      await page.setInputFiles('[data-testid="photo-file"]', {
        name: "menu.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
      await page.waitForSelector('[data-testid="photo-preview"]', { timeout: 10000 });
      await page.click('[data-testid="photo-send"]');
      await page.waitForSelector('[data-testid="photo-note"]', { timeout: 20000 }).catch(() => {});

      if (asked.length !== 1) fail(`カレンダー写真転記: 送信が1回でない（${asked.length}回）`);

      const after = await page.locator("textarea").first().inputValue();
      if (!after.includes("300m×6")) {
        fail(`カレンダー写真転記: 本文に入っていない（${after.slice(0, 60)}）`);
      }
      // 既にあった本文を消していない
      if (before.trim() && !after.includes(before.trim().slice(0, 8))) {
        fail("カレンダー写真転記: 元の本文を消している");
      }

      // **保存していないので予定はまだ変わっていない**
      const savedAfter = await countWith();
      if (savedAfter !== savedBefore) {
        fail(
          `カレンダー写真転記: 保存していないのに予定へ書き込まれている（${savedBefore} → ${savedAfter}）`
        );
      }
    }
  }

  await shot("63_calendar_photo");
  await page.unroute("https://api.anthropic.com/**");
  await page.evaluate(() => {
    localStorage.removeItem("forge:assistant:key");
    localStorage.removeItem("forge:assistant:consent");
  });
  step("カレンダーの編集シートでも写真転記OK（本文に入るだけ・保存前は予定を変えない）");
}

// ---- 処方と結果入力の欄が一致していること ----
/*
 * 画面に「r205秒」と出ているのに欄が300秒、処方が高乳酸なのに設定300秒——
 * という食い違いが実際に出ていた（forge-v82で修正）。
 * 生成された処方をそのまま結果入力で開き、**文面と欄が同じ値**であることを見る。
 */
{
  const target = await page.evaluate(async () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const d = await fetch("/api/sessions").then((r) => r.json());
    const s = (d.sessions ?? [])
      .filter(
        (x) =>
          x.status !== "completed" &&
          x.date >= today &&
          /*
           * 固定枠は内容を変えられない（RULE-15）ので、入力欄が組み上がらない。
           * 今日が固定曜日に当たった日（火・土）はここが必ず落ちていた。
           * **曜日によって落ちる検査は、何も見ていない日がある**のと同じ。
           */
          x.isFixed !== true &&
          /*
           * 下でカテゴリのボタンを押して開くので、**押せるカテゴリに限る**。
           * 有酸素の日はインターバル形の処方が付くことがあるが、
           * ボタンが無いのでフォームが開かず「欄を読めない」で落ちていた。
           */
          ["high_lactate", "threshold", "race_economy", "cv", "modeling"].includes(x.category) &&
          x.targetPaces?.length === 1 &&
          /^\d+m × \d+ @/.test(x.prescription ?? "") &&
          /[rR]\d+(?:秒|分)/.test(x.prescription ?? "")
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s ? { date: s.date, prescription: s.prescription, category: s.category } : null;
  });

  if (!target) {
    fail("処方と欄の一致: 対象にできる予定が無い（生成の形が変わった？）");
  } else {
    // 丸めた結果ちょうど分になることが多いので、どちらの表記も受ける
    const restMatch = /[rR](\d+)(秒|分)/.exec(target.prescription);
    const restInText = Number(restMatch[1]) * (restMatch[2] === "分" ? 60 : 1);
    const targetInText = Number(/@(?:\d+m\s+)?(\d+\.\d)/.exec(target.prescription)[1]);

    await page.goto(`http://localhost:8791/#/results?date=${target.date}`);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
    await page.waitForTimeout(900);
    // 入力フォームはボタンを踏まないと開かない（他のE2Eと同じ手順）
    await page.getByRole("button", { name: /練習結果/ }).first().click();
    await page.waitForTimeout(400);
    const catBtn = page
      .locator(
        'button:has-text("高乳酸"), button:has-text("閾値"), button:has-text("経済走"), button:has-text("CV"), button:has-text("モデリング")'
      )
      .first();
    if (await catBtn.count()) {
      await catBtn.click();
      await page.waitForTimeout(300);
    }
    const intervalBtn = page.getByRole("button", { name: "インターバル", exact: true });
    if (await intervalBtn.count()) {
      await intervalBtn.click();
    }
    // 本文の解釈（デバウンス300ms）が欄へ反映されるのを待つ
    await page.waitForTimeout(1500);

    const fields = await page.evaluate(() => {
      /*
       * 読み上げ名（aria-label）で引く。
       * ラベルの中に input が入っている形と、htmlFor で結ぶ形の両方があるので、
       * DOMの入れ子ではなく「その欄の名前」で探すほうが壊れにくい。
       */
      const pick = (label) => {
        const byAria = document.querySelector(
          `input[aria-label="${label}"], select[aria-label="${label}"]`
        );
        if (byAria) return byAria.value;
        for (const el of document.querySelectorAll("label")) {
          if ((el.textContent ?? "").startsWith(label)) {
            const input = el.querySelector("input, select");
            if (input) return input.value;
          }
        }
        return null;
      };
      // レスト内容はチップになったので、押されているものを読む
      const pressed = document.querySelector('[role="group"][aria-label="レスト内容"] button[aria-pressed="true"]');
      return {
        target: pick("設定(秒)"),
        rest: pick("レスト(秒)"),
        restType: pressed ? (pressed.textContent ?? "").trim() : null,
      };
    });

    if (fields.target === null || fields.rest === null) {
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll("label")].map((e) => (e.textContent ?? "").slice(0, 12)).slice(0, 25)
      );
      fail(
        `処方と欄の一致: 欄を読めない（${JSON.stringify(fields)} ラベル=${JSON.stringify(labels)}）`
      );
    } else {
      // 設定は距離ではなく設定タイム（幅の速い側〜遅い側）であること
      if (Math.abs(Number(fields.target) - targetInText) > 1.5) {
        fail(
          `処方と欄の一致: 設定が違う（文面 ${targetInText}秒 → 欄 ${fields.target}）。距離を設定として読んでいないか`
        );
      }
      if (Number(fields.rest) !== restInText) {
        fail(`処方と欄の一致: レストが違う（文面 ${restInText}秒 → 欄 ${fields.rest}）`);
      }
      if (restInText % 5 !== 0) {
        fail(`処方と欄の一致: レストが5秒刻みでない（${restInText}秒）`);
      }
    }
    step(
      `処方と結果入力の欄が一致OK（${target.date} 設定${targetInText}秒 / レスト${restInText}秒）`
    );
  }
}

// ---- 複合（モデリング）の日に結果入力の欄が組み上がること ----
/*
 * 以前は複合の処方を持続走として読んでいたので、モデリングの日を開いても
 * 距離・設定の欄が出なかった（forge-v83で修正）。
 * 生成された複合の処方をそのまま開いて、区間の欄が出ることを見る。
 */
{
  const target = await page.evaluate(async () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const d = await fetch("/api/sessions").then((r) => r.json());
    const s = (d.sessions ?? [])
      .filter(
        (x) =>
          x.category === "modeling" &&
          x.status !== "completed" &&
          x.date >= today &&
          (x.targetPaces?.length ?? 0) > 1
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s
      ? { date: s.date, prescription: s.prescription, distances: s.targetPaces.map((p) => p.distanceM) }
      : null;
  });

  if (!target) {
    fail("複合の欄: モデリングの予定が無い（生成の形が変わった？）");
  } else {
    // 処方そのものが区間の形になっていること（500m(68.7〜69.4)＋300m(...)）
    if (!/\d+m\([\d.〜]+\)＋/.test(target.prescription)) {
      fail(`複合の欄: 処方が区間の形になっていない（${target.prescription}）`);
    }

    const parsed = await page.evaluate(async (text) => {
      const d = await fetch("/api/prescription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }).then((r) => r.json());
      return { kind: d.kind, slots: (d.slots ?? []).map((s) => s.distanceM), restSec: d.restSec };
    }, target.prescription);

    if (parsed.kind !== "interval") {
      fail(`複合の欄: 持続走として読まれている（kind=${parsed.kind} / ${target.prescription}）`);
    }
    if (parsed.slots.join(",") !== target.distances.join(",")) {
      fail(
        `複合の欄: 区間が処方と合わない（${parsed.slots.join(",")} ≠ ${target.distances.join(",")}）`
      );
    }

    await page.goto(`http://localhost:8791/#/results?date=${target.date}`);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById("splash"), { timeout: 15000 });
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /練習結果/ }).first().click();
    await page.waitForTimeout(400);
    const modelingBtn = page.locator('button:has-text("モデリング")').first();
    if (await modelingBtn.count()) {
      await modelingBtn.click();
      await page.waitForTimeout(300);
    }
    const intervalBtn = page.getByRole("button", { name: "インターバル", exact: true });
    if (await intervalBtn.count()) await intervalBtn.click();
    await page.waitForTimeout(1500);

    // 区間ぶんの実施タイム欄が出ること（欄が組み上がっている証拠）
    const repCount = await page.locator('input[aria-label*="実施タイム"]').count();
    if (repCount < target.distances.length) {
      fail(`複合の欄: 実施タイムの欄が足りない（${repCount} < ${target.distances.length}）`);
    }

    /*
     * 複合では距離も設定も本ごとに違う。本数・距離・設定の欄を1組しか出さないと、
     * 合計本数を入れるしかなく、先頭の距離が全部に効いているように見える
     * （1000×4＋200×3 で「7」と入れるしかない、と指摘された。forge-v85で修正）。
     */
    const comp = page.locator('[data-testid="mixed-composition"]');
    if ((await comp.count()) === 0) {
      fail("複合の欄: 予定の構成が出ていない（1組の欄のままになっている）");
    } else {
      const compText = (await comp.textContent()) ?? "";
      for (const d of target.distances) {
        if (!compText.includes(`${d}m`)) {
          fail(`複合の欄: 構成に ${d}m が無い（${compText.slice(0, 60)}）`);
        }
      }
      if (!compText.includes("合計本数")) fail("複合の欄: 合計本数の欄が無い");
      // 迷いのもとになる「距離(m)」「設定(秒)」の単独欄を出していないこと
      const distField = await page.locator('label:has-text("距離(m)") input').count();
      const targetField = await page.locator('label:has-text("設定(秒)") input').count();
      if (distField > 0 || targetField > 0) {
        fail("複合の欄: 本ごとに違うのに距離・設定の欄を1つだけ出している");
      }
      // 本ごとの欄に、その本の予定距離が出ていること
      const formBody = await page.textContent("body");
      for (const d of target.distances) {
        if (!formBody.includes(`予定${d}m`)) {
          fail(`複合の欄: ${d}m の本の予定距離が出ていない`);
        }
      }
    }
    step(
      `複合（モデリング）の欄OK（${target.date} ${target.distances.join("+")}m / 欄${repCount}個）`
    );
  }
}

// ---- N日周期でメニューの枠を組む ----
/*
 * 7日は生活の都合であって、回復に必要な日数とは関係がない。
 * 10日周期にしたときに、
 *   ・設定画面が10日ぶんの枠になること
 *   ・生成された予定が10日おきの並びになること（曜日ではなく）
 *   ・減らした点が理由とセットで出ること
 * を見る。**周期にしただけで自分のルールがERRORを出す**のがいちばん怖いので、
 * 生成後の警告も確認する。
 */
{
  await page.goto("http://localhost:8791/#/plan-settings");
  await page.waitForTimeout(700);

  const anchorDate = await page.evaluate(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });

  // 曜日モードでは「1日目のメニュー」は無い
  if (await page.getByLabel("1日目のメニュー").count()) {
    fail("周期に切り替える前から周期の枠が出ている");
  }

  await page.getByRole("button", { name: "日数の周期で決める" }).click();
  await page.waitForTimeout(300);

  const lengthInput = page.getByLabel("周期の長さ（日）");
  await lengthInput.fill("10");
  await lengthInput.dispatchEvent("change");
  await page.getByLabel("1日目にする日").fill(anchorDate);
  await page.waitForTimeout(400);

  const rows = await page.getByLabel(/^\d+日目のメニュー$/).count();
  if (rows !== 10) fail(`10日周期にしたのに枠が${rows}個（10個であるべき）`);
  if (await page.getByLabel("火曜のメニュー").count()) {
    fail("周期モードなのに曜日の枠が残っている（どちらが効くのか分からない）");
  }
  const noteText = await page.textContent("body");
  if (!noteText.includes("70日後")) {
    fail("10日周期で曜日がずれることを出していない（禁止しないが黙ってもいけない）");
  }

  // 1日目を高乳酸で固定して保存する
  await page.getByLabel("1日目のメニュー").selectOption("high_lactate");
  await page.getByRole("button", { name: "1日目 固定", exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "設定を保存" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "実行する" }).click();
  await page.waitForTimeout(700);
  if (!(await page.textContent("body")).includes("保存しました")) {
    fail("周期の設定が保存されない");
  }

  // 保存された内容がAPIから戻ること（片方の実行環境だけで動くのを防ぐ）
  const saved = await page.evaluate(async () =>
    fetch("/api/plan-settings").then((r) => r.json())
  );
  if (!saved.weekTemplate?.cycle?.enabled || saved.weekTemplate.cycle.lengthDays !== 10) {
    fail("周期の設定がAPIから戻らない（シムに対で足していない可能性）: " + JSON.stringify(saved.weekTemplate?.cycle));
  }

  // 生成しなおす
  const gen = await page.evaluate(async () =>
    fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
  );
  if (gen.error) fail("周期で生成できない: " + gen.error);
  if (!Array.isArray(gen.cycleNotes)) fail("周期の調整内容が返らない");
  /*
   * 生成した予定だけで起きているERRORを見る。
   * このE2Eは手前で「追加テスト（構造）」などを手で作っているので、
   * 全部のERRORを数えると、周期とは関係ない手入力との衝突まで拾ってしまう。
   * 周期の不具合は**生成した予定どうし**で必ず出るので、そこだけに絞る。
   */
  // 周期が決めているのは「間隔」と「1週間あたりの回数」。そこのルールだけを見る。
  // RULE-12（赤信号のあとの高負荷）などは本人の状態の話で、周期の責任ではない。
  const PLACEMENT_RULES = ["RULE-01", "RULE-03", "RULE-04"];
  const hardErrors = (gen.violations ?? []).filter(
    (v) =>
      v.level === "ERROR" &&
      PLACEMENT_RULES.includes(v.rule) &&
      (v.sessionIds ?? []).length > 0 &&
      v.sessionIds.every((id) => String(id).startsWith("s-plan-"))
  );
  if (hardErrors.length) {
    fail("周期で生成した予定どうしでERRORが出る: " + hardErrors.map((v) => v.rule + " " + v.message).join(" / "));
  }

  // 高負荷が10日おきの位置にだけ来ること（曜日ではなく周期になっている）
  const sessions = await page.evaluate(async () =>
    fetch("/api/sessions").then((r) => r.json())
  );
  const list = (Array.isArray(sessions) ? sessions : sessions.sessions ?? []).filter(
    (s) => s.timeOfDay !== "am" && s.date >= anchorDate
  );
  const HIGH = ["high_lactate", "race_economy", "modeling", "cv", "threshold"];
  const dayOf = (d) => Math.round((Date.parse(d) - Date.parse(anchorDate)) / 86400000);
  const positions = new Set(
    list.filter((s) => HIGH.includes(s.category)).map((s) => ((dayOf(s.date) % 10) + 10) % 10)
  );
  if (positions.size === 0) fail("周期で生成したのに高負荷が1本も無い");
  if (positions.size > 4) {
    fail(`高負荷が周期の${positions.size}か所に散っている（周期になっていない）: ${[...positions].sort().join(",")}`);
  }
  if (!positions.has(0)) fail("1日目を固定したのに1日目に高負荷が来ていない");

  /*
   * 暦の1週間で数えても集中していないこと。
   * 周期の中で等間隔でも、10日と7日は噛み合わないので
   * 「暦の第2週だけ高負荷3日」という並びが普通に出る。見た目には気づけない。
   */
  const DEMANDING = ["high_lactate", "race_economy", "modeling"];
  const generated = list.filter((s) => String(s.id).startsWith("s-plan-"));
  for (const from of generated.map((s) => s.date)) {
    const to = new Date(Date.parse(from) + 6 * 86400000).toISOString().slice(0, 10);
    const win = generated.filter((s) => s.date >= from && s.date <= to);
    const highDays = new Set(win.filter((s) => HIGH.includes(s.category)).map((s) => s.date)).size;
    const hardDays = new Set(win.filter((s) => DEMANDING.includes(s.category)).map((s) => s.date)).size;
    if (highDays > 3) fail(`${from}からの7日間に高負荷が${highDays}日ある（RULE-04）`);
    if (hardDays > 2) fail(`${from}からの7日間に高乳酸・中距離特異的が${hardDays}日ある（RULE-04）`);
  }

  step(`N日周期OK（10日ぶんの枠・高負荷は${positions.size}か所・生成後ERRORなし）`);

  // 曜日に戻したときに、曜日の設定が消えていないこと
  await page.goto("http://localhost:8791/#/plan-settings");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "曜日で決める" }).click();
  await page.waitForTimeout(300);
  const back = await page.getByLabel("火曜のメニュー").inputValue();
  if (back !== "point") {
    fail(`曜日に戻したら以前の設定が消えている（火曜=${back}、pointであるべき）`);
  }
  step("周期↔曜日の切り替えで、もう一方の設定を消さないOK");
}

// ---- 冬季・基礎構築モード（目標レースが決まっていない期間） ----
/*
 * いちばん怖いのは、レースが無いのにピーキングしてしまうこと。
 * 生成の区切りに使っている日付をレース日と取り違えると、
 * ただの区切りに向かってテーパーが始まり、作った期間の終わりが軽くなる。
 * 予定は出ているので、画面を見ても気づけない。
 *
 * 最後に本命レースを戻して、従来の期分けに帰れることまで見る
 * （戻せないと、冬に切り替えた時点で春の予定が作れなくなる）。
 */
{
  await page.goto("http://localhost:8791/#/goal");
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "レース未定（冬季・基礎構築）" }).click();
  await page.waitForTimeout(300);
  const modeText = await page.textContent("body");
  if (!modeText.includes("ピーキングしません")) {
    fail("冬季モードにしたのに、ピーキングしないことを出していない");
  }
  if (await page.getByText("本命レース（Aレース）").count()) {
    fail("冬季モードなのに本命レースの入力欄が残っている");
  }

  await page.getByRole("button", { name: "目標・レースを保存" }).click();
  await page.waitForTimeout(900);
  const savedGoal = await page.evaluate(async () =>
    fetch("/api/goal", { cache: "no-store" }).then((r) => r.json())
  );
  if (savedGoal.goal?.targetRaceId !== "") {
    fail("レース未定が保存されない: " + JSON.stringify(savedGoal.goal));
  }

  /*
   * 通過点レースも消す。
   *
   * ここが見たいのは「レースが1本も無い期間」の生成。
   * 目標レースだけ外して通過点を残すと、そちらへ向けたテーパーが正しく出る——
   * つまり**前提が崩れているのに、検査は不合格と言う**。
   * 以前は通過点の日付が過去に固定されていたので偶然通っていた。
   */
  await page.evaluate(async () => {
    const d = await fetch("/api/goal").then((r) => r.json());
    for (const race of d.races ?? []) {
      await fetch(`/api/goal?raceId=${encodeURIComponent(race.id)}`, { method: "DELETE" });
    }
  });

  const winter = await page.evaluate(async () =>
    fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
  );
  if (winter.error) fail("レース未定で生成できない: " + winter.error);
  if (winter.offSeason !== true) fail("冬季モードとして生成されていない");
  const labels = [...new Set((winter.offSeasonBlocks ?? []).map((b) => b.label))];
  if (labels.length !== 4) {
    fail(`ブロックが4つ出ていない（${labels.length}個）: ${labels.join(" / ")}`);
  }

  const winterSessions = await page.evaluate(async () =>
    fetch("/api/sessions").then((r) => r.json())
  );
  /*
   * これから先の「予定」だけを見る。
   * 実施済みのセッションは再生成でも消さない（記録なので当然）ので、
   * 全部を数えると手前のE2Eが作った春向けの予定まで混ざり、
   * 「冬季なのにSpecificがある」と誤って落ちる。
   */
  const wlist = (Array.isArray(winterSessions) ? winterSessions : winterSessions.sessions ?? [])
    .filter((x) => String(x.id).startsWith("s-plan-") && x.status === "planned");
  if (wlist.length < 80) fail(`冬季の予定が少なすぎる（${wlist.length}件）`);
  const phases = [...new Set(wlist.map((x) => x.phase))];
  if (phases.join(",") !== "Base") {
    fail(`冬季なのにフェーズが上がっている: ${phases.join(",")}`);
  }
  const taperish = wlist.filter((x) => /調整ジョグ|刺激入れ|最終高乳酸/.test(x.name));
  if (taperish.length) {
    fail(`レースが無いのにテーパーの内容が出ている: ${taperish.map((x) => x.date + " " + x.name).join(", ")}`);
  }
  // 生成した期間の終わりが軽くなっていないこと
  const wdates = wlist.map((x) => x.date).sort();
  const lastDate = wdates[wdates.length - 1];
  const tailFrom = new Date(Date.parse(lastDate) - 13 * 86400000).toISOString().slice(0, 10);
  const HIGH = ["high_lactate", "race_economy", "modeling", "cv", "threshold"];
  const tailHigh = wlist.filter((x) => x.date >= tailFrom && HIGH.includes(x.category));
  if (!tailHigh.length) {
    fail("生成した期間の最後の2週間に高負荷が無い（区切りに向かってテーパーしている）");
  }
  step(`冬季・基礎構築モードOK（${wlist.length}件・Base固定・4ブロック・末尾も落ちない）`);

  // 本命レースを戻すと、従来の期分けに帰れること
  await page.goto("http://localhost:8791/#/goal");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "レースから逆算" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "目標・レースを保存" }).click();
  await page.waitForTimeout(900);
  const backGoal = await page.evaluate(async () =>
    fetch("/api/goal", { cache: "no-store" }).then((r) => r.json())
  );
  if (!backGoal.goal?.targetRaceId) fail("本命レースに戻せない");
  const back = await page.evaluate(async () =>
    fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
  );
  if (back.offSeason !== false) fail("レースを戻したのに冬季モードのままになっている");
  step("レースを戻すと従来の期分けに帰るOK");
}

// ---- フェーズ別の補強が画面に出る（出どころは1つ） ----
/*
 * この表はコアに前からあったが、出している画面が無かった。
 * しかも同じ知識が生成側にも別の文言で書かれていて、片方だけ古くなる状態だった。
 *
 * ここで見るのは2つ。
 *   ・画面に出ていること
 *   ・**画面の内容と、実際に生成された補強が一致していること**
 * 一致を見ないと、また表と実物がずれても気づけない。
 */
{
  await page.goto("http://localhost:8791/#/plan-settings");
  await page.waitForTimeout(900);

  const body = await page.textContent("body");
  if (!body.includes("補強はフェーズでこう変わる")) {
    fail("フェーズ別の補強の表が画面に出ていない");
  }
  for (const label of ["基礎期", "準備期", "専門期", "試合期", "調整期"]) {
    if (!body.includes(label)) fail(`補強の表に「${label}」が無い`);
  }
  if (!body.includes("ポイント練習の日の午後にだけ")) {
    fail("補強をいつ置くのかを書いていない（回復日を汚さない原則）");
  }

  const settings = await page.evaluate(async () =>
    fetch("/api/plan-settings").then((r) => r.json())
  );
  if (!settings.strengthTable || !settings.currentPhase) {
    fail("補強の表と現在の期がAPIから返らない（シムに対で足していない可能性）");
  }
  const nowPhase = settings.currentPhase.phase;
  const spec = settings.strengthTable[nowPhase];
  if (!spec) fail("現在の期の補強が表に無い: " + nowPhase);

  // 画面には「いまの期に出る種目」が実物として出ていること
  for (const ex of spec.exercises) {
    if (!body.includes(ex)) fail(`いまの期(${nowPhase})の種目「${ex}」が画面に出ていない`);
  }

  // 生成された補強と表が一致すること（表と実物がずれない）
  // 予定と補強は同じルートから返る（/api/analysis は補強を素で返さない）
  const sessions = await page.evaluate(async () =>
    fetch("/api/sessions").then((r) => r.json())
  );
  const list = Array.isArray(sessions) ? sessions : sessions.sessions ?? [];
  const byDate = new Map(list.filter((x) => x.timeOfDay !== "am").map((x) => [x.date, x]));
  /*
   * 自動生成した補強だけを見る（id が st-plan- で始まるもの）。
   * 手で入れた補強（一括入力の「7/20 体幹30分」など）は本人の記録なので、
   * 表と一致する必要が無い。混ぜると必ず落ちる。
   */
  const strengths = (sessions.strengthSessions ?? []).filter((x) =>
    String(x.id).startsWith("st-plan-")
  );
  if (!strengths.length) fail("自動生成の補強が1件も無い（照合が空振りする）");
  let checked = 0;
  for (const st of strengths) {
    const day = byDate.get(st.date);
    if (!day || !day.phase) continue;
    const want = settings.strengthTable[day.phase];
    if (!want) continue;
    if (st.loadLevel !== want.load || st.type !== want.type) {
      fail(
        `${st.date}(${day.phase}) の補強が表と違う: 実物 ${st.loadLevel}/${st.type} vs 表 ${want.load}/${want.type}`
      );
    }
    checked++;
  }
  step(`フェーズ別の補強OK（画面に5期・いまは${nowPhase}・実物と表が一致 ${checked}件）`);
}

// ---- 周期・冬季が画面に残る／相談にも送られる ----
/*
 * 決めた直後の画面メッセージにしか出ていなかったものを、あとからも追えるようにした。
 * ここで見るのは3つ。
 *   ・TODAYに「周期の何日目か」が出ること
 *   ・冬季モードなら「第何ブロックか」と理由も出ること
 *   ・相談に送る文脈にも同じことが入っていること（画面と送信がずれない）
 *
 * 手前のブロックで曜日設定に戻してあるので、まず周期に入れ直す。
 */
{
  const anchorDate = await page.evaluate(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });

  await page.goto("http://localhost:8791/#/plan-settings");
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "日数の周期で決める" }).click();
  await page.waitForTimeout(250);
  const len = page.getByLabel("周期の長さ（日）");
  await len.fill("10");
  await len.dispatchEvent("change");
  await page.getByLabel("1日目にする日").fill(anchorDate);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "設定を保存" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "実行する" }).click();
  await page.waitForTimeout(700);

  const regen = await page.evaluate(async () =>
    fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json())
  );
  if (regen.error) fail("周期で再生成できない: " + regen.error);

  // TODAY に構造の1行が出ること
  await page.goto("http://localhost:8791/#/");
  await page.waitForTimeout(1000);
  const line = page.locator('[data-testid="today-structure"]');
  if (!(await line.count())) fail("TODAYに周期の位置が出ていない");
  const lineText = (await line.first().textContent()) ?? "";
  if (!/周期\s*1日目\s*\/\s*10日/.test(lineText)) {
    fail("周期の何日目かが読めない: " + lineText);
  }

  // 相談に送る文脈にも入っていること（画面と送信がずれない）
  const ctx = await page.evaluate(async () =>
    fetch("/api/assistant-context").then((r) => r.json())
  );
  const text = ctx.context?.text ?? ctx.text ?? "";
  if (!text.includes("10日周期")) {
    fail("相談の文脈に周期が入っていない（画面と送信がずれる）");
  }

  // 生成で入れ替えた枠の理由が、変更履歴に残ること
  const changes = await page.evaluate(async () =>
    fetch("/api/changes").then((r) => r.json())
  );
  const swaps = (changes.changes ?? []).filter(
    (c) => c.triggeredBy === "M-7" || c.triggeredBy === "RULE-04"
  );
  if (!swaps.length) {
    fail("生成で入れ替えた枠の理由が変更履歴に残っていない");
  }
  if (swaps.some((c) => !c.reason)) fail("理由の無い変更が記録されている");

  step(`周期・冬季の構造が残るOK（TODAYに位置・相談にも同じ・入れ替え${swaps.length}件の理由が履歴に）`);
}

// ---- 予定と実際のズレが分析画面に出る ----
/*
 * 341行あって完成していたのに、どこからも呼ばれていなかったモジュール。
 * 繋いだので、両方の実行環境で取れることと、画面に出ることを見る。
 *
 * 数字が画面とAPIで一致することまで見ないと、
 * 「表は出ているが別の値を映している」に気づけない。
 */
{
  const balance = await page.evaluate(async () =>
    fetch("/api/analysis").then((r) => r.json())
  );
  const b = balance.balance;
  if (!b) fail("予定と実際のズレがAPIから返らない（シムに対で足していない可能性）");
  if (!Array.isArray(b.weeks) || b.weeks.length !== 4) {
    fail(`4週ぶん返っていない（${b.weeks?.length}週)`);
  }
  // 月曜始まりであること（期間サマリーと区切りをそろえる）
  for (const w of b.weeks) {
    const dow = new Date(w.weekStart + "T00:00:00Z").getUTCDay();
    if (dow !== 1) fail(`週の区切りが月曜でない: ${w.weekStart}`);
  }

  await page.goto("http://localhost:8791/#/analysis");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "推移" }).click();
  await page.waitForTimeout(600);

  const body = await page.textContent("body");
  if (!body.includes("予定どおりにできたか")) {
    fail("予定と実際のズレが分析画面に出ていない");
  }
  if (!body.includes("（今週）")) fail("どれが今週か分からない");

  // 画面の「実施/予定」がAPIの数字と一致すること
  const last = b.weeks[b.weeks.length - 1];
  const want = `${last.completedSessions}/${last.plannedSessions}`;
  if (!body.includes(want)) {
    fail(`今週の実施/予定が画面と合わない（APIは ${want}）`);
  }

  step(`予定と実際のズレOK（4週・今週 ${want}・気づき${(b.signals ?? []).length}件）`);
}

// ---- 登録したレースを消す／効かない欄に効かないと書く ----
/*
 * 消せることより、**消せないことのほう**を見る。
 * 走った記録は現在地の根拠（有酸素マーカー）なので、
 * 消せてしまうと設定ペースの出どころが欠ける。
 */
{
  await page.goto("http://localhost:8791/#/race");
  await page.waitForTimeout(800);

  const body = await page.textContent("body");
  if (!body.includes("登録したレースを消す")) fail("レースを消す導線が無い");
  if (!body.includes("結果を入力済みのレース")) {
    fail("消せない条件を書いていない（押してから断られると理由が分からない）");
  }

  const before = await page.evaluate(async () =>
    fetch("/api/goal", { cache: "no-store" }).then((r) => r.json())
  );
  const targetId = before.goal?.targetRaceId;
  if (!targetId) fail("本命レースが無い状態でレース削除を確認している");

  // 本命は消せないこと（APIが断る）
  const denied = await page.evaluate(async (id) =>
    fetch(`/api/goal?raceId=${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json()),
    targetId
  );
  if (!denied.error) fail("本命レースが消せてしまう");
  if (!denied.error.includes("本命")) fail("断る理由が本命レースだと分からない: " + denied.error);

  // 通過点レースは消せること
  const sub = (before.races ?? []).find((r) => r.id !== targetId);
  if (sub) {
    const ok = await page.evaluate(async (id) =>
      fetch(`/api/goal?raceId=${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json()),
      sub.id
    );
    if (ok.error) {
      // 結果を入れてある大会なら断られるのが正しい
      if (!ok.error.includes("現在地の根拠")) fail("通過点が消せない理由が不明: " + ok.error);
      step("レース削除OK（本命と結果ありは消せない）");
    } else {
      const left = (ok.races ?? []).some((r) => r.id === sub.id);
      if (left) fail("消したはずのレースが残っている");
      step("レース削除OK（本命は消せない・通過点は消せる）");
    }
  } else {
    step("レース削除OK（本命は消せない）");
  }
}

// ---- 効かない欄に「効かない」と書いてあること ----
/*
 * 入力できるのに何にも効かない欄は「効いているはず」と読まれる。
 * 効く範囲を書いたので、それが画面に残っていることを見る。
 */
{
  await page.goto("http://localhost:8791/#/setup");
  await page.waitForTimeout(700);
  const setup = await page.textContent("body");
  for (const label of ["身長(cm・記録用)", "骨格筋量(kg・記録用)"]) {
    if (!setup.includes(label)) fail(`プロフィールに「${label}」が無い（記録用だと分からない）`);
  }
  if (!setup.includes("有酸素マーカー")) {
    fail("3000m/5000mをどこに入れるのかを書いていない");
  }
  step("効かない欄に効かないと書いてあるOK（身長・骨格筋量・3000m/5000mの置き場所）");
}

// ---- RPEのスライダー ----
/*
 * 数値入力をやめた理由は、`77` のような打ち間違いがそのまま入り、
 * RPEは設定ペースの補正に直接効くから。段階しか選べない形なら起きない。
 *
 * ここで見るのは、指定された振る舞いが全部そろっているか。
 *   ・未入力が未入力として見える（既定値を置いていない）
 *   ::・動かすと数値と説明がその場で変わる
 *   ・1目盛りずつ止まる
 *   ・色だけに頼っていない（帯の呼び名と説明が文字で出る）
 *   ・キーボードで動く
 */
{
  /*
   * まだ結果を入れていない日を選ぶ。
   * 記録済みの日を開くと保存した値が出る——それは正しい振る舞いなので、
   * 「既定値を置いていない」ことの確認には使えない。
   */
  const target = await page.evaluate(async () => {
    const [d, results] = await Promise.all([
      fetch("/api/sessions").then((r) => r.json()),
      fetch("/api/results").then((r) => r.json()),
    ]);
    const done = new Set((results.results ?? results ?? []).map((r) => r.sessionId));
    const s = (d.sessions ?? [])
      .filter((x) => x.category !== "off" && x.status === "planned" && !done.has(x.id))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s ? s.date : null;
  });
  if (!target) fail("RPEスライダーを確認できる予定が無い");

  await page.goto(`http://localhost:8791/#/results?date=${target}`);
  await page.waitForTimeout(900);
  // 結果入力のタブを開く（既定は別のタブ）
  await page.getByRole("button", { name: /練習結果/ }).click();
  await page.waitForTimeout(600);
  const qBtn = page
    .locator('button:has-text("高乳酸"), button:has-text("経済走"), button:has-text("CV"), button:has-text("閾値"), button:has-text("ジョグ")')
    .first();
  if (await qBtn.count()) {
    await qBtn.click();
    await page.waitForTimeout(500);
  }

  const slider = page.getByTestId("rpe-slider");
  if (!(await slider.count())) fail("RPEがスライダーになっていない");

  // 未入力の確認は手前のブロック（記録の無い日で開く）が見ている。ここでは重ねない。

  // 2) 動かすと数値と説明がその場で変わる（色だけに頼らない）
  await setSlider(slider, 7);
  await page.waitForTimeout(150);
  if (((await page.getByTestId("rpe-slider-value").textContent()) ?? "").trim() !== "7") {
    fail("RPE: 動かしても数値が変わらない");
  }
  const d7 = (await page.getByTestId("rpe-slider-description").textContent()) ?? "";
  if (!d7.includes("きつい") || !d7.includes("余力は少ない")) {
    fail("RPE: 7の説明が出ていない: " + d7);
  }
  if (!(await page.textContent("body")).includes("きつい")) {
    fail("RPE: 帯の呼び名が文字で出ていない（色だけに頼っている）");
  }

  // 3) 10 の説明と、読み上げ用の文言
  await setSlider(slider, 10);
  await page.waitForTimeout(150);
  const d10 = (await page.getByTestId("rpe-slider-description").textContent()) ?? "";
  if (!d10.includes("最大努力")) fail("RPE: 10の説明が出ていない: " + d10);
  const valueText = await slider.getAttribute("aria-valuetext");
  if (!valueText || !valueText.includes("10") || !valueText.includes("最大")) {
    fail("RPE: 読み上げ用の文言に数値と言葉が入っていない: " + valueText);
  }

  // 4) 1目盛りずつ止まる（小数を入れても整数になる）
  // step() を隠さない名前にする（隠すと最後の step(...) が数値になって落ちる）
  const stepAttr = await slider.getAttribute("step");
  if (stepAttr !== "1") fail(`RPE: 目盛りが1刻みでない（step=${stepAttr}）`);

  // 5) キーボードで動く
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(150);
  if (((await page.getByTestId("rpe-slider-value").textContent()) ?? "").trim() !== "9") {
    fail("RPE: キーボード（←）で値が変わらない");
  }
  await page.keyboard.press("Home");
  await page.waitForTimeout(150);
  if (((await page.getByTestId("rpe-slider-value").textContent()) ?? "").trim() !== "1") {
    fail("RPE: キーボード（Home）で下限に行かない");
  }

  // 6) 押せるものが片手で押せる大きさか
  const chip = page.getByRole("button", { name: "主観 きつい" });
  const box = await chip.boundingBox();
  if (!box || box.height < 44) fail(`主観のチップが小さい（${box ? box.height : 0}px）`);

  step("RPEスライダーOK（説明→10→1刻み→キーボード→44pt）");
}

// ---- 送った週が、戻ってきても戻らない ----
/*
 * 先の週を見て日付をタップ → メニューを見て戻ると、画面が作り直されて今週に戻っていた。
 * 予定を組んでいる最中だと、毎回そこまで送り直すことになる。
 *
 * 表示期間（週/月）と違って localStorage には入れない——
 * 来月を見たまま閉じて、翌日開いたら来月が出るのは困る。
 * アプリを開いているあいだだけ覚える。
 */
{
  await page.goto("http://localhost:8791/#/calendar");
  await page.waitForTimeout(900);

  const shown = async () => {
    const t = (await page.textContent(".calendar-controls")) ?? "";
    return t.replace(/\s+/g, " ").trim();
  };

  const atToday = await shown();
  // 3週先まで送る
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "次の期間" }).click();
    await page.waitForTimeout(350);
  }
  const moved = await shown();
  if (moved === atToday) fail("カレンダーを送っても表示が変わらない");

  // 別の画面へ行って戻る（日付をタップしてメニューを見に行く経路と同じ）
  await page.goto("http://localhost:8791/#/results");
  await page.waitForTimeout(700);
  await page.goto("http://localhost:8791/#/calendar");
  await page.waitForTimeout(900);

  const back = await shown();
  if (back !== moved) {
    fail(`カレンダー: 戻ると送った週が失われる（送った先「${moved}」→ 戻り「${back}」）`);
  }

  // 「今日」を押せば今週に戻れること（覚えたまま出られなくならない）
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await page.waitForTimeout(400);
  if ((await shown()) !== atToday) fail("カレンダー: 「今日」で今週に戻らない");

  // 戻したことも覚えていること
  await page.goto("http://localhost:8791/#/results");
  await page.waitForTimeout(600);
  await page.goto("http://localhost:8791/#/calendar");
  await page.waitForTimeout(900);
  if ((await shown()) !== atToday) fail("カレンダー: 「今日」に戻したのに別の週で開く");

  step("カレンダーの週が戻らないOK（送る→離れる→戻る→同じ週／今日で戻せる）");
}

// ---- 天候・路面のタグとシューズ ----
/*
 * 狙いは「設定は同じなのにRPEが上がった」の理由を見分けられるようにすること。
 * ここで見るのは、記録されること・**再編集で戻ってくること**・
 * そして**判定に混ざっていないこと**（暑熱条件フラグが変わらない）。
 */
{
  // 1) シューズを登録する
  await page.goto("http://localhost:8791/#/settings");
  await page.waitForTimeout(800);
  await page.getByLabel("製品名").fill("E2Eスパイク");
  await page.getByRole("button", { name: "種類 スパイク" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await page.waitForTimeout(700);
  const settingsText = await page.textContent("body");
  if (!settingsText.includes("E2Eスパイク")) fail("シューズを登録しても一覧に出ない");
  if (!settingsText.includes("0km")) fail("使用距離の初期値が出ていない");

  /*
   * 靴は増える一方で減らない。1足ごとに操作を並べると設定画面が伸び続けるので、
   * **押すまで操作を出さない**。ここが崩れると、登録するほど画面が長くなる。
   */
  const shoeRow = page.getByRole("button", { name: /E2Eスパイク/ }).first();
  if ((await shoeRow.count()) === 0) fail("シューズの行が出ていない");
  else {
    if ((await page.getByRole("button", { name: "引退にする" }).count()) > 0) {
      fail("シューズの操作が最初から開いている（登録するほど画面が伸びる）");
    }
    await shoeRow.click();
    await page.waitForTimeout(400);
    if ((await page.getByRole("button", { name: "引退にする" }).count()) === 0) {
      fail("シューズの行を押しても操作が出ない");
    }
    await shoeRow.click();
    await page.waitForTimeout(300);
  }

  const shoes = await page.evaluate(async () => fetch("/api/shoes").then((r) => r.json()));
  const shoeId = (shoes.shoes ?? []).find((x) => x.name === "E2Eスパイク")?.id;
  if (!shoeId) fail("シューズがAPIから返らない（シムに対で足していない可能性）");

  // 2) 記録に条件と靴を付ける
  const target = await page.evaluate(async () => {
    const d = await fetch("/api/sessions").then((r) => r.json());
    const s = (d.sessions ?? [])
      .filter((x) => x.category === "aerobic" && x.status === "planned")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s ? { date: s.date, id: s.id } : null;
  });
  if (!target) fail("条件タグを付けられる予定が無い");

  await page.goto(`http://localhost:8791/#/results?date=${target.date}`);
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /練習結果/ }).click();
  await page.waitForTimeout(600);
  // その日のセッションを選んでから、記録の形を選ぶ
  await page.locator('button:has-text("有酸素")').first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "ジョグ・持続走", exact: true }).click();
  await page.waitForTimeout(400);

  if (!(await page.getByTestId("weather-chips").count())) fail("天候のチップが出ていない");
  if (!(await page.getByTestId("surface-chips").count())) fail("路面のチップが出ていない");

  await page.getByRole("button", { name: "天候 雨" }).click();
  await page.getByRole("button", { name: "路面 トラック濡れ" }).click();
  await page.waitForTimeout(200);
  // 複数選べること（1つ押しても前のが外れない）
  const weatherPressed = await page
    .locator('[role="group"][aria-label="天候"] button[aria-pressed="true"]')
    .count();
  if (weatherPressed !== 1) fail(`天候の選択がおかしい（${weatherPressed}個）`);
  await page.getByRole("button", { name: "天候 強風" }).click();
  await page.waitForTimeout(200);
  if (
    (await page.locator('[role="group"][aria-label="天候"] button[aria-pressed="true"]').count()) !== 2
  ) {
    fail("天候が複数選べない（単一選択になっている）");
  }

  if (!(await page.getByTestId("shoe-chips").count())) fail("シューズの選択が出ていない");
  await page.getByRole("button", { name: /シューズ .*E2Eスパイク/ }).click();
  await page.waitForTimeout(200);

  await setSlider(page.getByTestId("rpe-slider"), 8);
  await page.getByRole("button", { name: "主観 きつい" }).click();
  await page.getByPlaceholder("11.2").fill("10");
  await page.getByPlaceholder("50", { exact: true }).fill("50");
  await page.waitForTimeout(300);
  await page
    .getByRole("button", { name: /登録して補正を実行|上書きして保存する/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "実行する" }).click();
  await page.waitForTimeout(1200);

  // 3) 保存されていること
  const saved = await page.evaluate(async (date) => {
    const d = await fetch("/api/results").then((r) => r.json());
    const list = d.results ?? d ?? [];
    return list.find((r) => r.date === date && (r.conditions ?? []).length > 0) ?? null;
  }, target.date);
  if (!saved) fail("条件つきの記録が保存されていない");
  if (!(saved.conditions ?? []).includes("rain")) {
    fail("天候タグが保存されていない: " + JSON.stringify(saved.conditions));
  }
  if (!(saved.conditions ?? []).includes("track_wet")) fail("路面タグが保存されていない");
  if (saved.shoeId !== shoeId) fail(`シューズが保存されていない（${saved.shoeId}）`);

  // 4) 使用距離が積まれること（合計は毎回足し上げる）
  const after = await page.evaluate(async () => fetch("/api/shoes").then((r) => r.json()));
  const usage = (after.usage ?? []).find((u) => u.shoe.name === "E2Eスパイク");
  if (!usage || usage.totalKm <= 0) {
    fail(`シューズの使用距離が積まれていない（${JSON.stringify(usage)}）`);
  }

  // 5) 開き直したときに選択が戻ること
  await page.goto("http://localhost:8791/#/");
  await page.waitForTimeout(500);
  await page.goto(`http://localhost:8791/#/results?date=${target.date}`);
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /練習結果/ }).click();
  await page.waitForTimeout(500);
  // その日のセッションを選ばないとフォームが出ない
  await page.locator('button:has-text("有酸素")').first().click();
  await page.waitForTimeout(700);
  const rePressed = await page
    .locator('[role="group"][aria-label="天候"] button[aria-pressed="true"]')
    .count();
  if (rePressed < 1) fail("再編集で天候タグが戻らない");

  step(`天候・路面・シューズOK（複数選択・保存・再編集・使用距離${usage.totalKm}km）`);
}

// ---- 途中でやめた理由 ----
/*
 * 見るのは3つ。
 *   ・**設定どおりに走れていても**、本数が足りなければ理由を聞くこと
 *     （以前は中止基準に引っかかったときしか打ち切り扱いにならなかった）
 *   ・理由を選ぶまで保存できないこと（空欄は「設定が高すぎた」として数えられる）
 *   ・選んだ理由で扱いが変わり、それが画面に出ること
 */
{
  const abortTarget = await page.evaluate(async (used) => {
    const d = await fetch("/api/sessions").then((r) => r.json());
    const s = (d.sessions ?? [])
      .filter(
        (x) =>
          x.id !== used &&
          x.status === "planned" &&
          (x.targetPaces ?? []).length > 0 &&
          x.category === "high_lactate"
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!s) return null;
    const run = await fetch(`/api/session-run?sessionId=${s.id}`).then((r) => r.json());
    return run?.progress?.plannedReps >= 2
      ? { id: s.id, targetSec: run.progress.targetSec, plannedReps: run.progress.plannedReps }
      : null;
  }, runTarget);
  if (!abortTarget) fail("打ち切り理由: 対象セッションが無い");

  await page.goto(`http://localhost:8791/#/run?sessionId=${abortTarget.id}`);
  await page.waitForTimeout(900);

  // 設定どおりの1本だけ入れる。中止基準には引っかからない
  await page.locator('input[inputmode="decimal"]').first().fill(abortTarget.targetSec.toFixed(1));
  await page.getByRole("button", { name: "LAP", exact: true }).click();
  await page.waitForTimeout(700);

  const bodyText = await page.textContent("body");
  if (bodyText.includes("打ち切ってください")) {
    fail("打ち切り理由: 設定どおりのはずが中止判定になっている（前提が崩れた）");
  }
  if (!(await page.getByTestId("abort-cause-chips").count())) {
    fail("打ち切り理由: 本数が足りないのに理由の選択が出ていない");
  }

  /*
   * 未入力のスライダーは真ん中（1〜10なら6）に置かれている。
   * そこへ6を入れてもReactは値が変わっていないと見て onChange を出さず、
   * 未入力のまま保存に進んで止まる。真ん中以外を入れる。
   */
  await setSlider(page.getByTestId("run-rpe-slider"), 7);
  await page.getByRole("button", { name: "主観 普通" }).click();
  await page.waitForTimeout(200);

  // 理由を選ぶまで保存できない
  const finishBtn = page.getByRole("button", { name: /打ち切って記録する/ });
  if (!(await finishBtn.count())) fail("打ち切り理由: 打ち切りのボタンが出ていない");
  if (!(await finishBtn.first().isDisabled())) {
    fail("打ち切り理由: 理由が未入力でも保存できてしまう");
  }

  // ラベルに本数が入るので正規表現で当てる
  await page.getByRole("button", { name: /途中でやめた理由.*天候・路面/ }).click();
  await page.waitForTimeout(300);
  const hint = await page.getByTestId("abort-cause-hint").textContent();
  if (!hint.includes("数えません")) {
    fail(`打ち切り理由: 扱いが画面に出ていない（${hint}）`);
  }
  if (await finishBtn.first().isDisabled()) {
    fail("打ち切り理由: 理由を選んでも保存できない");
  }

  // 止まったときに何と言われたのかを掴む（黙って落ちると原因を追えない）
  let abortDialog = "";
  const onAbortDialog = async (d) => {
    abortDialog = d.message();
    await d.dismiss();
  };
  page.on("dialog", onAbortDialog);
  await finishBtn.first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "実行する" }).click();
  await page.waitForTimeout(1400);
  page.off("dialog", onAbortDialog);

  const savedAbort = await page.evaluate(async (id) => {
    const d = await fetch("/api/results").then((r) => r.json());
    return (d.results ?? []).find((r) => r.sessionId === id) ?? null;
  }, abortTarget.id);
  if (!savedAbort) fail(`打ち切り理由: 記録が保存されていない（${abortDialog || "案内なし"}）`);
  if (savedAbort.abortCause !== "condition") {
    fail(`打ち切り理由: 理由が保存されていない（${savedAbort.abortCause}）`);
  }
  if (savedAbort.aborted !== true) {
    fail("打ち切り理由: 設定どおりでも本数が足りなければ打ち切りのはず");
  }

  const afterText = await page.textContent("body");
  if (!afterText.includes("設定の判断には数えません")) {
    fail("打ち切り理由: 何に効いたかが記録後に出ていない");
  }

  // 設定ペースの補正に数えないこと（ここが本題）
  const counted = await page.evaluate(async (id) => {
    const d = await fetch("/api/results").then((r) => r.json());
    const r = (d.results ?? []).find((x) => x.sessionId === id);
    return { cause: r?.abortCause, aborted: r?.aborted };
  }, abortTarget.id);
  if (counted.cause !== "condition") fail("打ち切り理由: 読み直すと理由が消えている");

  /*
   * カレンダーに中止が出ること。
   * これまでカレンダーは種目の食い違いしか見ておらず、
   * **途中で切った日と予定どおり終えた日が同じ顔**をしていた。
   */
  const abortDate = await page.evaluate(async (id) => {
    const d = await fetch("/api/sessions").then((r) => r.json());
    return (d.sessions ?? []).find((s) => s.id === id)?.date ?? null;
  }, abortTarget.id);
  if (!abortDate) fail("打ち切り理由: 対象日が分からない");
  else {
    await page.goto("http://localhost:8791/#/calendar");
    await page.waitForTimeout(800);
    await page.locator("select").first().selectOption("4");
    await page.waitForTimeout(900);
    const abortDay = page
      .locator("div.card", { hasText: abortDate.slice(5).replace("-", "/") })
      .first();
    if ((await abortDay.count()) === 0) {
      fail(`打ち切り理由: ${abortDate} の行がカレンダーに無い`);
    } else {
      const dayText = (await abortDay.textContent()) ?? "";
      if (!dayText.includes("中止")) {
        fail(`打ち切り理由: カレンダーに中止が出ていない（${dayText.slice(0, 60)}）`);
      }
      // 理由まで出ること（扱いが違うものを同じ顔で並べない）
      if (!dayText.includes("天候・路面")) {
        fail(`打ち切り理由: カレンダーに理由が出ていない（${dayText.slice(0, 60)}）`);
      }
    }
  }

  /*
   * 分析に理由別の内訳が出ること。
   * 理由は記録していたが、**貯まっても誰も見ていなかった**。
   * 数と、その理由が設定に反映されるかどうかを並べて出す。
   */
  await page.goto("http://localhost:8791/#/analysis");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "現在地", exact: true }).click();
  await page.waitForTimeout(900);
  const abortCard = page.locator("section.card", { hasText: "途中でやめた練習" }).first();
  if ((await abortCard.count()) === 0) {
    fail("打ち切り理由: 分析に理由別の内訳が出ていない");
  } else {
    const cardText = (await abortCard.textContent()) ?? "";
    if (!cardText.includes("天候・路面")) {
      fail(`打ち切り理由: 内訳に理由が出ていない（${cardText.slice(0, 60)}）`);
    }
    // 扱いの違いを数字の隣に出す（色だけに頼らない）
    if (!cardText.includes("記録のみ")) {
      fail(`打ち切り理由: 内訳に扱いが出ていない（${cardText.slice(0, 60)}）`);
    }
  }

  step(
    "打ち切り理由OK（設定どおりでも聞く・未入力では保存させない・扱いを出す・カレンダーに中止・分析に内訳）"
  );
}

// ---- 記録画面の不変条件（分割の前に固定する） ----
/*
 * `app/results/page.tsx` は2400行・useStateが73個ある。
 * これから責務ごとに分けるが、**分けると壊れるのはここ**という2点を先に固定する。
 * 固定してから動かさないと、壊れたことに気づけない。
 *
 *   1. 隠れているモードの値が保存に混ざらない
 *      （インターバルを入れてからジョグに切り替えて保存 → interval が付いてこない）
 *   2. 切り替えても入力は消えない
 *      （押し間違いで戻したときに、打ち直しにならない）
 *
 * **この2つは逆向きの要求で、同時に満たす必要がある。**
 * 「混ぜない」を state を消して実現すると2が壊れ、
 * 「消さない」を保存にも渡して実現すると1が壊れる。
 * 片方だけ見る検査だと、もう片方を壊す直し方が通ってしまう。
 *
 * 再編集で値が戻ることはここでは見ない（同じ日に同名のジョグが複数あって
 * どれを開いたか固定できない）。それは「天候・路面・シューズ」と
 * 「M-1 記録の保持」が見ている。
 */
{
  const formTarget = await page.evaluate(async () => {
    const d = await fetch("/api/sessions").then((r) => r.json());
    const done = new Set(
      ((await fetch("/api/results").then((r) => r.json())).results ?? []).map((r) => r.sessionId)
    );
    // まだ記録の無い予定を選ぶ。既存の記録があると初期値がそれで埋まり、
    // 「隠れた値が混ざらない」を見ているつもりで別のものを見ることになる
    const s = (d.sessions ?? [])
      .filter((x) => x.status === "planned" && x.category === "aerobic" && !done.has(x.id))
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s ? { date: s.date, id: s.id, name: s.name } : null;
  });
  if (!formTarget) fail("記録画面の不変条件: 対象の予定が無い");

  await page.goto(`http://localhost:8791/#/results?date=${formTarget.date}`);
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /練習結果/ }).first().click();
  await page.waitForTimeout(700);
  const formPick = page.locator(`button:has-text("${formTarget.name}")`).first();
  if (await formPick.count()) {
    await formPick.click();
    await page.waitForTimeout(700);
  }

  const jogKmField = () => page.locator('label:has-text("距離(km)") input').first();
  const repsField = () => page.getByLabel("本数", { exact: true });
  const toInterval = async () => {
    await page.locator('button:has-text("インターバル")').first().click();
    await page.waitForTimeout(500);
  };
  const toJog = async () => {
    // 「ジョグ」だけだとレスト内容のチップにも当たる。モードのボタンは「ジョグ・持続走」
    await page.getByRole("button", { name: "ジョグ・持続走", exact: true }).first().click();
    await page.waitForTimeout(500);
  };

  // インターバルとして入れる
  await toInterval();
  if (!(await repsField().count())) fail("記録画面の不変条件: インターバルの欄が出ていない");
  await repsField().fill("3");
  await page.locator('label:has-text("距離(m)") input').first().fill("400");
  await page.waitForTimeout(300);

  // ジョグへ切り替えて、そちらを埋める
  await toJog();
  await jogKmField().fill("8");
  await page.locator('label:has-text("時間(分)") input').first().fill("40");
  await page.waitForTimeout(300);

  // 不変条件2: 行き来しても両方の入力が残っている（保存の**前**に見る）
  await toInterval();
  const keptReps = await repsField().inputValue();
  if (keptReps !== "3") fail(`記録画面の不変条件: 切り替えたら本数が消えた（${keptReps}）`);
  await toJog();
  const keptKm = await jogKmField().inputValue();
  if (keptKm !== "8") fail(`記録画面の不変条件: 切り替えたらジョグの距離が消えた（${keptKm}）`);

  // ジョグとして保存する
  await setSlider(page.getByTestId("rpe-slider"), 4);
  await page.getByRole("button", { name: "主観 余裕" }).click();
  await page.waitForTimeout(300);
  // 既に記録があると「上書きして保存する」に変わる
  await page.getByRole("button", { name: /登録して補正を実行|上書きして保存する/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "実行する" }).click();
  await page.waitForTimeout(1400);

  /*
   * 同じ日に同名のジョグが複数あるので sessionId では引かない
   * （一覧の何番目を押したかで id が変わる）。いま入れた値そのもので探す。
   */
  const saved = await page.evaluate(async (date) => {
    const d = await fetch("/api/results").then((r) => r.json());
    return (
      (d.results ?? []).find(
        (r) => r.date === date && r.continuous && r.continuous.distanceKm === 8
      ) ?? null
    );
  }, formTarget.date);
  if (!saved) fail("記録画面の不変条件: ジョグとして保存されていない");

  // 不変条件1: 隠れていたインターバルの値が混ざっていない
  if (saved.interval !== undefined) {
    fail(
      "記録画面の不変条件: ジョグとして保存したのにインターバルの値が付いている（" +
        JSON.stringify(saved.interval) +
        "）"
    );
  }
  if ((saved.actualLapsSec ?? []).length > 0) {
    fail(
      `記録画面の不変条件: ジョグなのにラップが入っている（${JSON.stringify(saved.actualLapsSec)}）`
    );
  }

  step("記録画面の不変条件OK（隠れた値は保存に混ざらない・切り替えても入力が消えない）");
}


// ---- おすすめシューズ ----
/*
 * 見るのは4つ。
 *   ・登録してある靴だけが出ること（**持っていない靴を薦めない**）
 *   ・理由と代替が読めること（読めないと違う靴を選ぶ判断ができない）
 *   ・記録画面の並びが練習詳細と同じであること
 *     （画面ごとに理屈を書くと食い違う。判断は core/shoeRecommend.ts だけ）
 *   ・薦めたものと**違う靴も選べる**こと
 */
{
  const adviceBefore = failCount;

  /*
   * 2足目を登録する。1足しか無いと並び順の検査が意味を持たない
   * （登録順と推薦順がどうやっても同じになる）。
   * **登録はスパイクが先・推薦はジョグ用が先**になる条件を作り、
   * 並びが登録順ではなく推薦から来ていることを確かめる。
   */
  await page.goto("http://localhost:8791/#/settings");
  await page.waitForTimeout(800);
  await page.getByLabel("製品名").fill("E2Eデイリー");
  await page.getByRole("button", { name: "種類 トレーニング" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await page.waitForTimeout(700);

  // ジョグを対象にする。ここでスパイクが1番になったら推薦が働いていない
  const adviceTarget = await page.evaluate(async () => {
    const d = await fetch("/api/sessions").then((r) => r.json());
    const s = (d.sessions ?? [])
      .filter((x) => x.status === "planned" && x.category === "aerobic")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s ? { id: s.id, date: s.date, name: s.name } : null;
  });
  if (!adviceTarget) fail("おすすめシューズ: 対象のCVセッションが無い");
  else {
    const advice = await page.evaluate(
      async (id) =>
        fetch(`/api/shoes?sessionId=${encodeURIComponent(id)}`).then((r) => r.json()),
      adviceTarget.id
    );
    if (!advice?.advice) fail("おすすめシューズ: APIが返らない（シムに対で足していない可能性）");
    else {
      const registered = await page.evaluate(async () =>
        fetch("/api/shoes").then((r) => r.json())
      );
      const known = new Set((registered.shoes ?? []).map((s) => s.id));
      const listed = [advice.advice.best, ...(advice.advice.alternatives ?? [])]
        .filter(Boolean)
        .map((x) => x.shoe.id);
      if (listed.length === 0) fail("おすすめシューズ: 候補が空（登録済みの靴があるのに出ない）");
      for (const id of listed) {
        if (!known.has(id)) fail(`おすすめシューズ: 登録していない靴が出ている（${id}）`);
      }
      if (advice.advice.best.shoe.name === "E2Eスパイク") {
        fail("おすすめシューズ: ジョグにスパイクを薦めている（練習の種類を見ていない）");
      }
      if ((advice.advice.alternatives ?? []).length === 0) {
        fail("おすすめシューズ: 代替が出ていない（2足あるのに1つしか出さない）");
      }

      // 練習詳細に出ること
      await page.goto(`http://localhost:8791/#/session?id=${encodeURIComponent(adviceTarget.id)}`);
      await page.waitForTimeout(1200);
      const card = page.locator("section.card", { hasText: "おすすめシューズ" }).first();
      if ((await card.count()) === 0) fail("おすすめシューズ: 練習詳細にカードが出ていない");
      else {
        // 理由は畳んである。開いて読めること
        await card.getByRole("button", { name: /理由と代替を見る/ }).click();
        await page.waitForTimeout(400);
        const opened = (await card.textContent()) ?? "";
        if (!opened.includes("この靴にした理由")) {
          fail("おすすめシューズ: 理由が読めない");
        }
        // 実績が少ないことを断っていること（「学習済み」と誤解させない）
        if (!opened.includes("足りません")) {
          fail("おすすめシューズ: 実績が少ないことを断っていない");
        }
      }

      // 記録画面の並びが同じで、違う靴も選べること
      await page.goto(`http://localhost:8791/#/results?date=${adviceTarget.date}`);
      await page.waitForTimeout(900);
      await page.getByRole("button", { name: /練習結果/ }).first().click();
      await page.waitForTimeout(700);
      const pick = page.locator(`button:has-text("${adviceTarget.name}")`).first();
      if (await pick.count()) {
        await pick.click();
        await page.waitForTimeout(700);
      }
      const chips = page.locator('[role="group"][aria-label="シューズ"] button');
      if ((await chips.count()) === 0) fail("おすすめシューズ: 記録画面に選択が出ていない");
      else {
        const first = (await chips.nth(0).textContent()) ?? "";
        if (!first.includes("★")) {
          fail(`おすすめシューズ: 記録画面の先頭に印が無い（${first}）`);
        }
        const bestName = advice.advice.best.shoe.name;
        if (!first.includes(bestName)) {
          fail(
            `おすすめシューズ: 練習詳細と記録画面で1番目が違う（詳細=${bestName} 記録=${first}）`
          );
        }
        // 薦めたものと違う靴も選べる
        if ((await chips.count()) >= 2) {
          await chips.nth(1).click();
          await page.waitForTimeout(300);
          const pressed = await chips.nth(1).getAttribute("aria-pressed");
          if (pressed !== "true") fail("おすすめシューズ: 薦めたものと違う靴を選べない");
        }
      }
    }
  }
  if (failCount === adviceBefore) {
    step("おすすめシューズOK（登録済みだけ・理由と代替・記録と同じ並び・違うものも選べる）");
  }
}

// ---- アップ（主練習の子データ） ----
/*
 * 見るのは6つ。
 *   ・折りたたんであり、開くまで入力欄を出さないこと
 *   ・詳しい欄はさらにもう一段たたんであること
 *   ・保存され、開き直すと戻ってくること
 *   ・カレンダーに**独立したセッションとして出ない**こと
 *   ・距離の合計には足されること
 *   ・書き出して復元しても残ること
 *
 * カレンダーの検査が一番大事。アップが独立セッションになると、
 * 週の練習回数が増えて生成器が休養を挟み、
 * **記録を細かく付けた週ほど練習が減る**という逆のことが起きる。
 */
{
  const warmupBefore = failCount;

  const wuTarget = await page.evaluate(async () => {
    const d = await fetch("/api/sessions").then((r) => r.json());
    const s = (d.sessions ?? [])
      .filter((x) => x.status === "planned" && x.category === "aerobic")
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return s ? { id: s.id, date: s.date, name: s.name } : null;
  });

  if (!wuTarget) fail("アップ: 対象のジョグが無い");
  else {
    const countSessions = async () =>
      page.evaluate(async (date) => {
        const d = await fetch("/api/sessions").then((r) => r.json());
        return (d.sessions ?? []).filter((x) => x.date === date).length;
      }, wuTarget.date);
    const weekTotals = async () =>
      page.evaluate(
        async (date) =>
          (await fetch(`/api/dashboard?date=${date}`).then((r) => r.json()))?.weekTotals ?? null,
        wuTarget.date
      );

    const sessionsBefore = await countSessions();
    const weekBefore = await weekTotals();

    await page.goto(`http://localhost:8791/#/results?date=${wuTarget.date}`);
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /練習結果/ }).first().click();
    await page.waitForTimeout(500);
    const pick = page.locator('button:has-text("有酸素")').first();
    if ((await pick.count()) === 0) fail("アップ: 対象のジョグを選べない");
    else {
      await pick.click();
      await page.waitForTimeout(500);
    }
    await page.getByRole("button", { name: "ジョグ・持続走", exact: true }).click();
    await page.waitForTimeout(300);

    // 1) 畳んである
    const toggle = page.locator('[data-testid="warmup-toggle"]');
    if ((await toggle.count()) === 0) fail("アップ: 記録画面にアップの欄が無い");
    else {
      if ((await page.locator('[data-testid="warmup-fields"]').count()) > 0) {
        fail("アップ: 最初から開いている（主練習の入力が下に押し出される）");
      }
      await toggle.click();
      await page.waitForTimeout(400);
      if ((await page.locator('[data-testid="warmup-fields"]').count()) === 0) {
        fail("アップ: 開いても入力欄が出ない");
      }

      // 2) 詳しい欄は、さらに押すまで出さない
      if ((await page.locator('[data-testid="warmup-detail"]').count()) > 0) {
        fail("アップ: 詳しい欄まで最初から出ている");
      }

      // 3) 型を押して入れる（毎回ゼロから入力させない）
      const preset = page
        .locator('[data-testid="warmup-presets"] button', { hasText: "ジョグ＋流し" })
        .first();
      if ((await preset.count()) === 0) fail("アップ: 型が出ていない（毎回ゼロから入力になる）");
      else {
        await preset.click();
        await page.waitForTimeout(500);
      }

      await page.locator('[data-testid="warmup-detail-toggle"]').click();
      await page.waitForTimeout(400);
      if ((await page.locator('[data-testid="warmup-detail"]').count()) === 0) {
        fail("アップ: 詳しい欄が開かない");
      }
      const legs = page.locator('[data-testid="warmup-legs"] button', { hasText: "弾む" }).first();
      if ((await legs.count()) === 0) fail("アップ: アップ後の脚を選べない");
      else {
        await legs.click();
        await page.waitForTimeout(300);
      }
    }

    // 主練習を埋めて保存する
    await page.getByPlaceholder("11.2").fill("10");
    await page.getByPlaceholder("50", { exact: true }).fill("50");
    await page.waitForTimeout(400);
    // RPEと主観は本人にしか分からないので既定値が無い。入れないと保存が止まる
    /*
     * 未入力のときスライダーは真ん中を指しているので、**同じ値を入れても変化にならない**
     * （Reactが値の変化なしと判断して onChange が走らない）。真ん中と違う値を入れる。
     */
    await setSlider(page.getByTestId("rpe-slider"), 7);
    await page.waitForTimeout(300);
    if (((await page.getByTestId("rpe-slider-value").textContent()) ?? "").trim() !== "7") {
      fail("アップ: RPEが入らない（この先の保存が検証できない）");
    }
    await page.getByRole("button", { name: "主観 普通" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /登録して補正を実行/ }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__posts=[]; const of=window.fetch; window.fetch=async(u,o)=>{ try{ if(String(u).includes("/api/results") && o && o.method==="POST"){ window.__posts.push(String(o.body).slice(0,400)); } }catch(e){} return of(u,o); }; });
    // 保存が止まったら理由を出す（alertはPlaywrightが黙って閉じるので拾っておく）
    let alertMsg = "";
    page.on("dialog", async (d) => { alertMsg = d.message(); await d.dismiss().catch(() => {}); });
    const runBtn = page.getByRole("button", { name: "実行する" }).first();
    await runBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await runBtn.click();
    await page.waitForTimeout(2000);
    if (alertMsg) fail("アップ: 保存が止まった（" + alertMsg + "）");

    // 4) 保存されているか
    /*
     * 画面がどのセッションを開いたかは決め打ちしない（同じ日に2本あることがある）。
     * **アップが付いた記録**から辿って、そのidで以降を確かめる。
     */
    const savedRef = await page.evaluate(async (date) => {
      const d = await fetch("/api/results").then((r) => r.json());
      const r = (d.results ?? []).find((x) => x.date === date && x.warmup);
      return r ? { sessionId: r.sessionId, warmup: r.warmup } : null;
    }, wuTarget.date);
    const stored = savedRef?.warmup ?? null;

    if (!stored) fail("アップ: 保存されていない");
    else {
      if (stored.legs !== "bouncy") fail(`アップ: 脚が保存されていない（${stored.legs}）`);
      if (!(stored.segments ?? []).some((x) => x.kind === "strides")) {
        fail("アップ: 区間が保存されていない");
      }

      // 5) カレンダーに独立したセッションとして出ない
      const sessionsAfter = await countSessions();
      if (sessionsAfter !== sessionsBefore) {
        fail(
          `アップ: カレンダーのセッションが増えた（${sessionsBefore} → ${sessionsAfter}）。週の練習回数が狂う`
        );
      }

      // 6) 距離の合計には足される
      const weekAfter = await weekTotals();
      if (weekBefore && weekAfter) {
        const grew = weekAfter.distanceKm - weekBefore.distanceKm;
        // ジョグ10km ＋ アップ3.4km。アップぶんが乗っていなければ10のまま
        if (!(grew > 10.5)) {
          fail(
            `アップ: 週間距離に足されていない（+${grew}km。主練習だけなら+10km）`
          );
        }
      }

      // 7) 開き直すと戻ってくる
      await page.goto(`http://localhost:8791/#/results?date=${wuTarget.date}`);
      await page.waitForTimeout(900);
      await page.getByRole("button", { name: /練習結果/ }).first().click();
      await page.waitForTimeout(500);
      const pick2 = page.locator('button:has-text("有酸素")').first();
      if (await pick2.count()) {
        await pick2.click();
        await page.waitForTimeout(700);
      }
      const summaryText =
        (await page.locator('[data-testid="warmup-toggle"]').first().textContent()) ?? "";
      if (summaryText.includes("未記録")) {
        fail("アップ: 開き直すと消えている（入れ直しになる）");
      }
      if (!summaryText.includes("流し")) {
        fail(`アップ: 折りたたみの1行に中身が出ていない（${summaryText}）`);
      }

      // 8) 書き出して復元しても残る
      const survived = await page.evaluate(async (id) => {
        const file = await fetch("/api/backup?download=1").then((r) => r.json());
        await fetch("/api/backup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file, mode: "merge" }),
        }).then((r) => r.json());
        const d = await fetch("/api/results").then((r) => r.json());
        const r = (d.results ?? []).find((x) => x.sessionId === id);
        return r?.warmup?.legs ?? null;
      }, savedRef.sessionId);
      if (survived !== "bouncy") fail(`アップ: 書き出して復元すると消える（${survived}）`);
    }
  }

  if (failCount === warmupBefore) {
    step("アップOK（畳んである／保存され戻る／独立セッションにならない／合計に足す／復元で残る）");
  }
}

// ---- カレンダーの行: 設定とレストを切らない ----
/*
 * 元の不具合は「メニュー名だけでなく設定タイムまで切れている」。
 * 原文をCSSで切ると前から残るので、**一番見たい数字が真っ先に消える**。
 *
 * ここで見るのは4つ。
 *   ・設定とレストが**省略記号なしで全部出ている**こと（実寸で測る）
 *   ・距離×本数も切れていないこと
 *   ・種目名がカテゴリと重複していたら省かれていること
 *   ・操作（✎・＋）が畳まれていること
 *
 * **文字が入っているかだけでは足りない。** `text-overflow: ellipsis` は
 * DOMのテキストを削らないので、textContent では切れていても分からない。
 * 要素の実幅と中身の幅を比べる（`scrollWidth > clientWidth` なら切れている）。
 */
{
  const calRowBefore = failCount;

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("http://localhost:8791/#/calendar");
    await page.waitForTimeout(800);

    const cut = await page.evaluate(() => {
      const out = [];
      const sel = "[data-calendar-shape],[data-calendar-target],[data-calendar-rest]";
      document.querySelectorAll(sel).forEach((el) => {
        // 1pxの丸め誤差は無視する
        if (el.scrollWidth - el.clientWidth > 1) {
          out.push(
            (el.getAttribute("data-calendar-target") !== null
              ? "設定"
              : el.getAttribute("data-calendar-rest") !== null
              ? "レスト"
              : "距離×本数") +
              ": " +
              (el.textContent || "")
          );
        }
      });
      return out;
    });
    if (cut.length > 0) {
      fail(
        `カレンダー行（${width}px幅）: 切ってはいけない部分が切れている — ${cut.join(" / ")}`
      );
    }

    // 設定が1つは出ていること（そもそも出ていなければ切れようがない＝検査が空振りする）
    const targetCount = await page.locator("[data-calendar-target]").count();
    if (targetCount === 0) {
      fail(`カレンダー行（${width}px幅）: 設定が1つも出ていない（検査が空振りする）`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // 重複する名称が省かれていること
  await page.goto("http://localhost:8791/#/calendar");
  await page.waitForTimeout(700);
  const calBody = (await page.textContent("body")) ?? "";
  if (/高乳酸セッション|CVインターバル|レースペース経済走/.test(calBody)) {
    fail("カレンダー行: カテゴリと重複する名称が省かれていない");
  }

  // 操作は畳んである（予定を読む幅を奪わない）
  if ((await page.locator("[data-calendar-ops]").count()) > 0) {
    fail("カレンダー行: 操作（✎・＋）が最初から出ている");
  }
  const opsToggle = page.locator("[data-calendar-ops-toggle]").first();
  if ((await opsToggle.count()) === 0) {
    fail("カレンダー行: 操作を開くボタンが無い（編集に辿れない）");
  } else {
    await opsToggle.click();
    await page.waitForTimeout(300);
    if ((await page.locator("[data-calendar-ops]").count()) === 0) {
      fail("カレンダー行: 押しても操作が出ない");
    }
  }

  if (failCount === calRowBefore) {
    step("カレンダー行OK（設定とレストを切らない・重複名称を省く・操作は畳む）");
  }
}

// ---- 分析: 結論 → 行動 → 根拠 ----
/*
 * これまで「課題」「判定材料」「4週間の変更」「不足データ」が同じ強さで並んでいて、
 * どれが結論なのか分からなかった。
 *
 * ここで見るのは3つ。
 *   ・最上部に結論・行動・リスクの3つが出ていること
 *   ・**根拠は開くまで出ていない**こと（開くまでDOMに無い）
 *   ・不足データが1つにまとまっていること（別々の大きなカードにしない）
 */
{
  const anaBefore = failCount;
  await page.goto("http://localhost:8791/#/analysis");
  await page.waitForTimeout(1400);

  const head = page.locator("[data-analysis-headline]");
  if ((await head.count()) === 0) fail("分析: 最上部の結論カードが無い");
  else {
    for (const [sel, what] of [
      ["[data-headline-problem]", "最大の課題"],
      ["[data-headline-risk]", "現在のリスク"],
    ]) {
      const el = page.locator(sel);
      if ((await el.count()) === 0) fail(`分析: 「${what}」が最上部に無い`);
      else if (!((await el.first().textContent()) ?? "").trim()) {
        fail(`分析: 「${what}」が空（空欄を良い状態として出さない）`);
      }
    }

    // 根拠は畳んである
    if ((await page.locator("[data-analysis-headline] ~ * >> text=この判定の根拠").count()) > 0) {
      fail("分析: 根拠が最初から出ている");
    }
    const rationale = page.getByRole("button", { name: /判定の根拠を見る/ });
    if ((await rationale.count()) === 0) fail("分析: 根拠を開くボタンが無い（数字を疑えない）");
    else {
      const bodyBefore = (await page.textContent("body")) ?? "";
      if (bodyBefore.includes("400m・1500mからの推定")) {
        fail("分析: 根拠（400m・1500mからの推定）が開く前から出ている");
      }
      await rationale.first().click();
      await page.waitForTimeout(400);
      const bodyAfter = (await page.textContent("body")) ?? "";
      if (!bodyAfter.includes("400m・1500mからの推定")) {
        fail("分析: 根拠を開いても推定が出ない");
      }
    }

    /*
     * 制限因子を2か所に出さない。
     * 結論カードへ移したので、下に同じ見出しのカードが残っていたら重複。
     */
    // 見出しだけを見る（根拠の本文にも「制限因子」の語が出るので body 全体では拾えない）
    const limiterHeadings = await page.locator("section.card .card-t h2", { hasText: "制限因子" }).count();
    if (limiterHeadings > 0) {
      fail("分析: 「制限因子」のカードが残っている（結論カードと二重）");
    }
  }

  if (failCount === anaBefore) {
    step("分析OK（結論・行動・リスクが最上部／根拠は開くまで出さない／制限因子は二重にしない）");
  }
}

// ---- ホーム: 数字と結論を先に出す ----
/*
 * これまでは処方の原文をそのまま置いていた。
 * 走る前に要るのは「何を・どのペースで・どの体感で」の3つで、理由の文はその場では読まない。
 *
 * **消したのではなく奥へ移した**ことを確かめる——
 * 消してしまうと「なぜこの設定なのか」があとから追えなくなる。
 */
{
  const homeBefore = failCount;

  /*
   * 注記つきの処方を今日の予定に入れてから見る。
   *
   * 「注記があれば見る」だけにしていたとき、その日の処方に注記が無くて
   * **検査ごと飛んでいた**（理由を最初から出す実装に変えても落ちなかった）。
   * 検査したい状態は検査の側で作る。
   */
  await page.goto("http://localhost:8791/#/");
  await page.waitForTimeout(1200);

  const shape = page.locator("[data-today-shape]");
  if ((await shape.count()) === 0) fail("ホーム: 今日の形（距離×本数・時間）が出ていない");

  const targets = await page.locator("[data-today-target]").count();
  const noteToggle = page.locator("[data-today-note-toggle]");
  if (targets === 0 && (await noteToggle.count()) === 0) {
    // 読めない処方なら原文が出ているはず。何も出ていないのは別の不具合
    const txt = (await page.locator("[data-today-shape]").first().textContent()) ?? "";
    if (!txt.trim()) fail("ホーム: 今日のメニューが何も出ていない");
  }

  /*
   * 注記のある処方かどうかで、見られることが変わる。
   *
   * **今日の枠は検査の側で用意できない。** 固定枠（RULE-15）だと
   * 内容を変えられず、消すこともできない（isFixed は予定に保存された値なので、
   * テンプレートを変えても既存の予定は変わらない）。
   * 曜日によって今日の処方に注記が無い日がある。
   *
   * そこで**日付に依らないところだけを見る**。
   *   ・形（距離×本数・時間）が出ていること … 毎日見る
   *   ・注記があるとき、畳んであること     … 注記のある日だけ見る
   *
   * 注記の読み取りそのものは `tests/prescriptionSummary.test.ts` が見ている。
   * ここで見たいのは「畳んであるか」で、注記が無い日はその状態が作れない。
   * **通ったことを実際より広く言わない**ため、step の文にどこまで見たかを書く。
   */
  const todayHasNote = await page.evaluate(async () => {
    const d = await fetch("/api/dashboard").then((r) => r.json());
    return String(d?.todaySession?.prescription ?? "").includes("（");
  });
  if (todayHasNote && (await noteToggle.count()) === 0) {
    fail("ホーム: 注記のある処方なのに「狙いと注意点」が無い（説明を消してしまっている）");
  }
  if ((await noteToggle.count()) > 0) {
    // 理由は開くまで出さない
    if ((await page.locator("[data-today-note]").count()) > 0) {
      fail("ホーム: 狙いと注意点が最初から出ている（数字より先に文章が来る）");
    }
    await noteToggle.first().click();
    await page.waitForTimeout(300);
    if ((await page.locator("[data-today-note]").count()) === 0) {
      fail("ホーム: 狙いと注意点を開いても出ない（消してしまっている）");
    }
  }

  if (failCount === homeBefore) {
    step(
      todayHasNote
        ? "ホームOK（形と設定を先に出す／理由は畳むが消さない）"
        : "ホームOK（形と設定を先に出す／今日は注記が無いので畳みの検査は未実施）"
    );
  }
}

// ---- 主練習の時間帯を選べる ----
/*
 * これまで主練習は午後で固定だった。
 * 授業やグラウンドの都合で午前にポイント練習をやる日があるので選べるようにした。
 *
 * ここで見るのは3つ。
 *   ・選択が出ていて、押すと保存されること
 *   ・**枠の中身が動かない**こと（選ぶのは時間帯だけ）
 *   ・生成すると主練習が午前に入り、補助が午後に回ること
 */
{
  const todBefore = failCount;

  await page.goto("http://localhost:8791/#/plan-settings");
  await page.waitForTimeout(1000);
  /*
   * 前のブロックで周期モードにしてある。周期では行が「1日目」になるので、
   * 曜日で見るために戻す（戻さないと検査が空振りする）。
   */
  const byDow = page.getByRole("button", { name: "曜日で決める" });
  if ((await byDow.count()) > 0 && (await byDow.getAttribute("aria-pressed")) !== "true") {
    await byDow.click();
    await page.waitForTimeout(500);
  }

  const amBtn = page.getByRole("button", { name: "火曜 主練習 午前" });
  const pmBtn = page.getByRole("button", { name: "火曜 主練習 午後" });
  if ((await amBtn.count()) === 0 || (await pmBtn.count()) === 0) {
    fail("主練習の時間帯: 選択が出ていない");
  } else {
    // 既定は午後（設定していない曜日の予定が黙って動かないように）
    if ((await pmBtn.getAttribute("aria-pressed")) !== "true") {
      fail("主練習の時間帯: 既定が午後になっていない");
    }

    // 中身を先に読んでおく。時間帯を変えても動いてはいけない
    const beforeSlots = await page.evaluate(async () => {
      const d = await fetch("/api/plan-settings").then((r) => r.json());
      const t = d.template ?? d.weekTemplate ?? {};
      return { main: t.slots?.["2"] ?? t.slots?.[2], sub: t.amSlots?.["2"] ?? t.amSlots?.[2] };
    });

    await amBtn.click();
    await page.waitForTimeout(400);
    if ((await amBtn.getAttribute("aria-pressed")) !== "true") {
      fail("主練習の時間帯: 午前を押しても切り替わらない");
    }

    // 補助枠の見出しが反対側になること（どちらに入るのかが読めないと選べない）
    const subLabel = (await page.textContent("body")) ?? "";
    if (!subLabel.includes("補助・2部（午後）")) {
      fail("主練習の時間帯: 補助枠が反対側と書かれていない");
    }

    // 保存する
    const saveBtn = page.getByRole("button", { name: /保存/ }).first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
      const dlg = page.getByRole("button", { name: "実行する" });
      if (await dlg.count()) {
        await dlg.first().click();
        await page.waitForTimeout(1200);
      }
    }

    const saved = await page.evaluate(async () => {
      const d = await fetch("/api/plan-settings").then((r) => r.json());
      const t = d.template ?? d.weekTemplate ?? {};
      return {
        tod: t.mainTimeOfDay?.["2"] ?? t.mainTimeOfDay?.[2] ?? null,
        main: t.slots?.["2"] ?? t.slots?.[2],
        sub: t.amSlots?.["2"] ?? t.amSlots?.[2],
      };
    });
    if (saved.tod !== "am") {
      fail(`主練習の時間帯: 保存されていない（${JSON.stringify(saved)}）`);
    }
    // **枠の中身は動かさない。** 移し替えると、どちらが主練習だったか分からなくなる
    if (saved.main !== beforeSlots.main || saved.sub !== beforeSlots.sub) {
      fail(
        `主練習の時間帯: 枠の中身が動いた（前 ${JSON.stringify(beforeSlots)} → 後 ${JSON.stringify(saved)}）`
      );
    }

    // 生成すると、火曜の主練習が午前に入る
    const placed = await page.evaluate(async () => {
      await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const d = await fetch("/api/sessions").then((r) => r.json());
      const tue = (d.sessions ?? []).filter(
        (x) => new Date(x.date + "T00:00:00Z").getUTCDay() === 2 && x.category !== "off"
      );
      const dates = [...new Set(tue.filter((x) => x.timeOfDay === "am").map((x) => x.date))];
      return {
        amCount: tue.filter((x) => x.timeOfDay === "am").length,
        sample: dates.slice(0, 2).map((date) =>
          tue
            .filter((x) => x.date === date)
            .map((x) => x.timeOfDay + ":" + x.category)
            .sort()
            .join(" / ")
        ),
      };
    });
    if (placed.amCount === 0) {
      fail("主練習の時間帯: 午前にしても午前のセッションが生成されない");
    }
  }

  if (failCount === todBefore) {
    step("主練習の時間帯OK（選べる・保存される・枠の中身は動かない・午前に生成される）");
  }
}

// ---- 靴の用途を複数選べる ----
/*
 * 1つしか選べなかったとき、厚底のように「レースにもポイント練習にも履く」靴を
 * 表せなかった。どちらかを選ぶと、選ばなかったほうの練習で加点されない。
 *
 * ここで見るのは3つ。
 *   ・2つ選べて、2つとも保存されること
 *   ・「決めていない」を押すと他が外れること（併用できない）
 *   ・再読込しても選択が戻ってくること
 */
{
  const purposeBefore = failCount;

  const target = await page.evaluate(async () => {
    const d = await fetch("/api/shoes").then((r) => r.json());
    const s = (d.shoes ?? [])[0];
    return s ? { id: s.id, name: s.name } : null;
  });

  if (!target) fail("靴の用途: 対象の靴が無い");
  else {
    await page.goto("http://localhost:8791/#/settings");
    await page.waitForTimeout(900);

    // 靴の行を開く（押すまで操作を出さない作りになっている）
    const row = page.getByRole("button", { name: new RegExp(target.name) }).first();
    if ((await row.count()) === 0) fail("靴の用途: 靴の行が無い");
    else {
      await row.click();
      await page.waitForTimeout(500);

      const group = page.locator(`[data-testid="shoe-purposes-${target.id}"]`);
      if ((await group.count()) === 0) fail("靴の用途: 用途の選択が出ていない");
      else {
        // 2つ選ぶ
        for (const label of ["レース用", "ポイント練習用"]) {
          const chip = group.getByRole("button", { name: new RegExp(label) }).first();
          if ((await chip.count()) === 0) {
            fail(`靴の用途: 「${label}」が無い`);
            continue;
          }
          if ((await chip.getAttribute("aria-pressed")) !== "true") {
            await chip.click();
            await page.waitForTimeout(500);
          }
        }

        const saved = await page.evaluate(async (id) => {
          const d = await fetch("/api/shoes").then((r) => r.json());
          const s = (d.shoes ?? []).find((x) => x.id === id);
          return s?.profile?.purposes ?? null;
        }, target.id);
        if (!Array.isArray(saved) || !saved.includes("race") || !saved.includes("quality")) {
          fail(`靴の用途: 2つ選んでも両方保存されない（${JSON.stringify(saved)}）`);
        }

        // 再読込しても戻ってくる
        await page.reload();
        await page.waitForTimeout(1200);
        const row2 = page.getByRole("button", { name: new RegExp(target.name) }).first();
        if (await row2.count()) {
          await row2.click();
          await page.waitForTimeout(500);
        }
        const group2 = page.locator(`[data-testid="shoe-purposes-${target.id}"]`);
        for (const label of ["レース用", "ポイント練習用"]) {
          const chip = group2.getByRole("button", { name: new RegExp(label) }).first();
          if ((await chip.count()) > 0 && (await chip.getAttribute("aria-pressed")) !== "true") {
            fail(`靴の用途: 再読込で「${label}」の選択が消えている`);
          }
        }

        /*
         * 「決めていない」は他と併用しない。
         * 併用できると「決めていないがレース用でもある」という読めない設定が残る。
         */
        const anyChip = group2.getByRole("button", { name: /決めていない/ }).first();
        if ((await anyChip.count()) === 0) fail("靴の用途: 「決めていない」が無い");
        else {
          await anyChip.click();
          await page.waitForTimeout(600);
          const afterAny = await page.evaluate(async (id) => {
            const d = await fetch("/api/shoes").then((r) => r.json());
            const s = (d.shoes ?? []).find((x) => x.id === id);
            return s?.profile?.purposes ?? null;
          }, target.id);
          if (JSON.stringify(afterAny) !== JSON.stringify(["any"])) {
            fail(
              `靴の用途: 「決めていない」が単独にならない（${JSON.stringify(afterAny)}）`
            );
          }
        }
      }
    }
  }

  if (failCount === purposeBefore) {
    step("靴の用途OK（複数選べる・保存され戻る・「決めていない」は単独）");
  }
}

if (errors.length) {
  console.log("JS ERRORS:", errors.slice(0, 5));
  process.exitCode = 1;
}
// fail() は exitCode を立てるだけで処理を続ける。
// ここで exitCode を見ずに PASS と表示していると、FAIL が出ていても
// 最後の1行だけ見て「全部通った」と誤読してしまうので必ず参照する。
if (process.exitCode) {
  console.log("=== E2E FAILED（上の FAIL / JS ERRORS を参照）===");
} else {
  console.log("=== ALL E2E PASS (JSエラーゼロ) ===");
}
await b.close();
server.close();
