"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, ViolationList } from "../components/ui";

/**
 * 警告一覧画面（E-4）
 *
 * 現行はホームに「件数だけの一覧」と「全文の再掲」の2箇所に出ていた。
 * 同じ内容が2回出ると、どちらが正なのか分からなくなるうえ、
 * 将来日の警告がホームを占有する原因にもなっていた。
 * 全文はここ1箇所に集約し、ホームとカレンダーからは遷移だけさせる。
 */
export default function WarningsPage() {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD({ violations: [] }));
  }, []);

  if (!d) return <p className="text-[13px]">読み込み中…</p>;

  const all = (d.violations ?? []) as any[];
  const errors = all.filter((v) => v.level === "ERROR");
  const warns = all.filter((v) => v.level === "WARN");
  const infos = all.filter((v) => v.level === "INFO");

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-baseline gap-4">
          <div>
            <div className="metric-label mb-1">ERROR</div>
            <div className="metric" style={{ color: errors.length ? "var(--red)" : "var(--text-3)" }}>
              {errors.length}
            </div>
          </div>
          <div>
            <div className="metric-label mb-1">WARN</div>
            <div className="metric" style={{ color: warns.length ? "var(--amber)" : "var(--text-3)" }}>
              {warns.length}
            </div>
          </div>
          <div>
            <div className="metric-label mb-1">INFO</div>
            <div className="metric" style={{ color: "var(--text-3)" }}>
              {infos.length}
            </div>
          </div>
        </div>
        {all.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed mt-3" style={{ color: "var(--text-2)" }}>
            現在のプランにルール違反はありません。練習結果を記録すると、
            結果に応じて再チェックされます。
          </p>
        ) : null}
      </Card>

      {all.length > 0 ? (
        <Card title="すべての警告">
          <ViolationList violations={all} />
          <Link
            href="/calendar"
            className="block text-center text-[11.5px] mt-3"
            style={{ color: "var(--text-3)" }}
          >
            カレンダーで該当日を見る →
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
