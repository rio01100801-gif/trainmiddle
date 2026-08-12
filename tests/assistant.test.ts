/**
 * 相談（AI）の通信層。
 *
 * 見張るのは
 *   ・**鍵が端末から出る先は Anthropic だけ**（他所へ送っていないこと、本文に混ざっていないこと）
 *   ・ブラウザ直叩きに必要なヘッダを送っていること（無いとCORSで全部落ちる）
 *   ・失敗の種類を区別していること（「エラー」だけでは本人が直せない）
 *   ・断られた応答・途中で切れた応答を、完成品として出さないこと
 */
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_API_URL,
  ASSISTANT_API_VERSION,
  ASSISTANT_MODEL,
  askAssistant,
  clearApiKey,
  getApiKey,
  maskApiKey,
  saveApiKey,
  validateApiKey,
} from "../app/components/assistant";

// 本物と間違われない長さにしてある（check-secrets.mjs は sk-ant- のあと40文字以上を秘密とみなす）
const KEY = "sk-ant-api03-dummy-for-tests-0000";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

/** 呼ばれた内容を覚えておく偽fetch */
function recordingFetch(reply: { status?: number; body?: unknown; throws?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const answerBody = {
  content: [{ type: "text", text: "CFEは63日ぶんの鈍化で1:54.2になっています。" }],
  stop_reason: "end_turn",
};

describe("APIキーの扱い", () => {
  it("保存して読み直せる", () => {
    const s = new MemoryStorage();
    saveApiKey(KEY, s);
    expect(getApiKey(s)).toBe(KEY);
    clearApiKey(s);
    expect(getApiKey(s)).toBeUndefined();
  });

  it("前後の空白は取り除いて保存する", () => {
    const s = new MemoryStorage();
    saveApiKey(`  ${KEY}  `, s);
    expect(getApiKey(s)).toBe(KEY);
  });

  it("明らかに別のものは弾く", () => {
    expect(validateApiKey("")).toBeDefined();
    expect(validateApiKey("sb_publishable_xxxxxxxxxxxxxxxxxxxx")).toContain("sk-ant-");
    expect(validateApiKey("sk-ant-x")).toContain("短すぎます");
    expect(validateApiKey(KEY)).toBeUndefined();
  });

  it("画面に出す形では全体が読めない", () => {
    const masked = maskApiKey(KEY);
    expect(masked).not.toBe(KEY);
    expect(masked).not.toContain("dummy-for-tests");
    expect(masked.startsWith("sk-ant-api")).toBe(true);
  });
});

describe("送り先と送る内容", () => {
  it("Anthropicへ、ブラウザ直叩きに必要なヘッダ付きで送る", async () => {
    const { impl, calls } = recordingFetch({ body: answerBody });
    await askAssistant({ apiKey: KEY, system: "sys", user: "usr", fetchImpl: impl });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ASSISTANT_API_URL);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe(ASSISTANT_API_VERSION);
    // これが無いとブラウザからは一切通らない（サーバを持たない配信なので他の経路が無い）
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("鍵は本文に混ぜない（ヘッダだけに載せる）", async () => {
    const { impl, calls } = recordingFetch({ body: answerBody });
    await askAssistant({ apiKey: KEY, system: "sys", user: "usr", fetchImpl: impl });
    expect(String(calls[0].init.body)).not.toContain(KEY);
  });

  it("渡した文脈と質問をそのまま送る（勝手に足さない・削らない）", async () => {
    const { impl, calls } = recordingFetch({ body: answerBody });
    await askAssistant({
      apiKey: KEY,
      system: "システム指示",
      user: "文脈と質問",
      fetchImpl: impl,
    });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe(ASSISTANT_MODEL);
    expect(body.system).toBe("システム指示");
    expect(body.messages).toEqual([{ role: "user", content: "文脈と質問" }]);
  });

  it("鍵が無ければ通信しない", async () => {
    const { impl, calls } = recordingFetch({ body: answerBody });
    const r = await askAssistant({ apiKey: "", system: "s", user: "u", fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe("no-key");
    expect(calls).toHaveLength(0);
  });

  it("オフラインなら通信しない", async () => {
    const { impl, calls } = recordingFetch({ body: answerBody });
    const r = await askAssistant({
      apiKey: KEY,
      system: "s",
      user: "u",
      fetchImpl: impl,
      online: false,
    });
    expect(r.ok === false && r.kind).toBe("offline");
    expect(calls).toHaveLength(0);
  });
});

describe("答えの読み取り", () => {
  it("文章を取り出す", async () => {
    const { impl } = recordingFetch({ body: answerBody });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.text).toContain("1:54.2");
    expect(r.ok === true && r.truncated).toBe(false);
  });

  it("途中で切れたことを隠さない", async () => {
    const { impl } = recordingFetch({
      body: { content: [{ type: "text", text: "途中まで" }], stop_reason: "max_tokens" },
    });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok === true && r.truncated).toBe(true);
  });

  it("断られたら、中身を読む前に断りとして扱う", async () => {
    const { impl } = recordingFetch({
      body: {
        content: [{ type: "text", text: "途中まで書かれた文" }],
        stop_reason: "refusal",
        stop_details: { explanation: "理由" },
      },
    });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.kind).toBe("refusal");
    // 途中の文を答えとして出していない
    expect(JSON.stringify(r)).not.toContain("途中まで書かれた文");
  });

  it("文章が空なら成功にしない", async () => {
    const { impl } = recordingFetch({ body: { content: [], stop_reason: "end_turn" } });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok === false && r.kind).toBe("response");
  });
});

describe("失敗の種類を区別する", () => {
  it("401は鍵の問題として出す", async () => {
    const { impl } = recordingFetch({ status: 401 });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok === false && r.kind).toBe("key");
    expect(r.ok === false && r.message).toContain("console.anthropic.com");
  });

  it("429は待てば直ると伝える", async () => {
    const { impl } = recordingFetch({ status: 429 });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok === false && r.kind).toBe("rate-limit");
  });

  it("500はそのまま鍵の問題にしない", async () => {
    const { impl } = recordingFetch({ status: 500 });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok === false && r.kind).toBe("http");
    expect(r.ok === false && r.status).toBe(500);
  });

  it("時間切れは通信不能と区別する", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { impl } = recordingFetch({ throws: abort });
    const r = await askAssistant({
      apiKey: KEY,
      system: "s",
      user: "u",
      fetchImpl: impl,
      timeoutMs: 5000,
    });
    expect(r.ok === false && r.kind).toBe("timeout");
    expect(r.ok === false && r.message).toContain("5秒");
  });

  it("接続そのものに失敗したときは通信を疑う案内を出す", async () => {
    const { impl } = recordingFetch({ throws: new TypeError("Failed to fetch") });
    const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
    expect(r.ok === false && r.kind).toBe("cors");
  });

  it("どの失敗でも鍵を漏らさない", async () => {
    for (const reply of [
      { status: 401 },
      { status: 500 },
      { throws: new TypeError("Failed to fetch") },
    ]) {
      const { impl } = recordingFetch(reply);
      const r = await askAssistant({ apiKey: KEY, system: "s", user: "u", fetchImpl: impl });
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });
});
