/**
 * 画面の見え方の設定を端末に覚えさせる。
 *
 * カレンダーの表示期間を「月」や「4週間」に変えても、記録タブへ行って
 * 戻ってくると既定に戻ってしまっていた。画面ごとの状態はコンポーネントの
 * useState に持っているので、アンマウントで消えるため。
 *
 * 練習データ（Store）には入れない。これは「どう見たいか」であって
 * 練習の記録ではないし、端末ごとに違ってよい（iPhoneとPCで同じにする
 * 必要が無い）。書き出し・同期の対象からも外れるべきもの。
 *
 * 読めない・書けない場合は既定値で動く。プライベートモードで
 * localStorage が使えなくても、表示期間が毎回既定に戻るだけ。
 */

const PREFIX = "forge.view.";

/**
 * 保存された設定を読む。保存が無い・壊れている・許可されている値でない場合は
 * `fallback` を返す。**推測で近い値に寄せない**（想定外の値が入っていたら既定に戻す）。
 */
export function loadViewPref<T extends string | number>(
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed: unknown = typeof fallback === "number" ? Number(raw) : raw;
    return allowed.includes(parsed as T) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 保存する。書けなくても落とさない（次回また既定で開くだけ） */
export function saveViewPref(key: string, value: string | number): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PREFIX + key, String(value));
    }
  } catch {
    /* プライベートモード等。表示期間が覚えられないだけで機能は落ちない */
  }
}

/**
 * 見ていた週（カレンダーの起点）を覚える。
 *
 * 表示期間（週/月・何週間）と違って **localStorage には入れない**。
 * 来月の予定を見たまま閉じて、翌日開いたら来月が出るのは困る。
 * sessionStorage なら、アプリを開いているあいだだけ覚えて、閉じれば今週に戻る。
 *
 * 直したかったこと: 先の週を見て日付をタップ → メニューを見て戻ると、
 * 画面が作り直されて今週に戻っていた。予定を組んでいる最中にこれが起きると、
 * 毎回そこまで送り直すことになる。
 */
const ANCHOR_KEY = PREFIX + "calendar.anchor";

/** 覚えている起点。無い・壊れている・今日から1年以上離れていれば undefined */
export function loadCalendarAnchor(today: string): string | undefined {
  try {
    if (typeof sessionStorage === "undefined") return undefined;
    const raw = sessionStorage.getItem(ANCHOR_KEY);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
    /*
     * 極端に離れた値は壊れているとみなして捨てる。
     * 推測で近い日付に寄せない（想定外なら既定に戻す、というこのファイルの方針）。
     */
    const days = Math.abs(
      (Date.parse(raw + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000
    );
    return Number.isFinite(days) && days <= 366 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function saveCalendarAnchor(anchor: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(ANCHOR_KEY, anchor);
  } catch {
    /* 覚えられないだけ。毎回今週で開く */
  }
}
