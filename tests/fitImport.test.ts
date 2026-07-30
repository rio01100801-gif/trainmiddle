/**
 * FIT取込 Phase 1: 安全な受信（構造検証だけ。ラップ解析はPhase 2以降）
 *
 * 拡張子だけでFITと断定せず、ヘッダー（.FITシグネチャ）と
 * 宣言されたデータサイズ対実際のファイルサイズの整合を確認する。
 * CRC検証はPhase 2で解析ライブラリ導入時に行う（ここでは構造のみ）。
 */
import { describe, expect, it } from "vitest";
import { FIT_MAX_BYTES, validateFitBytes } from "@/lib/core/fitImport";

/** 最小限のFITっぽいバイト列を組み立てる（テスト用） */
function buildFitBytes(opts: {
  headerSize?: number;
  signature?: string;
  dataSize?: number;
  bodyLength?: number;
  crcLength?: number;
} = {}): Uint8Array {
  const headerSize = opts.headerSize ?? 12;
  const signature = opts.signature ?? ".FIT";
  const bodyLength = opts.bodyLength ?? 20;
  const dataSize = opts.dataSize ?? bodyLength;
  const crcLength = opts.crcLength ?? 2;

  const header = new Uint8Array(headerSize);
  header[0] = headerSize;
  header[1] = 16; // protocol version（仮）
  new DataView(header.buffer).setUint16(2, 100, true); // profile version
  new DataView(header.buffer).setUint32(4, dataSize, true);
  for (let i = 0; i < 4; i++) header[8 + i] = signature.charCodeAt(i) || 0;

  const body = new Uint8Array(bodyLength).fill(0xab);
  const crc = new Uint8Array(crcLength);
  return new Uint8Array([...header, ...body, ...crc]);
}

describe("validateFitBytes", () => {
  it("正常なFITヘッダーを受け入れる", () => {
    const bytes = buildFitBytes();
    const result = validateFitBytes(bytes);
    expect(result.ok).toBe(true);
  });

  it("14バイトヘッダー（拡張ヘッダー）も受け入れる", () => {
    const bytes = buildFitBytes({ headerSize: 14, bodyLength: 20 });
    expect(validateFitBytes(bytes).ok).toBe(true);
  });

  it("空ファイルを拒否する", () => {
    const result = validateFitBytes(new Uint8Array(0));
    expect(result).toMatchObject({ ok: false, reason: "empty" });
  });

  it("サイズ上限を超えるファイルを拒否する", () => {
    const bytes = new Uint8Array(FIT_MAX_BYTES + 1);
    const result = validateFitBytes(bytes);
    expect(result).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("短すぎるファイル（ヘッダーに満たない）を拒否する", () => {
    const result = validateFitBytes(new Uint8Array([1, 2, 3]));
    expect(result).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("header_sizeが12でも14でもない値を拒否する", () => {
    const bytes = buildFitBytes({ headerSize: 12 });
    bytes[0] = 99;
    const result = validateFitBytes(bytes);
    expect(result).toMatchObject({ ok: false, reason: "bad_header" });
  });

  it("「.FIT」シグネチャが無ければ拒否する（FIT以外のファイル）", () => {
    const bytes = buildFitBytes({ signature: "PK\x03\x04" }); // 実はZIPやPNG等を想定
    const result = validateFitBytes(bytes);
    expect(result).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("宣言されたデータサイズより実際のファイルが短い場合は破損として拒否する", () => {
    // ヘッダーには「本体100バイト」と書いてあるのに、実際は20バイトしかない
    const bytes = buildFitBytes({ dataSize: 100, bodyLength: 20 });
    const result = validateFitBytes(bytes);
    expect(result).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("正常な場合はヘッダー由来の値を返す（本文の解析はしない）", () => {
    const bytes = buildFitBytes({ bodyLength: 30 });
    const result = validateFitBytes(bytes);
    if (result.ok) {
      expect(result.headerSize).toBe(12);
      expect(result.dataSize).toBe(30);
    } else {
      throw new Error("正常なFITが拒否された");
    }
  });

  it("同じ入力からは常に同じ結果になる（決定的処理）", () => {
    const bytes = buildFitBytes();
    const a = validateFitBytes(bytes);
    const b = validateFitBytes(bytes);
    expect(a).toEqual(b);
  });
});
