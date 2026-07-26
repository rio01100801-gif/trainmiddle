"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, ConfirmButton } from "../components/ui";
import { localToday } from "@/lib/core/dates";
import { decideSync, metaOf, validateSyncConfig, type SyncConfig } from "@/lib/core/sync";
import {
  captureAuthRedirect,
  clearSyncConfig,
  fetchSnapshot,
  getLastSynced,
  getSession,
  getSyncConfig,
  putSnapshot,
  saveLastSynced,
  saveSyncConfig,
  signInWithGoogle,
  signOut,
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

  useEffect(() => {
    const c = getSyncConfig();
    setUrl(c.url ?? "");
    setAnonKey(c.anonKey ?? "");
    // サインインから戻ってきた場合はここで受け取る
    setSession(captureAuthRedirect() ?? getSession());
  }, []);

  const configError = validateSyncConfig({ url, anonKey });
  const configured = !configError;

  const save = () => {
    saveSyncConfig({ url: url.trim(), anonKey: anonKey.trim() });
    setMsg("設定を保存しました。次にGoogleでサインインしてください。");
  };

  /** 送る／取り込むを決めて、必要なら選ばせる */
  const check = useCallback(async () => {
    const cfg = getSyncConfig() as SyncConfig;
    const s = getSession();
    if (!s) {
      setMsg("先にGoogleでサインインしてください。");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const localFile = await fetch("/api/backup?download=1").then((r) => r.json());
      const remoteFile = await fetchSnapshot(cfg, s);
      const d = decideSync({
        local: metaOf(localFile),
        remote: metaOf(remoteFile ?? {}),
        lastSynced: getLastSynced(),
      });
      setDecision(d);
      setMsg(d.message);

      // 迷いようが無いものはそのまま実行する
      if (d.action === "push" || d.action === "first_push") {
        await putSnapshot(cfg, s, localFile);
        saveLastSynced(metaOf(localFile)!);
        setMsg("クラウドへ送りました。");
        setDecision(null);
      } else if (d.action === "pull" || d.action === "first_pull") {
        await restore(remoteFile, "merge");
        setMsg("クラウドから取り込みました。画面を再読み込みします…");
        setDecision(null);
        setTimeout(() => location.reload(), 1200);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const restore = async (file: unknown, mode: "merge" | "replace") => {
    const r = await fetch("/api/backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, mode }),
    });
    const out = await r.json();
    if (out.error) throw new Error(out.error);
    const m = metaOf(file as never);
    if (m) saveLastSynced(m);
  };

  /** 競合したときの選択 */
  const resolve = async (key: "merge" | "keep_local" | "keep_remote") => {
    const cfg = getSyncConfig() as SyncConfig;
    const s = getSession();
    if (!s) return;
    setBusy(true);
    try {
      const localFile = await fetch("/api/backup?download=1").then((r) => r.json());
      const remoteFile = await fetchSnapshot(cfg, s);
      if (key === "keep_local") {
        await putSnapshot(cfg, s, localFile);
        saveLastSynced(metaOf(localFile)!);
        setMsg("この端末の内容でクラウドを上書きしました。");
      } else if (key === "keep_remote") {
        await restore(remoteFile, "replace");
        setMsg("クラウドの内容で端末を上書きしました。再読み込みします…");
        setTimeout(() => location.reload(), 1200);
      } else {
        // 統合してから、統合後のものをクラウドへ返す
        await restore(remoteFile, "merge");
        const merged = await fetch("/api/backup?download=1").then((r) => r.json());
        await putSnapshot(cfg, s, merged);
        saveLastSynced(metaOf(merged)!);
        setMsg("両方を残して統合し、クラウドにも反映しました。再読み込みします…");
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
          ここに入れる anon key は公開前提の鍵です。
          <b style={{ color: "var(--amber)" }}> service_role キーは入れないでください。</b>
        </p>
        <label className="block text-[13px] mb-2">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            Project URL
          </span>
          <input
            className="w-full"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <label className="block text-[13px] mb-2.5">
          <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
            anon public key
          </span>
          <input
            className="w-full"
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
            placeholder="eyJhbGciOi..."
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        {configError && (url || anonKey) ? (
          <p className="text-[11.5px] mb-2" style={{ color: "var(--amber)" }}>
            {configError}
          </p>
        ) : null}
        <div className="flex gap-2 flex-wrap">
          <button className="btn-volt" onClick={save} disabled={!configured}>
            保存する
          </button>
          <ConfirmButton
            label="接続設定を消す"
            title="接続設定を消しますか？"
            message="練習データは消えません。同期の設定とサインイン状態だけを消します。"
            className="btn-ghost"
            onConfirm={() => {
              clearSyncConfig();
              setUrl("");
              setAnonKey("");
              setSession(undefined);
              setMsg("接続設定を消しました。");
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
                signOut();
                setSession(undefined);
                setMsg("サインアウトしました。");
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
            <button
              className="btn-volt"
              disabled={!configured}
              onClick={() => signInWithGoogle(url.replace(/\/$/, ""))}
            >
              Googleでサインイン
            </button>
            {!configured ? (
              <p className="text-[11.5px] mt-2" style={{ color: "var(--text-3)" }}>
                先に接続先を保存してください。
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
          <p className="text-[12px] leading-relaxed mt-2.5" style={{ color: "var(--text-2)" }}>
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
          最終同期: {getLastSynced()?.exportedAt?.slice(0, 16).replace("T", " ") ?? "まだありません"}
          {" ／ 今日: "}
          {localToday()}
        </p>
      </Card>
    </div>
  );
}
