/**
 * PWA エントリ。既存の画面コンポーネントをそのまま使い、
 * ルーティング(ハッシュ)・ストレージ(IndexedDB)・API(シム)だけ差し替える。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "../app/components/app-shell";
import { CATEGORY_LABELS, Card, ConfirmButton, StatusText } from "../app/components/ui";

import Dashboard from "../app/page";
import Setup from "../app/setup/page";
import Goal from "../app/goal/page";
import Calendar from "../app/calendar/page";
import Results from "../app/results/page";
import Analysis from "../app/analysis/page";
import Race from "../app/race/page";
import Meet from "../app/meet/page";
import Heat from "../app/heat/page";
import PlanSettings from "../app/plan-settings/page";
import Past from "../app/past/page";
import Settings from "../app/settings/page";
import Warnings from "../app/warnings/page";
import SessionDetail from "../app/session/page";
import SharedDataPage from "../app/data/page";
import RunPage from "../app/run/page";
import SyncPage from "../app/sync/page";
import DiagnosticsPage from "../app/diagnostics/page";

import type { FitParseResult } from "../src/lib/core/fitParse";
import { validateHealthXmlSize } from "../src/lib/core/healthImport";
import {
  classifyLaps,
  type IntervalClassifyResult,
  type IntervalKind,
} from "../src/lib/core/intervalClassify";
import { installApiShim } from "./api-shim";
import {
  AppState,
  emptyState,
  flushPendingState,
  loadState,
  MemoryStore,
  persistState,
  type PersistFailureReason,
  type PersistOutcome,
} from "./memory-store";

// ハッシュナビゲーションを有効化（next/link・next/navigation スタブが参照する）
(globalThis as any).__HASH_NAV__ = true;

// ---------------------------------------------------------------------------
// データ管理画面（PWA専用: エクスポート / インポート / 初期化）
// ---------------------------------------------------------------------------

let storeRef: MemoryStore;

/**
 * Apple ヘルスケア連携（エクスポートファイルの取り込み）
 * HealthKit は Safari から直接呼べないため、標準の書き出し機能を経由する。
 */
