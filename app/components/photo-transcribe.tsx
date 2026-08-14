"use client";
import { useCallback, useEffect, useState } from "react";
import { StatusText } from "./ui";
import { askAssistant, getApiKey, getConsent } from "./assistant";
import { prepareImage, type PreparedImage } from "./image-input";
import {
  cleanTranscription,
  TRANSCRIPTION_SYSTEM_PROMPT,
  UNREADABLE_MARK,
} from "@/lib/core/transcription";

/**
 * 写真から文字を起こして、呼び出し側のテキスト欄へ渡す。
 *
 * **やるのは文字起こしだけ。** 起こした文字は欄に入るだけで、
 * 解釈はこれまでどおり `parseRow` が行う（一括入力なら「解釈する」、
 * 予定の編集なら本文から欄が組み上がる経路）。
 * 起こした文字を本人が目で見る手順を、どちらの入口でも飛ばさない。
 *
 * 置き場所が2つあるのは、撮る対象が2種類あるから。
 *   ・過去データ … 練習日誌（済んだこと）
 *   ・予定の編集 … コーチが書いたメニュー（これからやること）
 * 中身は同じなので、実装は1つにしてある。
 *
 * 鍵と同意は相談（AI）と共通。設定していなければ何も出さない。
 */
export function PhotoTranscribe({
  onText,
  label = "練習日誌の写真",
  hint,
}: {
  onText: (text: string) => void;
  label?: string;
  hint?: string;
}) {
  const [image, setImage] = useState<PreparedImage | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    try {
      setReady(!!getApiKey() && getConsent());
    } catch {
      setReady(false);
    }
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const pick = useCallback(async (file?: File) => {
    setErr("");
    setNote("");
    if (!file) return;
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setImage(undefined);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const send = useCallback(async () => {
    if (!image) return;
    let apiKey: string | undefined;
    try {
      apiKey = getApiKey();
    } catch {
      apiKey = undefined;
    }
    if (!apiKey) {
      setErr("先に相談（AI）でAPIキーと同意を設定してください。");
      return;
    }
    setBusy(true);
    setErr("");
    setNote("");
    const r = await askAssistant({
      apiKey,
      system: TRANSCRIPTION_SYSTEM_PROMPT,
      user: "この画像の文字をそのまま書き起こしてください。",
      image: { mediaType: image.mediaType, base64: image.base64 },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    const cleaned = cleanTranscription(r.text);
    if (cleaned.rejected) {
      setErr(cleaned.rejected);
      return;
    }
    onText(cleaned.text);
    setImage(undefined);
    setNote(
      cleaned.unreadableCount > 0
        ? `読み取りました。読めなかった箇所が${cleaned.unreadableCount}か所あり、${UNREADABLE_MARK} と入れてあります。埋めてから進めてください。`
        : "読み取りました。文字起こしは必ず間違えるので、進める前に目で確かめてください。"
    );
  }, [image, onText]);

  // 設定していない・オフラインなら、そもそも出さない（押せないボタンを残さない）
  if (!ready || !online) return null;

  return (
    <div className="mb-2.5">
      {hint ? (
        <p className="text-[11.5px] leading-relaxed mb-1.5" style={{ color: "var(--text-3)" }}>
          {hint}
        </p>
      ) : null}
      <label className="block text-[13px] mb-2">
        <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
          {label}
        </span>
        <input
          type="file"
          accept="image/*"
          className="w-full"
          onChange={(e) => pick(e.target.files?.[0])}
          data-testid="photo-file"
        />
      </label>
      {image ? (
        <div className="mb-2">
          <p className="text-[11px] mb-1.5" style={{ color: "var(--text-3)" }}>
            この写真をAnthropicへ送ります（{image.width}×{image.height} /{" "}
            {Math.round(image.bytes / 1024)}KB）。
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.dataUrl}
            alt="送る写真"
            style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid var(--border)" }}
            data-testid="photo-preview"
          />
        </div>
      ) : null}
      <div className="flex gap-2 flex-wrap">
        <button
          className="btn-volt justify-center"
          disabled={!image || busy}
          onClick={send}
          data-testid="photo-send"
        >
          {busy ? "読み取り中…" : "写真から読み取る"}
        </button>
        {image ? (
          <button className="btn-ghost" onClick={() => setImage(undefined)}>
            写真を外す
          </button>
        ) : null}
      </div>
      {err ? (
        <StatusText kind="error" className="text-[11.5px] mt-2 leading-relaxed">
          <span data-testid="photo-error">{err}</span>
        </StatusText>
      ) : null}
      {note ? (
        <StatusText kind="success" className="text-[11.5px] mt-2 leading-relaxed">
          <span data-testid="photo-note">{note}</span>
        </StatusText>
      ) : null}
    </div>
  );
}
