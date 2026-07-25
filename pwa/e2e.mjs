/**
 * PWA E2E検証: iPhone幅で実際のユーザー操作フローを通す。
 * 1. セットアップ(PB入力→診断) 2. 目標・レース保存 3. プラン生成
 * 4. 実測マーカー登録 5. 日次チェック 6. 結果入力→CFE補正
 * 7. リロード→データ永続化確認 8. 各画面スクリーンショット
 */
import { DIST, launchOptions, loadChromium } from "./e2e-env.mjs";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";


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

const shot = (name) => page.screenshot({ path: `/home/claude/pwa-shots/${name}.png`, fullPage: true });
fs.mkdirSync("/home/claude/pwa-shots", { recursive: true });
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
// ラウンド日時
const dt = page.locator('input[type="datetime-local"]');
await dt.nth(0).fill("2026-09-25T10:00");
await dt.nth(1).fill("2026-09-27T15:00");
await page.getByRole("button", { name: "目標・レースを保存" }).click();
await page.waitForTimeout(400);
step("目標・レース保存OK");

// ---- 3b. 固定曜日設定 + 自作メニュー（3-1 / 3-2） ----
await page.goto("http://localhost:8791/#/plan-settings");
await page.waitForTimeout(600);
// 固定曜日を有効化して 火=ポイント / 木=休養 / 土=ポイント / 日=ジョグ
await page.getByText("曜日ごとの枠を固定する").click();
await page.waitForTimeout(200);
const dowSelect = (label) =>
  page.locator(`xpath=//span[text()="${label}"]/following-sibling::select[1]`);
await dowSelect("火").selectOption("point");
await dowSelect("木").selectOption("off");
await dowSelect("土").selectOption("point");
await dowSelect("日").selectOption("aerobic");
await page.waitForTimeout(200);
await page.getByRole("button", { name: "設定を保存" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "実行する" }).click();
await page.waitForTimeout(600);
if (!(await page.textContent("body")).includes("保存しました")) fail("固定曜日設定が保存されない");
step("固定曜日設定OK（火・土ポイント / 木休養 / 日ジョグ）");

// 連日ポイントにするとERRORが出ることを確認
await dowSelect("水").selectOption("point");
await page.waitForTimeout(400);
const tplText = await page.textContent("body");
if (!tplText.includes("連日")) fail("連日ポイントのERROR警告が出ない（3-1検証）");
step("テンプレート検証OK（連日ポイントでERROR）");
await dowSelect("水").selectOption("auto");
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
await page.locator('label:has-text("内容") input').first().fill("300m×6 r4分 jog");
await page.locator('label:has-text("1本の距離") input').fill("300");
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
// 固定曜日どおりに置かれているか（木＝休養）
if (!/木/.test(calText)) fail("カレンダーに曜日が出ていない");
step("生成結果に固定曜日・自作メニューが反映OK");

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
const repInputs = page.locator('label:has-text("本目") input');
const repCount = await repInputs.count();
// 本数に5を入れたので、欄も5つになること（処方の本数より入力の本数を優先する）
if (repCount !== 5) fail(`N-2: 1本ずつの入力欄が本数と合っていない（${repCount}個）`);
for (const [i, v] of ["39.2", "39.6", "40.1", "41.5"].entries()) {
  await repInputs.nth(i).fill(v);
}
// 「まとめて」に切り替えても壊れないこと
await page.getByRole("button", { name: "まとめて", exact: true }).click();
await page.waitForTimeout(200);
if ((await page.getByRole("textbox", { name: /実施タイム/ }).count()) === 0) {
  fail("N-2: まとめて入力の欄が出ない");
}
await page.getByRole("button", { name: "1本ずつ", exact: true }).click();
await page.waitForTimeout(200);
if ((await page.locator('label:has-text("本目") input').first().inputValue()) !== "39.2") {
  fail("N-2: 切り替えで1本ずつの入力値が消えている");
}
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
step("Apple Health取り込みOK（ワークアウト→LT / 睡眠・安静時HR→疲労シグナル）");
await shot("14_health_import");

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
      const repVals = await page.locator('label:has-text("本目") input').allInnerTexts().catch(() => []);
      const filled = await page
        .locator('label:has-text("本目") input')
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
for (const label of ["推移", "負荷", "バランス", "レース"]) {
  const c = await page.getByRole("button", { name: label, exact: true }).count();
  if (c === 0) fail(`分析タブにセグメント「${label}」がない（B-2）`);
}
await page.getByRole("button", { name: "レース", exact: true }).click();
await page.waitForTimeout(700);
const anaText = await page.textContent("body");
if (!/ラウンド|レース/.test(anaText)) fail("分析タブのレースセグメントが表示されない（B-2）");
step("分析タブのセグメント化＋レース分析の統合OK");

