import { describe, expect, it } from "vitest";
import { weekSessionForDisplay, weekSessionLetter } from "@/lib/core/weekDisplay";
import { makeSession } from "./helpers";

describe("TODAY 今週ストリップ", () => {
  it("同日に古いOFF枠が残っても変更後のロングランを表示対象にする", () => {
    const off = makeSession("2026-08-10", "off", { name: "完全休養" });
    const longRun = makeSession("2026-08-10", "aerobic", {
      name: "ロングラン",
      durationMin: 75,
      status: "modified",
    });
    const displayed = weekSessionForDisplay([off, longRun]);
    expect(displayed?.id).toBe(longRun.id);
    expect(weekSessionLetter(displayed)).toBe("L");
  });

  it("中止済みセッションは表示候補から除く", () => {
    const skipped = makeSession("2026-08-10", "high_lactate", { status: "skipped" });
    const aerobic = makeSession("2026-08-10", "aerobic", { status: "modified" });
    expect(weekSessionForDisplay([skipped, aerobic])?.id).toBe(aerobic.id);
  });
});
