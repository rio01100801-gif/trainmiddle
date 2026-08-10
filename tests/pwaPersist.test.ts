/**
 * 対象1: PWAの保存保証
 *
 * `persistState` は250msデバウンス後にIndexedDBへ書き込み、失敗時はlocalStorageへ
 * フォールバックしていたが、両方失敗しても呼び出し側に何も伝わらなかった。
 * 画面は「保存した」つもりのまま、実際は端末に何も残っていないことがありうる。
 *
 * IndexedDB自体はvitest（Node）に存在しないため、実際のブラウザAPIを直接テストせず、
 * `supabase.ts` の `fetchImpl` と同じパターンで書き込み処理を注入可能にし、
 * 「成功」「失敗」を明示的に表現したフェイクで分岐を検証する。
 */
import { describe, expect, it, vi } from "vitest";
import {
  flushPendingState,
  hydrateState,
  loadState,
  persistState,
  type LoadStateDeps,
  type PersistDeps,
} from "../pwa/memory-store";
import { emptyState } from "../pwa/memory-store";

function okIndexedDb() {
  return { put: vi.fn(async () => {}) };
}
function failingIndexedDb(error: unknown = new Error("indexeddb boom")) {
  return { put: vi.fn(async () => { throw error; }) };
}
function okLocalStorage() {
  return { setItem: vi.fn() };
}
function failingLocalStorage(error: unknown = new Error("localstorage boom")) {
  return {
    setItem: vi.fn(() => {
      throw error;
    }),
  };
}

const STATE = emptyState();

describe("対象1: PWAの保存保証", () => {
  it("IndexedDBとlocalStorageの両方にデータが無い初回起動だけは空状態を返す", async () => {
    const deps: LoadStateDeps = {
      indexedDb: { get: vi.fn(async () => undefined) },
      localStorageImpl: { getItem: vi.fn(() => null) },
    };

    await expect(loadState(deps)).resolves.toEqual(emptyState());
    expect(deps.localStorageImpl?.getItem).toHaveBeenCalledWith("train800");
  });

  it("IndexedDBが復旧して空でもlocalStorageへ退避したデータを見失わない", async () => {
    const saved = { ...emptyState(), athlete: { id: "athlete-from-fallback" } };
    const deps: LoadStateDeps = {
      indexedDb: { get: vi.fn(async () => undefined) },
      localStorageImpl: { getItem: vi.fn(() => JSON.stringify(saved)) },
    };

    const loaded = await loadState(deps);
    expect(loaded.athlete?.id).toBe("athlete-from-fallback");
  });

  it("IndexedDB読込失敗時は有効なlocalStorageデータから復旧する", async () => {
    const saved = { ...emptyState(), athlete: { id: "athlete-from-fallback" } };
    const deps: LoadStateDeps = {
      indexedDb: { get: vi.fn(async () => { throw new Error("idb read failed"); }) },
      localStorageImpl: { getItem: vi.fn(() => JSON.stringify(saved)) },
    };

    const loaded = await loadState(deps);
    expect(loaded.athlete?.id).toBe("athlete-from-fallback");
  });

  it("IndexedDBを読めず復旧用データも無い場合は空状態にせず起動を止める", async () => {
    const deps: LoadStateDeps = {
      indexedDb: { get: vi.fn(async () => { throw new Error("idb read failed"); }) },
      localStorageImpl: { getItem: vi.fn(() => null) },
    };

    await expect(loadState(deps)).rejects.toThrow("書き込みは開始していません");
  });

  it("壊れた保存データを旧データ補完として受け入れない", () => {
    expect(() => hydrateState({ ...emptyState(), sessions: {}, version: 1 })).toThrow(
      "sessions が壊れています"
    );
  });

  it("IndexedDBが成功すればlocalStorageに触らない", async () => {
    vi.useFakeTimers();
    const indexedDb = okIndexedDb();
    const localStorageImpl = okLocalStorage();
    const deps: PersistDeps = { indexedDb, localStorageImpl };

    const promise = persistState(STATE, deps);
    await vi.advanceTimersByTimeAsync(250);
    const outcome = await promise;

    expect(outcome).toEqual({ ok: true, via: "indexeddb" });
    expect(localStorageImpl.setItem).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("IndexedDB失敗→localStorage成功なら、そのことが分かる", async () => {
    vi.useFakeTimers();
    const deps: PersistDeps = {
      indexedDb: failingIndexedDb(),
      localStorageImpl: okLocalStorage(),
    };

    const promise = persistState(STATE, deps);
    await vi.advanceTimersByTimeAsync(250);
    const outcome = await promise;

    expect(outcome).toEqual({ ok: true, via: "localstorage" });
    vi.useRealTimers();
  });

  it("両方失敗した場合は呼び出し側が失敗と理由を受け取れる", async () => {
    vi.useFakeTimers();
    const deps: PersistDeps = {
      indexedDb: failingIndexedDb(),
      localStorageImpl: failingLocalStorage(),
    };

    const promise = persistState(STATE, deps);
    await vi.advanceTimersByTimeAsync(250);
    const outcome = await promise;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBeDefined();
      expect(outcome.detail).toContain("localstorage boom");
    }
    vi.useRealTimers();
  });

  it("容量超過(QuotaExceededError)は理由を区別する", async () => {
    vi.useFakeTimers();
    const quota = new DOMException("full", "QuotaExceededError");
    const deps: PersistDeps = {
      indexedDb: failingIndexedDb(quota),
      localStorageImpl: failingLocalStorage(quota),
    };

    const promise = persistState(STATE, deps);
    await vi.advanceTimersByTimeAsync(250);
    const outcome = await promise;

    expect(outcome).toMatchObject({ ok: false, reason: "quota" });
    vi.useRealTimers();
  });

  it("デバウンス中に何度呼んでも書き込みは1回だけ（同じ変更を過剰に書き込まない）", async () => {
    vi.useFakeTimers();
    const indexedDb = okIndexedDb();
    const deps: PersistDeps = { indexedDb, localStorageImpl: okLocalStorage() };

    const p1 = persistState(STATE, deps);
    await vi.advanceTimersByTimeAsync(100);
    const p2 = persistState(STATE, deps);
    await vi.advanceTimersByTimeAsync(250);

    await Promise.all([p1, p2]);
    expect(indexedDb.put).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("flushPendingStateはデバウンスを待たず即座に書き込む", async () => {
    const indexedDb = okIndexedDb();
    const deps: PersistDeps = { indexedDb, localStorageImpl: okLocalStorage() };

    // タイマーを進めずに flush する（pagehide 相当）。
    // deps は persistState に渡したものがそのまま使われる（再指定不要）。
    const pending = persistState(STATE, deps);
    const flushed = await flushPendingState();

    expect(flushed).toEqual({ ok: true, via: "indexeddb" });
    expect(indexedDb.put).toHaveBeenCalledTimes(1);
    // デバウンスで走るはずだった書き込みも、同じ結果で解決される
    await expect(pending).resolves.toEqual({ ok: true, via: "indexeddb" });
  });

  it("保留中の変更が無ければflushPendingStateは何もしない", async () => {
    await expect(flushPendingState()).resolves.toBeUndefined();
  });
});