function HealthImportCard() {
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [result, setResult] = React.useState<any | null>(null);
  const [syncs, setSyncs] = React.useState<any[]>([]);

  const loadSyncs = React.useCallback(() => {
    fetch("/api/health-import")
      .then((r) => r.json())
      .then((d) => setSyncs(d.syncs ?? []));
  }, []);
  React.useEffect(loadSyncs, [loadSyncs]);

  const handleFile = async (file: File) => {
    const sizeCheck = validateHealthXmlSize(file.size);
    if (!sizeCheck.ok) {
      setMsg(sizeCheck.message);
      return;
    }
    setBusy(true);
    setMsg("読み込み中…（ファイルが大きい場合は1分ほどかかります）");
    setResult(null);
    try {
      let xml: string;
      if (file.name.endsWith(".zip")) {
        setMsg(
          "zipのままでは読み込めません。zipを解凍して、中の「書き出したデータ.xml」または export.xml を選んでください。"
        );
        setBusy(false);
        return;
      }
      xml = await file.text();
      const res = await fetch("/api/health-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml, days: 120 }),
      });
      const d = await res.json();
      if (d.error) {
        setMsg(d.error);
      } else {
        setResult(d);
        setMsg("");
        loadSyncs();
      }
    } catch (e) {
      setMsg(`読み込めませんでした: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const last = syncs[0];

  return (
    <Card title="Apple ヘルスケア連携">
      {last ? (
        <p className="text-[12px] mb-2">
          最終同期{" "}
          <b className="num">
            {new Date(last.syncedAt).toLocaleString("ja-JP", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </b>
          <span style={{ color: "var(--text-2)" }}>
            {" "}
            ／ ワークアウト{last.workouts}件・日次{last.dailyChecks}件
          </span>
        </p>
      ) : null}

      <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
        iPhoneの「ヘルスケア」アプリ → 右上のアイコン → 一番下の
        <b style={{ color: "var(--text)" }}>「すべてのヘルスケアデータを書き出す」</b>
        で作られるファイルを読み込みます。睡眠・安静時心拍・HRV・ランニングの記録が、
        疲労シグナルとLT推定・CFEに反映されます。
      </p>

      <label className="btn-volt inline-flex cursor-pointer justify-center w-full sm:w-auto min-h-[44px]">
        {busy ? "読み込み中…" : "書き出したデータを選ぶ"}
        <input
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {msg ? (
        <StatusText kind="warning" className="text-[12px] mt-2">
          {msg}
        </StatusText>
      ) : null}

      {result ? (
        <div className="mt-3 pt-3 border-t text-[12px]" style={{ borderColor: "var(--border)" }}>
          <p style={{ color: "var(--volt)" }}>
            ✓ 取り込み完了: ワークアウト{result.sync.workouts}件・日次データ
            {result.sync.dailyChecks}件
            {result.sync.fromDate ? `（${result.sync.fromDate}〜${result.sync.toDate}）` : ""}
          </p>
          {result.sync.note ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
              {result.sync.note}
            </p>
          ) : null}
          {result.hrvNote ? (
            <StatusText kind="warning" className="text-[11px] mt-1">
              {result.hrvNote}
            </StatusText>
          ) : null}
          {result.ltUpdated ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
              ランニング記録がLT推定に反映されました。「目標・レース」で再生成すると設定ペースに反映されます。
            </p>
          ) : result.sync.workouts > 0 ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
              ランニング記録は用途不明として保存しました。回復ジョグをLT走と誤認しないため、
              LTへは自動反映していません。
            </p>
          ) : null}
          {result.signalChanges?.length > 0 ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-2)" }}>
              疲労シグナルが緑以外になった日: {result.signalChanges.length}日
            </p>
          ) : null}
        </div>
      ) : null}

      <details className="text-[11px] mt-3">
        <summary style={{ color: "var(--text-3)" }}>
          自動同期にならない理由と、手を減らす方法
        </summary>
        <p className="mt-1.5 leading-relaxed" style={{ color: "var(--text-2)" }}>
          HealthKit（ヘルスケアのデータを直接読む仕組み）は iOS のネイティブアプリ専用で、
          Safari やホーム画面に追加したアプリからは技術的に呼び出せません。
          この制約は工夫では超えられないので、書き出しファイルの取り込みが基本になります。
        </p>
        <p className="mt-1.5 leading-relaxed" style={{ color: "var(--text-2)" }}>
          手を減らすなら <b style={{ color: "var(--text)" }}>iOSのショートカット</b>を使います。
          「毎朝、安静時心拍と睡眠をヘルスケアから読んで送る」オートメーションを組めば、
          日次データだけは自動で入ります。手順は README に書いてあります
          （設定 → 同期 で接続先を設定してから）。
        </p>
      </details>
    </Card>
  );
}

const INTERVAL_KIND_LABEL: Record<IntervalKind, string> = {
  warmup: "ウォームアップ",
  main: "メイン疾走",
  recovery: "リカバリー",
  rest: "レスト",
  cooldown: "クールダウン",
  unknown: "不明（要確認）",
};

const INTERVAL_KIND_OPTIONS: IntervalKind[] = [
  "warmup",
  "main",
  "recovery",
  "rest",
  "cooldown",
  "unknown",
];

function formatPaceSecPerKm(sec: number): string {
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/** btoa は文字列しか受けないため、大きい配列でも安全なチャンク分割で変換する */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * FIT取込 Phase 1: ファイル選択と安全な受信（構造検証のみ）。
 *
 * ラップ・心拍などの解析はまだ行わない（Phase 2以降）。ここでは
 * 「拡張子ではなく中身でFITと確認できるか」「壊れていないか」だけを見る。
 *
 * Garmin Connect の iPhone アプリには FIT を書き出す・共有する機能が無い
 * （個別アクティビティの書き出しは Garmin Connect の Web 版でのみ可能）。
 * iOS Safari は Web Share Target API 未対応で、PWA を共有先に登録できない。
 * そのため share_target は実装せず、通常のファイル選択だけを導線にする
 * （実現できない共有方式を動くように見せない）。
 *
 * Phase 3: 解析済みのlapを区間（ウォームアップ／メイン疾走／リカバリー／
 * レスト／クールダウン）に自動分類し、信頼度とともに表示する
 * （`src/lib/core/intervalClassify.ts`。ルールベース、LLM不使用）。
 * ここでの手動修正はこのカード内だけの一時的なものであり、保存はしない
 * （3層データモデルでの保存・既存予定との紐付けはPhase 4以降）。
 */
function FitImportCard() {
  const [busy, setBusy] = React.useState(false);
  const [fileName, setFileName] = React.useState("");
  const [validation, setValidation] = React.useState<
    | { kind: "ok"; dataSize: number }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [parsed, setParsed] = React.useState<FitParseResult | null>(null);
  const [parseError, setParseError] = React.useState("");
  const [classification, setClassification] = React.useState<IntervalClassifyResult | null>(
    null
  );
  const [kindOverrides, setKindOverrides] = React.useState<Record<number, IntervalKind>>({});
  const [fileBytes, setFileBytes] = React.useState<Uint8Array | null>(null);
  const [registering, setRegistering] = React.useState(false);
  const [registerResult, setRegisterResult] = React.useState<
    | { kind: "ok"; date: string; warnings: string[]; duplicate: boolean; linked: boolean }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [pendingLink, setPendingLink] = React.useState<{
    date: string;
    candidates: { id: string; name: string; prescription: string; category: string }[];
  } | null>(null);

  const handleFile = async (file: File) => {
    if (busy) return; // 二重送信防止
    setBusy(true);
    setValidation(null);
    setParsed(null);
    setParseError("");
    setClassification(null);
    setKindOverrides({});
    setFileBytes(null);
    setRegisterResult(null);
    setPendingLink(null);
    // ファイル名はReactが自動でエスケープして描画する（そのままHTML化しない）
    setFileName(file.name);
    try {
      /*
       * FIT解析（fit-file-parser）はGarmin公式プロファイル定義を丸ごと含み
       * bundleを大きく増やすため、ここで初めてFITを選んだ時だけ動的importで
       * 読み込む。FIT取込を使わない利用者の初期ロードには乗らない。
       */
      const { validateFitBytes } = await import("../src/lib/core/fitImport");
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const result = validateFitBytes(bytes);
      // ファイルの中身（バイト列そのもの）はログへ出さない
      if (!result.ok) {
        setValidation({ kind: "error", message: result.message });
        return;
      }
      setValidation({ kind: "ok", dataSize: result.dataSize });
      setFileBytes(bytes);
      try {
        const { parseFitFile } = await import("../src/lib/core/fitParse");
        const parseResult = await parseFitFile(bytes);
        setParsed(parseResult);
        if (parseResult.laps.length > 0) {
          setClassification(classifyLaps(parseResult.laps));
        }
      } catch (e) {
        // 構造は正しいが解析に失敗した場合。解析失敗を成功として扱わない。
        setParseError(`解析できませんでした: ${(e as Error).message}`);
      }
    } catch (e) {
      setValidation({ kind: "error", message: `読み込めませんでした: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (linkToSessionId?: string | null) => {
    if (registering || !parsed || !classification || !fileBytes) return;
    setRegistering(true);
    setRegisterResult(null);
    if (linkToSessionId === undefined) setPendingLink(null);
    try {
      const confirmedKinds = classification.laps.map((c) => kindOverrides[c.index] ?? c.kind);
      const body: Record<string, unknown> = {
        fileName,
        rawBytesBase64: bytesToBase64(fileBytes),
        parse: parsed,
        autoClassification: classification,
        confirmedKinds,
      };
      // 1回目（confirmedKindsだけ）は確認要否の判定だけ。2回目はどちらか本人が選んだ結果を送る
      if (linkToSessionId !== undefined) body.linkToSessionId = linkToSessionId;
      const res = await fetch("/api/fit-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setRegisterResult({ kind: "error", message: data.error });
      } else if (data.needsConfirmation) {
        setPendingLink({ date: data.date, candidates: data.candidates ?? [] });
      } else {
        setPendingLink(null);
        setRegisterResult({
          kind: "ok",
          date: data.session.date,
          warnings: data.warnings ?? [],
          duplicate: !!data.duplicate,
          linked: !!data.linked,
        });
      }
    } catch (e) {
      setRegisterResult({ kind: "error", message: `登録できませんでした: ${(e as Error).message}` });
    } finally {
      setRegistering(false);
    }
  };

  return (
    <Card title="FIT取込（Garmin等）">
      <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
        Garmin Connect のiPhoneアプリには FIT を直接共有する機能がありません。
        Safari で <span className="num">connect.garmin.com</span>{" "}
        を開き、アクティビティから FIT を書き出す（「ファイル」アプリに保存される）→
        下から選ぶ、という手順になります。
      </p>

      <label className="btn-volt inline-flex cursor-pointer justify-center w-full sm:w-auto min-h-[44px]">
        {busy ? "確認中…" : "FITファイルを選ぶ"}
        <input
          type="file"
          accept=".fit,.FIT,application/octet-stream"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {fileName ? (
        <p
          className="text-[11.5px] mt-2 break-all"
          style={{ color: "var(--text-3)" }}
        >
          選択中: {fileName}
        </p>
      ) : null}

      {validation?.kind === "ok" ? (
        <p className="text-[12px] mt-2" role="status" style={{ color: "var(--volt)" }}>
          ✓ FITファイルとして確認できました（本体 {validation.dataSize} バイト）。
        </p>
      ) : null}
      {validation?.kind === "error" ? (
        <p className="text-[12px] mt-2" role="alert" style={{ color: "var(--red)" }}>
          {validation.message}
        </p>
      ) : null}
      {parseError ? (
        <p className="text-[12px] mt-2" role="alert" style={{ color: "var(--red)" }}>
          {parseError}
        </p>
      ) : null}

      {parsed ? (
        <div className="mt-3 pt-3 border-t text-[12px]" style={{ borderColor: "var(--border)" }}>
          {parsed.sessions.length > 0 ? (
            parsed.sessions.map((s, i) => {
              const dynamics = [
                s.avgCadenceSpm !== undefined ? `ピッチ${Math.round(s.avgCadenceSpm)}spm` : null,
                s.avgStepLengthM !== undefined ? `ストライド${s.avgStepLengthM.toFixed(2)}m` : null,
                s.avgVerticalOscillationMm !== undefined ? `上下動${s.avgVerticalOscillationMm.toFixed(1)}mm` : null,
                s.avgGroundContactTimeMs !== undefined ? `接地時間${Math.round(s.avgGroundContactTimeMs)}ms` : null,
                s.avgTemperatureC !== undefined ? `気温${s.avgTemperatureC}℃` : null,
              ].filter((x): x is string => x !== null);
              return (
                <div key={i}>
                  <p className="num" style={{ color: "var(--text)" }}>
                    {s.sport ?? "種目不明"}
                    {s.totalDistanceKm !== undefined ? ` ／ ${s.totalDistanceKm}km` : ""}
                    {s.totalElapsedSec !== undefined ? ` ／ ${Math.round(s.totalElapsedSec)}秒` : ""}
                    {s.avgHr !== undefined ? ` ／ 平均心拍${s.avgHr}` : ""}
                  </p>
                  {dynamics.length > 0 ? (
                    <p className="num text-[11px]" style={{ color: "var(--text-2)" }}>
                      {dynamics.join(" ／ ")}
                    </p>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p style={{ color: "var(--text-2)" }}>sessionメッセージが含まれていません。</p>
          )}
          <p className="mt-1" style={{ color: "var(--text-2)" }}>
            lap {parsed.laps.length}件 ／ record {parsed.records.length}件
            {parsed.eventCount > 0 ? ` ／ event ${parsed.eventCount}件` : ""}
          </p>
          {parsed.utcOffsetSec !== undefined ? (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              記録デバイスのタイムゾーン: UTC{parsed.utcOffsetSec >= 0 ? "+" : ""}
              {parsed.utcOffsetSec / 3600}時間
            </p>
          ) : null}
          {parsed.warnings.map((w) => (
            <p key={w.code} className="text-[11px] mt-1" style={{ color: "var(--amber)" }}>
              ⚠ {w.message}
            </p>
          ))}
        </div>
      ) : null}

      {classification ? (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--text-3)" }}>
            区間の自動判定（ルールベース）。信頼度が低いものほど確認が必要です。
            間違っていればプルダウンで直してから登録してください。
          </p>
          <div className="flex flex-col gap-1">
            {classification.laps.map((c) => {
              const kind = kindOverrides[c.index] ?? c.kind;
              const overridden = kindOverrides[c.index] !== undefined;
              return (
                <div
                  key={c.index}
                  className="flex items-center gap-2 text-[11.5px] py-1 rounded-md px-2"
                  style={{ background: "var(--surface-2)" }}
                >
                  <span className="num shrink-0" style={{ color: "var(--text-3)" }}>
                    #{c.index + 1}
                  </span>
                  <span className="num shrink-0 w-[64px]" style={{ color: "var(--text-2)" }}>
                    {c.paceSecPerKm !== undefined ? formatPaceSecPerKm(c.paceSecPerKm) : "—"}
                  </span>
                  <select
                    aria-label={`lap${c.index + 1}の区間種別`}
                    className="flex-1 min-h-[32px] rounded-md px-1.5"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: overridden ? "var(--volt)" : "var(--text)",
                    }}
                    value={kind}
                    onChange={(e) => {
                      const next = e.target.value as IntervalKind;
                      setKindOverrides((prev) => ({ ...prev, [c.index]: next }));
                    }}
                  >
                    {INTERVAL_KIND_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {INTERVAL_KIND_LABEL[opt]}
                      </option>
                    ))}
                  </select>
                  <span
                    className="num shrink-0 w-[36px] text-right"
                    style={{ color: "var(--text-3)" }}
                  >
                    {Math.round(c.confidence * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
          {classification.warnings.map((w) => (
            <p key={w.code} className="text-[11px] mt-2" style={{ color: "var(--amber)" }}>
              ⚠ {w.message}
            </p>
          ))}

          {registerResult?.kind !== "ok" && !pendingLink ? (
            <button
              type="button"
              className="btn-volt w-full sm:w-auto min-h-[44px] mt-3"
              disabled={registering}
              onClick={() => handleRegister()}
            >
              {registering ? "登録中…" : "この内容で登録する"}
            </button>
          ) : null}

          {pendingLink ? (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <p className="text-[12px] mb-2" role="status" style={{ color: "var(--text)" }}>
                {pendingLink.date} に計画済みの練習があります。この記録として反映しますか？
              </p>
              <div className="flex flex-col gap-1.5">
                {pendingLink.candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="btn-ghost text-left min-h-[44px] px-3"
                    disabled={registering}
                    onClick={() => handleRegister(c.id)}
                  >
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-[11px]" style={{ color: "var(--text-3)" }}>
                      {CATEGORY_LABELS[c.category as keyof typeof CATEGORY_LABELS] ?? c.category}
                      {c.prescription ? ` ／ ${c.prescription}` : ""}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className="btn-ghost min-h-[44px]"
                  disabled={registering}
                  onClick={() => handleRegister(null)}
                >
                  {registering ? "登録中…" : "新しい記録として登録する（予定はそのまま残す）"}
                </button>
              </div>
            </div>
          ) : null}

          {registerResult?.kind === "ok" ? (
            <div className="mt-3">
              <p className="text-[12px]" role="status" style={{ color: "var(--volt)" }}>
                {registerResult.duplicate
                  ? `✓ 既に取り込み済みのファイルでした。${registerResult.date}の記録の内容を更新しました。`
                  : registerResult.linked
                  ? `✓ ${registerResult.date} の計画済みの練習に記録として反映しました。`
                  : `✓ ${registerResult.date} の練習として登録しました。`}
              </p>
              {registerResult.warnings.map((w, i) => (
                <p key={i} className="text-[11px] mt-1" style={{ color: "var(--amber)" }}>
                  ⚠ {w}
                </p>
              ))}
              {!registerResult.duplicate ? (
                <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
                  同じファイルをもう一度登録すると、新規ではなくこの記録の更新になります。
                </p>
              ) : null}
            </div>
          ) : null}
          {registerResult?.kind === "error" ? (
            <p className="text-[12px] mt-3" role="alert" style={{ color: "var(--red)" }}>
              {registerResult.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "var(--text-3)" }}>
        分析への反映は今後の更新で対応します（二重登録は防止済み。計画済みの
        練習がある日は、それに記録として反映するか新規に登録するか選べます）。
      </p>
    </Card>
  );
}

/**
 * データ管理（PWA）。
 * 書き出し・復元・接地時間の取り込みは共通画面（app/data）に寄せる。
 * ここでは Apple ヘルスケアの取り込みと、PWA固有の初期化だけを足す。
 */
function DataPage() {
  const [msg, setMsg] = React.useState("");

  const reset = () => {
    if (!confirm("すべてのデータを削除します。よろしいですか？（バックアップ推奨）")) return;
    storeRef.replaceState(emptyState());
    setMsg("初期化しました。ページを再読み込みします…");
    setTimeout(() => location.reload(), 800);
  };

  return (
    <div className="flex flex-col gap-3">
      <HealthImportCard />
      <FitImportCard />
      <SharedDataPage />
      <Card title="この端末のデータ">
        <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--text-2)" }}>
          データはこの端末の中だけに保存されています（外部送信はありません）。
          Safariのデータ消去やストレージの整理で消えることがあるので、
          上の書き出しを月に1回は取っておいてください。
        </p>
        <button className="btn-ghost" style={{ color: "var(--red)" }} onClick={reset}>
          全データを初期化
        </button>
        {msg ? <p className="text-[12px] mt-3">{msg}</p> : null}
      </Card>
      <Card title="このアプリについて">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          800m特化トレーニング管理ツール（PWA版）。オフラインでも動作します。
          ホーム画面に追加すると通常のアプリのように使えます:
          Safariの共有ボタン → 「ホーム画面に追加」。
        </p>
      </Card>
    </div>
  );
}

// データ管理は SETTINGS_ITEMS（設定画面）に既に入っているので、
// 下部タブ用の NAV_ITEMS には追加しない（B-1: タブは4つだけ）。

// ---------------------------------------------------------------------------

const PAGES: Record<string, React.ComponentType> = {
  "/": Dashboard,
  "/setup": Setup,
  "/goal": Goal,
  "/calendar": Calendar,
  "/results": Results,
  "/analysis": Analysis,
  "/race": Race,
  "/meet": Meet,
  "/heat": Heat,
  "/plan-settings": PlanSettings,
  "/past": Past,
  "/settings": Settings,
  "/warnings": Warnings,
  "/session": SessionDetail,
  "/data": DataPage,
  "/run": RunPage,
  "/sync": SyncPage,
  "/diagnostics": DiagnosticsPage,
};

function usePath(): string {
  const get = () => {
    // "#/results?date=2026-07-20" のようにクエリが付くので、
    // ルート照合ではパス部分だけを見る（クエリは useQueryParam が読む）。
    const h = location.hash.replace(/^#/, "").split("?")[0];
    return h === "" ? "/" : h;
  };
  return React.useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    get,
    get
  );
}

/*
 * 対象1: PWAの保存保証。
 *
 * MemoryStore.onChange は AppState が変わるたびに呼ばれるが、実際の永続化は
 * persistState の中で非同期・デバウンス後に起きる。以前は結果を誰も見ていなかった
 * ため、IndexedDBとlocalStorageの両方が失敗しても画面には何も出なかった
 * （保存した「つもり」のまま、実際は端末に何も残っていない）。
 *
 * 通知先はReactツリーの外（storeRef生成はboot()内）なので、モジュール変数と
 * useSyncExternalStore で購読する（usePath と同じパターン）。
 */
let persistFailure: PersistOutcome | null = null;
const persistFailureListeners = new Set<() => void>();

function setPersistFailure(next: PersistOutcome | null): void {
  if (persistFailure === next) return;
  persistFailure = next;
  for (const cb of persistFailureListeners) cb();
}

function usePersistFailure(): PersistOutcome | null {
  return React.useSyncExternalStore(
    (cb) => {
      persistFailureListeners.add(cb);
      return () => persistFailureListeners.delete(cb);
    },
    () => persistFailure,
    () => null
  );
}

/** MemoryStoreへ渡すonChange。永続化を実行し、失敗だけを画面へ伝える */
function trackedPersist(state: AppState): void {
  void persistState(state).then((outcome) => {
    setPersistFailure(outcome.ok ? null : outcome);
  });
}

const PERSIST_FAILURE_HINT: Record<PersistFailureReason, string> = {
  quota: "端末の空き容量が不足しています。不要な写真等を整理するか、書き出しでバックアップを取ってください。",
  unavailable: "プライベートブラウズ中などで端末に保存できません。通常モードで開き直してください。",
  unknown: "原因不明の保存エラーです。書き出しでバックアップを取ることをお勧めします。",
};

/** 保存に失敗している間、画面上部に出す帯。色だけに頼らず文言で伝える */
function PersistFailureBanner() {
  const failure = usePersistFailure();
  if (!failure || failure.ok) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 inset-x-0 z-[70] px-3.5 py-2 text-[12px] leading-snug"
      style={{ background: "var(--red)", color: "#fff" }}
    >
      端末への保存に失敗しています。{PERSIST_FAILURE_HINT[failure.reason]}
      （データ管理画面から書き出せます）
    </div>
  );
}

function App() {
  const path = usePath();
  const Page = PAGES[path] ?? Dashboard;
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  // 枠は Next.js 版と共有する（app/components/app-shell.tsx）
  return (
    <>
      <PersistFailureBanner />
      <AppShell>
        <Page key={path} />
      </AppShell>
    </>
  );
}

// ---------------------------------------------------------------------------

async function boot() {
  const state = await loadState();
  storeRef = new MemoryStore(state, trackedPersist);
  installApiShim(storeRef, () => {
    /* MemoryStore.onChange が永続化する */
  });

  /*
   * 対象1: アプリ終了直前の更新が、250msのデバウンス待ちの間に失われないようにする。
   * pagehide はページ遷移・タブ閉じ・iOSでアプリを切り替えた場合に発火する。
   * visibilitychange の "hidden" は、pagehide が発火しない一部のケース
   * （ホームボタンでバックグラウンドへ回る等）を補う。
   */
  const flushOnHide = () => {
    void flushPendingState();
  };
  window.addEventListener("pagehide", flushOnHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnHide();
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker
      // sw.js自体をHTTPキャッシュから取るとVERSION更新の検出が遅れるため、
      // iOS PWAでも起動時に配信中のService Workerを直接確認する。
      .register("./sw.js", { updateViaCache: "none" })
      .then((reg) => {
        // 起動のたびに更新を確認する（ホーム画面から起動しても新版が届くように）
        reg.update().catch(() => {});
        // 新しいSWが制御を取ったら1度だけ自動リロードして新版を反映する。
        // これが無いと、配信側を差し替えても端末は古い画面のままになる。
        //
        // ただし「初回訪問」は除く。初回は controller が null の状態から
        // SWが制御を取るので controllerchange が必ず発火するが、これは更新ではない。
        // ここで除外しないと、初めて開いた人が毎回1回リロードされる（画面がちらつく）。
        const hadController = navigator.serviceWorker.controller !== null;
        let refreshed = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!hadController || refreshed) return;
          refreshed = true;
          location.reload();
        });
      })
      .catch(() => {
        /* オフラインキャッシュなしでも動作は可能 */
      });
  }

  createRoot(document.getElementById("root")!).render(<App />);
  // ReactのcommitとAppShellの認証リダイレクト処理が走った次の描画で起動完了を通知する。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("forge:app-ready"));
    });
  });
}

function BootFailure({ message }: { message: string }) {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <section className="card max-w-[440px] w-full">
        <p className="card-t">STARTUP ERROR</p>
        <h1 className="text-lg font-extrabold mb-2">FORGEを起動できませんでした</h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: "var(--text-2)" }}>
          {message}
        </p>
        <button className="btn-volt w-full justify-center" onClick={() => location.reload()}>
          再読み込み
        </button>
      </section>
    </main>
  );
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "初期データの読み込みに失敗しました";
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<BootFailure message={message} />);
  window.dispatchEvent(new CustomEvent("forge:app-error", { detail: { message } }));
});
