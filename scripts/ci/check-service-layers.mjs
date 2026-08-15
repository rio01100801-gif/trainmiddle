/**
 * サービス層の import が片方向であることを見張る。
 *
 * `service.ts` は4600行あり、少しずつ端から外へ出している。
 * このとき一番やりやすい失敗が **循環参照**——
 * 切り出した側が元のファイルを import し、元のファイルも切り出した側を import する形。
 *
 * ESM は関数宣言なら巻き上げで動いてしまうことがあるので、
 * **循環していても動く。動くから気づけない。**
 * バンドラや評価順が変わった瞬間に「初期化前の変数を読んだ」で落ちる。
 * だから動作ではなく構造を機械で見る。
 *
 * 決めた向き（下が上を知らない）:
 *
 *   index.ts     入口。再exportだけ。誰からも import されない
 *      ↓
 *   run.ts       M-4 セッション中。workflow を呼ぶ
 *      ↓
 *   workflow.ts  予定と結果の輪。**上を知らない**
 *
 * 予定と結果を分けなかった理由は index.ts に書いてある。
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, "../../src/lib/service");

/** 数字が小さいほど下層。下層は上層を import してはいけない */
const LAYER = {
  "workflow.ts": 0,
  "run.ts": 1,
  "index.ts": 2,
};

const problems = [];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"));

for (const file of files) {
  if (!(file in LAYER)) {
    problems.push(
      `${file}: 層が決まっていません。scripts/ci/check-service-layers.mjs の LAYER に、` +
        `どこに置くつもりかを理由とともに足してください`
    );
    continue;
  }
  const text = fs.readFileSync(path.join(DIR, file), "utf8");
  // 同じフォルダ内への import だけを見る（../core/* などは対象外）
  for (const m of text.matchAll(/from\s+"\.\/([\w.-]+)"/g)) {
    const target = m[1].endsWith(".ts") ? m[1] : `${m[1]}.ts`;
    if (!(target in LAYER)) {
      problems.push(`${file} → ${target}: 層が決まっていません`);
      continue;
    }
    if (LAYER[target] >= LAYER[file]) {
      problems.push(
        `${file}（層${LAYER[file]}） → ${target}（層${LAYER[target]}）: ` +
          `下から上、または同じ層への import です。循環します`
      );
    }
  }
}

if (problems.length > 0) {
  console.error("サービス層の向きが崩れています:\n");
  for (const p of problems) console.error("  " + p);
  console.error(
    "\n循環しても ESM の巻き上げで動いてしまうことがあります。" +
      "\n動くから気づけないだけで、評価順が変わった瞬間に落ちます。" +
      "\n切り出した側から元のファイルを呼びたくなったら、" +
      "\n**共通の下請けを先に下の層へ出してください。**"
  );
  process.exit(1);
}

console.log(`サービス層の向きOK（${files.length}ファイル・下から上への import なし）`);
