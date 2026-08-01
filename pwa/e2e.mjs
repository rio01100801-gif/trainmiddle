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
const fail = (msg) => { console.log("FAIL:", msg); process.exitCode = 1; };

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
await checkpointCard.locator('input[type="date"]').fill("2026-08-16");
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
await page.getByText("曜日ごとの希望を使う").click();
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
await page.locator('label:has-text("RPE") input').fill("9");
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
await page.locator('label:has-text("部位") input').fill("右アキレス腱");
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
await page.locator('label:has-text("レスト内容") select').selectOption("jog");
await page.locator('label:has-text("レスト指定") select').selectOption("time");
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

await page.locator('label:has-text("RPE") input').first().fill("10");
await page.locator('label:has-text("主観") select').selectOption("very_hard");
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
 * FIT取込 Phase 4: 3層データモデルでの保存。
 * 「この内容で登録する」を押すと、確認済み種別（直前でlap1を手動でunknownに
 * 直した状態のまま）からSession/SessionResultが実際に作られ、IndexedDBに
 * 保存されることを確認する（api-shim経由。/api/fit-import）。
 */
await page.getByRole("button", { name: "この内容で登録する" }).click();
await page.waitForTimeout(1000);
const registerText = await page.textContent("body");
if (!registerText.includes("登録しました") || !registerText.includes("2026-07-20")) {
  fail("FIT取込の登録が完了しない: " + registerText.slice(0, 400));
}
// 二重登録を招かないよう、登録後はボタンが引っ込むこと
if (await page.getByRole("button", { name: "この内容で登録する" }).count()) {
  fail("登録後もボタンが残っており、連打で二重登録できてしまう");
}
step("FIT取込Phase4OK（3層データモデルで保存・記録として登録される）");

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
if (!reRegisterText.includes("既に取り込み済み") || !reRegisterText.includes("更新しました")) {
  fail("同じFITの再登録が上書きとして扱われない: " + reRegisterText.slice(0, 400));
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
const linkedText = await page.textContent("body");
if (!linkedText.includes("計画済みの練習に記録として反映しました")) {
  fail("Phase6: 紐付け後の登録メッセージが出ない: " + linkedText.slice(0, 300));
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
// 全行が登録可能になること（実データで未確定ゼロ）
if (!bulkText.includes("登録できる行: 7")) {
  fail(
    "実際の日誌が全行そのまま登録できない（F-2）: " +
      (/登録できる行[^）\n]*/.exec(bulkText)?.[0] ?? "表示なし")
  );
} else {
  step("実際の日誌の解釈OK（7行すべて登録可能・未確定ゼロ）");
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
const varCard = page.locator("section.card", { hasText: "この練習の進め方" }).first();
if ((await varCard.count()) === 0) fail("S-9: TODAYに進め方の2案が出ていない");
else {
  if ((await varCard.getByRole("button", { name: "この進め方にする" }).count()) !== 2) {
    fail("S-9: TODAYで2案とも選べない");
  }
  await varCard.getByRole("button", { name: "この進め方にする" }).first().click();
  await page.waitForTimeout(1200);
  const afterVar = await page.textContent("body");
  if (!/今後14日間|安全に増やせる|この進め方をカレンダーへ保存|ルールに反します/.test(afterVar)) {
    fail("S-9: 選んだ結果が反映されない");
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
  const rpe = page.locator('label:has-text("RPE") input').first();
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

// ＋ を押したら追加シートが開き、画面の上に出ること
await page.goto("http://localhost:8791/#/calendar");
await page.waitForTimeout(900);
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
await page.getByRole("button", { name: /を変更/ }).first().click();
await page.waitForTimeout(700);
calAddText = await page.textContent("body");
if (!calAddText.includes("メニュー本文")) fail("✎を押しても編集シートが出ない");
const editBox = await page.locator("section.card", { hasText: "メニュー本文" }).first().boundingBox();
if (editBox && editBox.y > 844) fail(`編集シートが画面外に出ている（y=${Math.round(editBox.y)}px）`);
const calendarEditSheet = page.locator("section.card", { hasText: "メニュー本文" }).first();
const calendarEditBody = calendarEditSheet.locator("textarea").first();
await calendarEditBody.fill(
  `${await calendarEditBody.inputValue()}（カレンダー反映テスト）`
);
await page.waitForTimeout(900);
await calendarEditSheet.getByRole("button", { name: "保存する", exact: true }).click();
await page.waitForTimeout(1200);
const reflectedCalendarRow = page.locator("div.card a.flex-1", {
  hasText: "カレンダー反映テスト",
});
if ((await reflectedCalendarRow.count()) === 0) {
  fail("カレンダーで保存したメニュー本文が一覧へ反映されない");
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
const OVERFLOW_ROUTES = ["/", "/setup", "/goal", "/calendar", "/results", "/analysis", "/race", "/meet", "/heat", "/past", "/plan-settings", "/data", "/settings", "/warnings", "/session"];
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

// ---- 13. P-4: 最下部の要素が下部タブバー・FABの裏に隠れていないこと ----
/*
 * 下部タブバーとFABは position:fixed なので、スクロール領域が
 * そのぶんの余白を持っていないと最下部の要素が裏に入る。
 * 見た目には「スクロールしきった」ように見えるので気づけない。
 * 余白は app-main の1か所で確保しているが、確保できているかは実測で見る。
 */
for (const p of ["/", "/setup", "/goal", "/calendar", "/results", "/analysis", "/race", "/meet", "/heat", "/past", "/plan-settings", "/data", "/settings", "/warnings", "/session"]) {
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
   * 見るべきは「ボタンが覆われているか」ではなく「FABがモーダルより前に出ていないか」。
   *
   * ボタンとFABが実際に重なるかは画面の高さとセーフエリアで変わるので、
   * 特定の端末でだけ押せなくなる。E2Eの画面幅でたまたま重なっていないと素通りする。
   * ダイアログが開いている間はFABが暗幕の裏に回っていること、を不変条件にする。
   * これが崩れると、重なる端末では確実に押せなくなる。
   */
  const fabOnTop = await page.evaluate(() => {
    const fab = document.querySelector('button[aria-label="記録を追加"]');
    if (!fab) return { checked: false, onTop: false };
    const r = fab.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { checked: true, onTop: !!top && (top === fab || fab.contains(top)) };
  });
  if (!fabOnTop.checked) fail("S-5: FABが見つからない（この画面では出るはず）");
  else if (fabOnTop.onTop) {
    fail("S-5: ダイアログが開いているのにFABが前面にある（重なる端末では確認ボタンを押せない）");
  }
  const clicked = await runBtn
    .click({ timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) fail("S-5: 確認ボタンが押せない（FABに隠れている）");
  await page.waitForTimeout(700);
  const afterDel = await page.textContent("body");
  if (!/削除しました|元に戻す/.test(afterDel)) fail("S-5: 削除が実行されていない");
  step("S-5 削除の確認ボタンが押せるOK（FABの上に出る）");
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
      await page.evaluate(
        async ([sessionId, category]) => {
          await fetch("/api/coverage", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, category }),
          });
        },
        [p.candidates[0].sessionId, p.category]
      );
      await page.waitForTimeout(600);
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
   * 2周ぶんのレーンが揃っていること。
   * 生のpath数で数えると、発光層や光条を足しただけで落ちてしまい、
   * 「トラックが崩れた」のか「装飾が増えた」のか区別できない。
   * 意味のある単位（下地2本・光る軌跡2本以上）で見る。
   */
  if ((await sp.locator("#splash svg.mark path.lane-muted").count()) !== 2) {
    fail("R-2: スプラッシュのトラックの下地が2周ぶんでない");
  }
  if ((await sp.locator("#splash svg.mark path.lane-live").count()) < 2) {
    fail("R-2: スプラッシュの光る軌跡が出ていない");
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

// ---- 16d. R-3: マークが崩れていないこと ----
await page.goto("http://localhost:8791/#/");
await page.waitForTimeout(800);
const markPaths = await page.locator("header svg path").count();
if (markPaths < 4) fail(`R-3: ヘッダーのマークが崩れている（path ${markPaths}本）`);
const markBox = await page.locator("header svg").first().boundingBox();
if (!markBox) fail("R-3: ヘッダーのマークが描画されていない");
else if (markBox.width < 20 || markBox.height < 10) {
  fail(`R-3: ヘッダーのマークが小さすぎる（${Math.round(markBox.width)}×${Math.round(markBox.height)}）`);
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
step(`R-3 マークOK（ヘッダー ${Math.round(markBox?.width ?? 0)}×${Math.round(markBox?.height ?? 0)} / アイコン5種）`);
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