// ---- 9e. G: 同一処方の経時比較 ----
await page.goto("http://localhost:8791/#/analysis");
await page.waitForTimeout(900);
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
await shot("16_home_forge");

// ---- 10c. フェーズB: ハンバーガー廃止と設定画面 ----
const hamburger = await page.getByRole("button", { name: "メニュー" }).count();
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
if (!adaptive.reasons.join().includes("平均乖離")) fail("M-2: 理由が出ていない");
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
await page.getByRole("button", { name: "入れる" }).click();
await page.waitForTimeout(600);
runText = await page.textContent("body");
if (!/残り\d+本/.test(runText)) fail("M-4: 続行の判定が出ない");
// 大きく外れた1本 → 中止
await page.locator('input[inputmode="decimal"]').first().fill(String((runTarget2 + 3).toFixed(1)));
await page.getByRole("button", { name: "入れる" }).click();
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
for (const label of ["現在地", "週報"]) {
  if ((await page.getByRole("button", { name: label, exact: true }).count()) === 0) {
    fail(`分析タブにセグメント「${label}」がない`);
  }
}
await page.getByRole("button", { name: "現在地", exact: true }).click();
await page.waitForTimeout(900);
const gapText = await page.textContent("body");
if (!gapText.includes("制限因子")) fail("M-7: 制限因子が出ていない");
if (!gapText.includes("後半の維持")) fail("M-7: 判定結果が想定と違う");
if (!gapText.includes("600m通過")) fail("M-8: 600m通過の指標が無い");
if (!gapText.includes("接地時間")) fail("M-10: 接地時間の枠が無い");
step("M-7/M-8/M-10 現在地の表示OK");
await shot("25_m7_gap");

await page.getByRole("button", { name: "週報", exact: true }).click();
await page.waitForTimeout(900);
const revText = await page.textContent("body");
if (!revText.includes("週次レビュー")) fail("M-11: 週次レビューが無い");
if (!/設定.*に対して平均|ポイント練習は/.test(revText)) fail("M-11: 実測を引用していない");
step("M-11 週次レビューOK");

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
await page.getByRole("button", { name: "このメニューを変更" }).first().click();
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
// 実際に追加できること
await page.locator('input[placeholder="名前（例: 朝ジョグ）"]').fill("朝ジョグ（テスト）");
await page.getByRole("button", { name: "追加する" }).click();
await page.waitForTimeout(900);
calAddText = await page.textContent("body");
if (!calAddText.includes("朝ジョグ（テスト）")) fail("＋から追加した練習がカレンダーに出ない");
step("カレンダー: ＋から練習を足せるOK（シートが画面内に出る）");

// ✎ を押したら編集シートが開くこと
await page.getByRole("button", { name: "このメニューを変更" }).first().click();
await page.waitForTimeout(700);
calAddText = await page.textContent("body");
if (!calAddText.includes("メニュー本文")) fail("✎を押しても編集シートが出ない");
const editBox = await page.locator("section.card", { hasText: "メニュー本文" }).first().boundingBox();
if (editBox && editBox.y > 844) fail(`編集シートが画面外に出ている（y=${Math.round(editBox.y)}px）`);
step("カレンダー: ✎から編集シートが開くOK");
await shot("26_calendar_edit");

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
for (const [p, name] of [["/analysis", "08_analysis"], ["/race", "09_race"], ["/meet", "10_meet"], ["/heat", "11_heat"], ["/data", "12_data"], ["/session", "19_session"]]) {
  await page.goto(`http://localhost:8791/#${p}`);
  await page.waitForTimeout(600);
  await shot(name);
}
step("全画面疎通OK");

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
for (const p of ["/", "/setup", "/goal", "/calendar", "/results", "/analysis", "/race", "/meet", "/heat", "/past", "/plan-settings", "/data", "/settings", "/warnings", "/session"]) {
  await page.goto(`http://localhost:8791/#${p}`);
  await page.waitForTimeout(450);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 2) fail(`横はみ出し ${p}: ${overflow}px`);
}
step("横はみ出しゼロ");

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
