"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, ConfirmButton } from "../components/ui";
import { localToday } from "@/lib/core/dates";
import {
  decideSync,
  metaOf,
  normalizeSyncConfig,
  validateSyncConfig,
  type SyncConfig,
  type SyncSnapshotMeta,
} from "@/lib/core/sync";
import {
  captureAuthRedirect,
  clearSyncConfig,
  consumeAuthMessage,
  currentOAuthRedirectTo,
  fetchSnapshot,
  getLastSynced,
  getSession,
  getSyncDiagnostics,
  getSyncConfig,
  putSnapshot,
  saveLastSynced,
  saveSyncConfig,
  signInWithGoogle,
  signOut,
  testConnection,
  type ConnectionTest,
  type SyncSession,
} from "../components/supabase";

/**
 * S-11 同期（Googleログイン＋Supabase）
 *
 * 未設定でもアプリは今までどおり動く。ここは足すだけの機能で、
 * 同期を使わない選択がそのまま成立すること（設定しなければ何も起きない）。
 *
 * 方式はスナップショット同期。M-12 の書き出し／復元をそのまま使う。
 * 判断（送る・取り込む・競合）は `src/lib/core/sync.ts` にあり、
 * この画面は通信と表示だけを持つ。
 */
export default function SyncPage() {
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [session, setSession] = useState<SyncSession | undefined>();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<ReturnType<typeof decideSync> | null>(null);
  const [tested, setTested] = useState<ConnectionTest | null>(null);
  const [saved, setSaved] = useState<Partial<SyncConfig>>({});
  const [lastSynced, setLastSynced] = useState<SyncSnapshotMeta | undefined>();
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    try {
      const c = getSyncConfig();
      setSaved(c);
      setUrl(c.url ?? "");
      setAnonKey(c.anonKey ?? "");
      setLastSynced(getLastSynced());

      // PC版は /sync、PWA版はAppShell経由でここへ戻る。どちらも同じ受取処理。
      const captured = captureAuthRedirect();
      setSession(captured?.kind === "session" ? captured.session : getSession());
      const authMessage =
        captured?.kind === "error" ? captured.message : consumeAuthMessage();
      if (authMessage) setMsg(authMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStorageError(message);
      setMsg(message);
    }
  }, []);

  const configError = validateSyncConfig({ url, anonKey });
  const configured = !configError;
  const current = normalizeSyncConfig({ url, anonKey });

  /*
   * 入力欄と保存済みの値がずれていないかを見る。
   *
   * 画面を開くたびに保存済みの値を入力欄へ書き戻すので、
   * 「欄だけ直して保存し忘れた」状態だと、再読み込みで元の値に戻る。
   * 間違ったURLを保存したあとに直したつもりで直っていない、が起きていた。
   */
  const dirty =
    (saved.url ?? "") !== current.url || (saved.anonKey ?? "") !== current.anonKey;
  const diagnostics = getSyncDiagnostics(saved);

  const save = () => {
    setStorageError("");
    try {
      const result = saveSyncConfig(current);
      setSaved(result.config);
      setUrl(result.config.url);
      setAnonKey(result.config.anonKey);
      setTested(null);
      if (result.changed) {
        setSession(undefined);
        setLastSynced(undefined);
      }
      setMsg(
        `設定を保存し、再読込で一致を確認しました（${new URL(result.config.url).hostname}）。` +
          (result.changed
            ? " 接続先が変わったため、以前のサインイン状態と最終同期情報は解除しました。"
            : "") +
          " 次に「接続をテスト」を実行してください。"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStorageError(message);
      setMsg(`設定を保存できませんでした: ${message}`);
    }
  };

  /** サインインの前に、URLと鍵のどちらが悪いのかまで確かめる */
  const test = async () => {
    setBusy(true);
    setTested(null);
    try {
      // 押した時点の入力欄で試す。保存前でも確かめられるようにする
      const r = await testConnection(current);
      setTested(r);
    } finally {
      setBusy(false);
    }
  };

  /** 送る／取り込むを決めて、必要なら選ばせる */
  const check = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const cfg = getSyncConfig();
      const validationError = validateSyncConfig(cfg);
      if (validationError) throw new Error(validationError);
      const s = getSession();
      if (!s) throw new Error("先にGoogleでサインインしてください。");
      const localFile = await fetch("/api/backup?download=1").then((r) => r.json());
      const remoteFile = await fetchSnapshot(cfg as SyncConfig, s);
      const d = decideSync({
        local: metaOf(localFile),
        remote: metaOf(remoteFile ?? {}),
        lastSynced,
      });
      setDecision(d);
      setMsg(d.message);

      // 迷いようが無いものはそのまま実行する
      if (d.action === "push" || d.action === "first_push") {
        await putSnapshot(cfg as SyncConfig, s, localFile);
        const next = metaOf(localFile);
        if (!next) throw new Error("この端末の書き出し情報を確認できませんでした。");
        saveLastSynced(next);
        setLastSynced(next);
        setMsg("クラウドへ送りました。");
        setDecision(null);
      } else if (d.action === "pull" || d.action === "first_pull") {
        const pullWarnings = await restore(remoteFile, "merge");
        setMsg(
          ["クラウドから取り込みました。画面を再読み込みします…", pullWarnings]
            .filter(Boolean)
            .join("\n")
        );
        setDecision(null);
        setTimeout(() => location.reload(), 1200);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [lastSynced]);

  /**
   * 取り込みを実行し、守った件数などの警告を返す。
   *
   * 統合は「両方を残す」操作なので、この端末の完了済み・本人編集・固定枠は
   * 相手側の値で置き換えない。**置き換えなかったことを黙っていると、
   * 同期したのに反映されていないように見える**ので、必ず画面へ出す。
   */
  const restore = async (file: unknown, mode: "merge" | "replace"): Promise<string> => {
    const r = await fetch("/api/backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, mode }),
    });
    const out = await r.json();
    if (out.error) throw new Error(out.error);
    // APIは { ok, report } で返す。report.warnings を取り違えると黙って空になる
    const warnings: string[] = Array.isArray(out.report?.warnings) ? out.report.warnings : [];
    const candidate =
      file && typeof file === "object"
        ? (file as { exportedAt?: string; counts?: Record<string, number> })
        : {};
    const m = metaOf(candidate);
    if (m) saveLastSynced(m);
    if (m) setLastSynced(m);
    return warnings.join("\n");
  };

  /** 競合したときの選択 */
  const resolve = async (key: "merge" | "keep_local" | "keep_remote") => {
    setBusy(true);
    try {
      const cfg = getSyncConfig();
      const validationError = validateSyncConfig(cfg);
      if (validationError) throw new Error(validationError);
      const s = getSession();
      if (!s) throw new Error("先にGoogleでサインインしてください。");
      const localFile = await fetch("/api/backup?download=1").then((r) => r.json());
      const remoteFile = await fetchSnapshot(cfg as SyncConfig, s);
      if (key === "keep_local") {
        await putSnapshot(cfg as SyncConfig, s, localFile);
        const next = metaOf(localFile);
        if (!next) throw new Error("この端末の書き出し情報を確認できませんでした。");
        saveLastSynced(next);
        setLastSynced(next);
        setMsg("この端末の内容でクラウドを上書きしました。");
      } else if (key === "keep_remote") {
        const replaceWarnings = await restore(remoteFile, "replace");
        setMsg(
          ["クラウドの内容で端末を上書きしました。再読み込みします…", replaceWarnings]
            .filter(Boolean)
            .join("\n")
        );
        setTimeout(() => location.reload(), 1200);
      } else {
        // 統合してから、統合後のものをクラウドへ返す
        const mergeWarnings = await restore(remoteFile, "merge");
        const merged = await fetch("/api/backup?download=1").then((r) => r.json());
        await putSnapshot(cfg as SyncConfig, s, merged);
        const next = metaOf(merged);
        if (!next) throw new Error("統合後の書き出し情報を確認できませんでした。");
        saveLastSynced(next);
        setLastSynced(next);
        setMsg(
          ["両方を残して統合し、クラウドにも反映しました。再読み込みします…", mergeWarnings]
            .filter(Boolean)
            .join("\n")
        );
        setTimeout(() => location.reload(), 1200);
      }
      setDecision(null);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="同期について">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          端末が変わっても記録を引き継げるようにします。設定しなければ何も起きず、
          アプリはこれまでどおり端末の中だけで動きます。
        </p>
        <p className="text-[11.5px] leading-relaxed mt-2" style={{ color: "var(--text-3)" }}>
          送るのは「データ管理」の書き出しと同じ内容です。
          両方の端末に変更があるときは、必ず選ばせてから反映します（黙って上書きしません）。
        </p>
      </Card>

      <Card title="接続先">
        <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-3)" }}>
          自分で作った Supabase プロジェクトの値を入れてください。手順は README にあります。
          ここに入れる Publishable Key（または旧anon key）は公開前提の鍵です。
          <b style={{ color: "var(--amber)" }}> service_role キーは入れないでください。</b>
        </p>
        <label className="block text-[13px] mb-2">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            Project URL
          </span>
          <input
            className="w-full"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTested(null);
            }}
            placeholder="https://xxxx.supabase.co"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="block text-[13px] mb-2.5">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            Publishable Key
          </span>
          <input
            type="password"
            className="w-full"
            value={anonKey}
            onChange={(e) => {
              setAnonKey(e.target.value);
              setTested(null);
            }}
            placeholder="sb_publishable_..."
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        {configError && (url || anonKey) ? (
          <p className="text-[11.5px] mb-2" style={{ color: "var(--amber)" }}>
            {configError}
          </p>
        ) : null}
        {/* 保存し忘れに気づけるようにする。直したつもりで直っていない、を防ぐ */}
        {dirty && (url || anonKey) ? (
          <p className="text-[11.5px] mb-2" style={{ color: "var(--amber)" }}>
            入力欄の内容がまだ保存されていません。
            {saved.url ? `いま保存されている接続先は ${saved.url} です。` : ""}
            保存しないと、画面を開き直したときに元に戻ります。
          </p>
        ) : null}
        {tested ? (
          <p
            className="text-[11.5px] leading-relaxed mb-2"
            style={{ color: tested.ok ? "var(--forge)" : "var(--amber)" }}
          >
            {tested.message}
            <span className="block mt-1 num" style={{ color: "var(--text-3)" }}>
              種別: {tested.ok ? "ok" : tested.kind}
              {tested.status ? ` ／ HTTP ${tested.status}` : ""}
              {tested.urlHost ? ` ／ ${tested.urlHost}` : ""}
              {` ／ ${tested.durationMs}ms`}
            </span>
          </p>
        ) : null}
        {storageError ? (
          <p className="text-[11.5px] mb-2" style={{ color: "var(--red)" }}>
            保存領域エラー: {storageError}
          </p>
        ) : null}
        <div className="flex gap-2 flex-wrap">
          <button className="btn-volt" onClick={save} disabled={!configured || busy}>
            保存する
          </button>
          <button className="btn-ghost" onClick={test} disabled={!configured || busy}>
            接続をテスト
          </button>
          <ConfirmButton
            label="接続設定を消す"
            title="接続設定を消しますか？"
            message="練習データは消えません。同期の設定とサインイン状態だけを消します。"
            className="btn-ghost"
            onConfirm={() => {
              try {
                clearSyncConfig();
                setUrl("");
                setAnonKey("");
                setSaved({});
                setSession(undefined);
                setLastSynced(undefined);
                setTested(null);
                setStorageError("");
                setMsg("Supabase接続設定とサインイン状態だけを消しました。練習データは残っています。");
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setStorageError(message);
                setMsg(`接続設定を消せませんでした: ${message}`);
              }
            }}
          />
        </div>
      </Card>

      <Card title="サインイン">
        {session ? (
          <>
            <p className="text-[12.5px] mb-2.5">サインイン済みです。</p>
            <button
              className="btn-ghost"
              onClick={() => {
                try {
                  signOut();
                  setSession(undefined);
                  setMsg("サインアウトしました。");
                } catch (error) {
                  setMsg(
                    `サインアウト状態を保存できませんでした: ${
                      error instanceof Error ? error.message : String(error)
                    }`
                  );
                }
              }}
            >
              サインアウト
            </button>
          </>
        ) : (
          <>
            <p className="text-[12px] leading-relaxed mb-2.5" style={{ color: "var(--text-2)" }}>
              Googleでサインインすると、自分のデータだけを読み書きできるようになります。
            </p>
            {/*
              保存済みの値でサインインする。
              入力欄の値で飛ばすと、同期のとき（保存済みを使う）と参照先が食い違い、
              「サインインはできたのに同期は別のプロジェクトを見ている」が起きる。
            */}
            <button
              className="btn-volt"
              disabled={!configured || dirty || storageError !== ""}
              onClick={() => {
                try {
                  signInWithGoogle(saved as SyncConfig);
                } catch (error) {
                  setMsg(
                    `Googleサインインを開始できませんでした: ${
                      error instanceof Error ? error.message : String(error)
                    }`
                  );
                }
              }}
            >
              Googleでサインイン
            </button>
            {!configured ? (
              <p className="text-[11.5px] mt-2" style={{ color: "var(--text-3)" }}>
                先に接続先を入れて保存してください。
              </p>
            ) : dirty ? (
              <p className="text-[11.5px] mt-2" style={{ color: "var(--amber)" }}>
                入力欄が未保存です。保存してからサインインしてください
                （保存済みの値でサインインするため）。
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card title="同期する">
        <button className="btn-volt" disabled={!configured || !session || busy} onClick={check}>
          いま同期する
        </button>
        {msg ? (
          // 守った件数などを続けて出すので、改行を潰さない
          <p
            className="text-[12px] leading-relaxed mt-2.5 whitespace-pre-line"
            role="status"
            style={{ color: "var(--text-2)" }}
          >
            {msg}
          </p>
        ) : null}

        {decision?.choices ? (
          <div className="mt-3">
            {decision.choices.map((c) => (
              <div key={c.key} className="mb-2">
                <button
                  className={c.key === "merge" ? "btn-volt justify-center" : "btn-ghost"}
                  disabled={busy}
                  onClick={() => resolve(c.key)}
                >
                  {c.label}
                </button>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
                  {c.note}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <p className="text-[11px] leading-relaxed mt-3" style={{ color: "var(--text-3)" }}>
          最終同期: {lastSynced?.exportedAt?.slice(0, 16).replace("T", " ") ?? "まだありません"}
          {" ／ 今日: "}
          {localToday()}
        </p>
      </Card>

      <Card title="接続診断">
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          キーやトークンは表示しません。Safariとホーム画面PWAは同じURLでも保存領域が
          別になることがあるため、それぞれでこの表示を確認してください。
        </p>
        <dl className="text-[11px] leading-relaxed mt-2 num" style={{ color: "var(--text-3)" }}>
          <div>実行環境: {diagnostics.environment}</div>
          <div>origin: {diagnostics.origin}</div>
          <div>使用中ホスト: {diagnostics.urlHost ?? "未設定"}</div>
          <div>設定の保存元: {diagnostics.storage}</div>
          <div>REST実行コンテキスト生成: {diagnostics.runtimeCreatedAt ?? "まだありません"}</div>
          <div>
            OAuth redirectTo:{" "}
            {diagnostics.oauthRedirectTo ??
              (typeof location === "undefined" ? "ブラウザで確認できます" : currentOAuthRedirectTo())}
          </div>
        </dl>
      </Card>
    </div>
  );
}
