/**
 * FIT取込 Phase 1: ファイルの構造検証（安全な受信）。
 *
 * ここではラップ・心拍などの中身は解析しない（Phase 2以降）。
 * 「これは本当にFITファイルか」「壊れていないか」だけを、FITプロトコルの
 * ヘッダー仕様に基づいて確認する。拡張子やMIME typeは信用しない
 * （どちらも詐称・誤設定されうる）。
 *
 * FITヘッダー（Garmin FIT Protocolの仕様）:
 *   byte 0      : header_size（12 または 14）
 *   byte 1      : protocol_version
 *   bytes 2-3   : profile_version（uint16 little-endian）
 *   bytes 4-7   : data_size（uint32 little-endian。レコード本体のバイト数。
 *                 ヘッダーと末尾2バイトのCRCは含まない）
 *   bytes 8-11  : data_type（ASCII ".FIT" 固定）
 *   bytes 12-13 : header_crc（header_size=14のときだけ存在。任意）
 * ヘッダーの後に data_size バイトのレコード本体、末尾に2バイトのファイルCRC。
 *
 * CRC値そのものの検証（16bit CRC計算）はここでは行わない。Phase 2で
 * 実際の解析ライブラリ（fit-file-parser）を導入する際に、ライブラリ側の
 * デコード結果として自然に検出できるため、Phase 1で重複実装しない。
 */

/**
 * サイズ上限。800m特化の練習記録という用途上、1ファイルは通常
 * 数十〜数百KB（長時間の耐久種目のような大量サンプルにならない）。
 * 5MBは実測ケースの数十倍の余裕を持たせた値で、異常に巨大な
 * ファイル（誤操作・破損・攻撃的な入力）を早期に弾くためのもの。
 */
export const FIT_MAX_BYTES = 5 * 1024 * 1024;

export type FitRejectionReason =
  | "empty"
  | "too_large"
  | "too_short"
  | "bad_header"
  | "bad_signature";

export type FitValidation =
  | {
      ok: true;
      headerSize: number;
      protocolVersion: number;
      profileVersion: number;
      dataSize: number;
    }
  | { ok: false; reason: FitRejectionReason; message: string };

const FIT_SIGNATURE = ".FIT";

export function validateFitBytes(bytes: Uint8Array): FitValidation {
  if (bytes.length === 0) {
    return { ok: false, reason: "empty", message: "空のファイルです。" };
  }
  if (bytes.length > FIT_MAX_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      message: `ファイルサイズが上限（${Math.floor(FIT_MAX_BYTES / 1024 / 1024)}MB）を超えています。`,
    };
  }
  // ヘッダーの最小形（12バイト）にすら満たない
  if (bytes.length < 12) {
    return {
      ok: false,
      reason: "too_short",
      message: "ファイルが短すぎます。FITファイルではない可能性があります。",
    };
  }

  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) {
    return {
      ok: false,
      reason: "bad_header",
      message: "FITファイルのヘッダー形式ではありません。",
    };
  }
  if (bytes.length < headerSize) {
    return {
      ok: false,
      reason: "too_short",
      message: "ヘッダーの途中でファイルが終わっています（破損している可能性があります）。",
    };
  }

  const signature = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (signature !== FIT_SIGNATURE) {
    return {
      ok: false,
      reason: "bad_signature",
      message: "FITファイルの署名（.FIT）が見つかりません。拡張子を偽装したファイルの可能性があります。",
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const protocolVersion = bytes[1];
  const profileVersion = view.getUint16(2, true);
  const dataSize = view.getUint32(4, true);

  // ヘッダーが宣言する本体サイズより、実際のファイルが明らかに短い＝truncated
  const FILE_CRC_BYTES = 2;
  if (headerSize + dataSize + FILE_CRC_BYTES > bytes.length) {
    return {
      ok: false,
      reason: "too_short",
      message: "ファイルの途中で切れています（ダウンロードが不完全な可能性があります）。",
    };
  }

  return { ok: true, headerSize, protocolVersion, profileVersion, dataSize };
}
