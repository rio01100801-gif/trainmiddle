"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, StatusText } from "../components/ui";
import {
  ASSISTANT_MODEL,
  askAssistant,
  clearApiKey,
  getApiKey,
  getConsent,
  maskApiKey,
  saveApiKey,
  saveConsent,
  validateApiKey,
  type AssistantAnswer,
} from "../components/assistant";
import {
  ASSISTANT_SYSTEM_PROMPT,
  assistantUserMessage,
  type AssistantContext,
} from "@/lib/core/assistantContext";

/**
 * 相談（AI）
 *
 * 「なんでこの数字なの」「なんで今日これなの」をアプリの中で聞けるようにする。
 * これまでは開発側に聞くしかなく、本人が自分で確かめる手段が無かった。
 *
 * **この画面がやらないこと:**
 *   ・CFE・設定ペース・メニューの決定に関与しない（返るのは文章だけ）
 *   ・答えを数値へ書き戻さない（そういう経路を作らない）
 * 決めるのはこれまでどおり決定的なコア。ここは読んで説明するだけ。
 *
 * **送る前に、送る内容を全文見せる。** データが端末の外へ出るので、
 * 何が出ていくかを本人が確認できないまま送ってはいけない。
 * 画面に出す文字列と送る文字列は同じ実体（`context.text`）で、
 * その一致はテスト（assistantContext.test.ts）で固定してある。
 */

/** 質問の例。質問の形を示すだけなので固定でよい */
const EXAMPLES = [
  "なんでCFEが今の値なの？",
  "今日のメニューはなんでこれが選ばれたの？",
  "いま出てる警告はどうすればいい？",
  "この2週間の配分は目標に対して合ってる？",
];

