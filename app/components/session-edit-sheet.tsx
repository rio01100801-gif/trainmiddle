"use client";
import * as React from "react";
import { useEffect, useState } from "react";
import { Card, ConfirmButton, StatusText } from "./ui";
import { withQuery } from "./route-query";
import { PrescriptionFields, prescriptionPayload, usePrescriptionFields } from "./prescription-fields";
import type { Session } from "@/lib/core/types";

/**
 * M-5 / P-1 メニューの変更シート。
 *
 * **カレンダーとホームのTODAYの両方がここを使う。唯一の実装。**
 * 同じ「メニューを直す」操作が画面によって違う挙動になると、
 * どちらで直したかによって結果が変わることになる。
 *
 * 日付の変更（onMove）だけは呼び出し側の都合が違う。
 * カレンダーは日付をタップして移動先を選ぶが、ホームには日付の一覧が無い。
 * 渡されなければボタンごと出さない。
 */
export function SessionEditSheet({
  session,
  today,
  title,
  onClose,
  onMove,
  onDone,
}: {
  session: any;
  today: string;
  /** 見出し。省略すると「日付 セッション名」 */
  title?: string;
  onClose: () => void;
  onMove?: () => void;
  onDone: (msg: string, session?: Session) => void;
}) {
  const [prescription, setPrescription] = useState(session.prescription ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [violations, setViolations] = useState<any[]>([]);

  // N-2: 本文に合わせた入力欄。追加シートと同じ実装を使う
  const fields = usePrescriptionFields(prescription, {
    category: session.category ?? "",
    distanceKm: session.distanceKm !== undefined ? String(session.distanceKm) : "",
    durationMin: session.durationMin !== undefined ? String(session.durationMin) : "",
    fallbackKind: session.category === "aerobic" ? "continuous" : "interval",
  });
  const { setSlotTargets } = fields;

  // 初期表示: 保存済みの設定タイムを欄に入れる
  useEffect(() => {
    const tps = session.targetPaces ?? [];
    if (tps.length === 0) return;
    setSlotTargets((prev) =>
      prev.length > 0
        ? prev
        : tps.map((tp: any) => String(Math.round(((tp.targetSecFast + tp.targetSecSlow) / 2) * 10) / 10))
    );
  }, [session.id, setSlotTargets]);

  const save = async (force = false) => {
    setBusy(true);
    setErr("");
    try {
      const updates: any = { prescription, ...prescriptionPayload(fields) };
      if (fields.category) updates.category = fields.category;

      const r = await fetch("/api/plan-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, updates, today, force }),
      });
      const out = await r.json();
      if (out.error) {
        setErr(out.error);
        setViolations(out.newViolations ?? []);
        return;
      }
      onDone("メニューを変更しました。", out.session as Session | undefined);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const r = await fetch(
      `/api/plan-edit?sessionId=${encodeURIComponent(session.id)}&date=${today}`,
      { method: "DELETE" }
    );
    const out = await r.json();
    onDone(out.error ?? "予定を削除しました。");
  };

  return (
    <Card title={title ?? `${session.date.slice(5).replace("-", "/")} ${session.name}`}>
      <label className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
        メニュー本文
      </label>
      <textarea
        rows={3}
        className="w-full mb-1.5"
        style={{ fontSize: 12 }}
        value={prescription}
        onChange={(e) => setPrescription(e.target.value)}
      />

      <PrescriptionFields state={fields} emptyCategoryLabel="カテゴリ" />

      {err ? (
        <StatusText kind="error" className="text-[11.5px] mb-2">
          {err}
        </StatusText>
      ) : null}
      {violations.length > 0 ? (
        <div className="mb-2">
          {violations.map((v: any, i: number) => (
            <StatusText key={i} kind="error" className="text-[11px] mb-1">
              {v.rule}: {v.message}
            </StatusText>
          ))}
          <button
            className="btn-ghost !text-[11.5px]"
            style={{ color: "var(--amber)" }}
            onClick={() => save(true)}
          >
            承知のうえで保存する
          </button>
        </div>
      ) : null}

      <div className="flex gap-2 flex-wrap">
        <button className="btn-volt" disabled={busy} onClick={() => save(false)}>
          保存する
        </button>
        {onMove ? (
          <button className="btn-ghost" onClick={onMove}>
            日付を変える
          </button>
        ) : null}
        <a className="btn-ghost" href={withQuery("/run", { sessionId: session.id })}>
          走りながら入力
        </a>
        <ConfirmButton
          label="削除"
          title="この予定を削除しますか？"
          message="記録済みの結果は消えません。予定だけを消します。"
          className="btn-ghost"
          onConfirm={remove}
        />
        <button className="btn-ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Card>
  );
}