export default function AskPage() {
  const [savedKey, setSavedKey] = useState<string | undefined>();
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const [consent, setConsent] = useState(false);

  const [context, setContext] = useState<AssistantContext | undefined>();
  const [contextError, setContextError] = useState("");
  const [showContext, setShowContext] = useState(false);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | undefined>();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    try {
      setSavedKey(getApiKey());
      setConsent(getConsent());
    } catch {
      // localStorageが使えない環境。鍵が無い扱いで進める（下で設定を促す）
    }
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    fetch("/api/assistant-context")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { context: AssistantContext }) => setContext(d.context))
      .catch((e: unknown) =>
        setContextError(
          `今のデータを読み取れませんでした: ${e instanceof Error ? e.message : String(e)}`
        )
      );
  }, []);

  const onSaveKey = useCallback(() => {
    const error = validateApiKey(keyInput);
    if (error) {
      setKeyError(error);
      return;
    }
    try {
      saveApiKey(keyInput);
      setSavedKey(getApiKey());
      setKeyInput("");
      setKeyError("");
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : String(e));
    }
  }, [keyInput]);

  const onClear = useCallback(() => {
    clearApiKey();
    saveConsent(false);
    setSavedKey(undefined);
    setConsent(false);
    setAnswer(undefined);
  }, []);

  const onToggleConsent = useCallback((next: boolean) => {
    saveConsent(next);
    setConsent(next);
  }, []);

  const onAsk = useCallback(async () => {
    if (!savedKey || !context || !question.trim() || !consent) return;
    setBusy(true);
    setAnswer(undefined);
    const result = await askAssistant({
      apiKey: savedKey,
      system: ASSISTANT_SYSTEM_PROMPT,
      user: assistantUserMessage(context, question.trim()),
    });
    setAnswer(result);
    setBusy(false);
  }, [savedKey, context, question, consent]);

  /*
   * オフラインなら機能ごと出さない。
   * 「押しても何も起きないボタン」を残すと、壊れているのか通信が無いのかを
   * 本人が区別できない。アプリの他の部分はオフラインでもこれまでどおり動く。
   */
  if (!online) {
    return (
      <div className="flex flex-col gap-3" data-page="ask">
        <Card title="相談">
          <StatusText kind="warning" className="text-[12px] leading-relaxed">
            オフラインです。相談だけは通信が要ります（質問を端末の外へ送るため）。
            他の画面はこれまでどおりオフラインで使えます。
          </StatusText>
        </Card>
      </div>
    );
  }

  const ready = !!savedKey && consent && !!context && !context.blocked;

  return (
    <div className="flex flex-col gap-3" data-page="ask">
      <Card title="相談">
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          今のデータを読んだうえで、「なんでこの数字なのか」「なんで今日これなのか」を説明します。
        </p>
        <p className="text-[11.5px] leading-relaxed mt-2" style={{ color: "var(--text-3)" }}>
          返るのは文章だけです。CFE・設定ペース・メニューはこれまでどおりアプリが計算して決めており、
          ここでの答えがそれらを書き換えることはありません。
        </p>
      </Card>

      {/* ---- 鍵 ---- */}
      <Card title="接続設定">
        {savedKey ? (
          <>
            <StatusText kind="success" className="text-[11.5px] mb-2">
              APIキー設定済み: {maskApiKey(savedKey)}
            </StatusText>
            <p className="text-[11.5px] leading-relaxed mb-2.5" style={{ color: "var(--text-3)" }}>
              キーはこの端末の中だけに保存しています。使うモデルは {ASSISTANT_MODEL} で、
              料金はご自身のAnthropicアカウントに請求されます。
            </p>
            <button className="btn-ghost" onClick={onClear} data-testid="ask-clear-key">
              キーと同意を消す
            </button>
          </>
        ) : (
          <>
            <p className="text-[12px] leading-relaxed mb-2.5" style={{ color: "var(--text-2)" }}>
              AnthropicのAPIキーを入れてください（console.anthropic.com で発行）。
              入れたキーはこの端末の中だけに保存し、Anthropic以外へは送りません。
            </p>
            <label className="block text-[13px] mb-2.5">
              <span className="block text-[10.5px] mb-1" style={{ color: "var(--text-3)" }}>
                API Key
              </span>
              <input
                className="w-full"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                data-testid="ask-key-input"
              />
            </label>
            {keyError ? (
              <StatusText kind="error" className="text-[11.5px] mb-2">
                {keyError}
              </StatusText>
            ) : null}
            <button className="btn-volt" onClick={onSaveKey} data-testid="ask-save-key">
              保存する
            </button>
          </>
        )}
      </Card>

      {/* ---- 同意（鍵の設定とは別に取る） ---- */}
      {savedKey ? (
        <Card title="データが端末の外へ出ます">
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-2)" }}>
            質問すると、下の「送る内容」に書かれている練習データがAnthropicへ送られます。
            送るのは訓練の数値だけで、氏名は含みません。送る前に全文を確認できます。
          </p>
          <label className="flex items-start gap-2 mt-2.5 text-[12.5px]">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => onToggleConsent(e.target.checked)}
              data-testid="ask-consent"
            />
            <span>了解した上で使う</span>
          </label>
        </Card>
      ) : null}

      {/* ---- 送る内容 ---- */}
      {contextError ? (
        <Card title="送る内容">
          <StatusText kind="error" className="text-[11.5px]">
            {contextError}
          </StatusText>
        </Card>
      ) : context ? (
        <Card
          title="送る内容"
          right={
            <button
              className="btn-ghost"
              onClick={() => setShowContext((v) => !v)}
              data-testid="ask-toggle-context"
            >
              {showContext ? "閉じる" : "全文を見る"}
            </button>
          }
        >
          {context.blocked ? (
            <StatusText kind="warning" className="text-[11.5px] leading-relaxed">
              {context.blocked}
            </StatusText>
          ) : (
            <>
              <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>
                {context.sections.map((s) => s.title).join(" / ")}（{context.text.length}文字）
              </p>
              {showContext ? (
                <pre
                  className="mt-2.5 text-[11px] leading-relaxed whitespace-pre-wrap"
                  style={{ color: "var(--text-2)" }}
                  data-testid="ask-context-text"
                >
                  {context.text}
                </pre>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {/* ---- 質問 ---- */}
      <Card title="聞く">
        <textarea
          className="w-full"
          rows={3}
          placeholder="例: なんでCFEが今の値なの？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          data-testid="ask-question"
        />
        <div className="flex gap-1.5 flex-wrap mt-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="btn-ghost" onClick={() => setQuestion(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <button
          className="btn-volt justify-center w-full mt-2.5"
          disabled={!ready || busy || !question.trim()}
          onClick={onAsk}
          data-testid="ask-send"
        >
          {busy ? "考えています…" : "送って聞く"}
        </button>
        {!savedKey ? (
          <StatusText kind="warning" className="text-[11.5px] mt-2">
            先にAPIキーを設定してください。
          </StatusText>
        ) : !consent ? (
          <StatusText kind="warning" className="text-[11.5px] mt-2">
            データが端末の外へ出ることへの同意が要ります。
          </StatusText>
        ) : context?.blocked ? (
          <StatusText kind="warning" className="text-[11.5px] mt-2 leading-relaxed">
            {context.blocked}
          </StatusText>
        ) : null}
      </Card>

      {answer ? (
        <Card title="答え">
          {answer.ok ? (
            <>
              <pre
                className="text-[12.5px] leading-relaxed whitespace-pre-wrap"
                style={{ color: "var(--text-1)" }}
                data-testid="ask-answer"
              >
                {answer.text}
              </pre>
              {answer.truncated ? (
                <StatusText kind="warning" className="text-[11.5px] mt-2 leading-relaxed">
                  答えが途中で切れています。質問を分けて聞き直してください。
                </StatusText>
              ) : null}
              <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: "var(--text-3)" }}>
                この答えは説明です。設定ペースやCFEは変わっていません。
              </p>
            </>
          ) : (
            <StatusText kind="error" className="text-[11.5px] leading-relaxed">
              <span data-testid="ask-error">{answer.message}</span>
            </StatusText>
          )}
        </Card>
      ) : null}
    </div>
  );
}
