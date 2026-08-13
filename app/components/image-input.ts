/**
 * 写真を送れる形にする（縮小して base64 にする）。
 *
 * 大きさの計算は `src/lib/core/transcription.ts` の `fitWithin` にあり、
 * そちらは純関数でテスト済み。ここはブラウザのAPIを叩くだけの薄い層にしてある
 * （canvas も createImageBitmap も node のテストからは動かせないため、
 *   判断が要る部分をこちら側に残さない）。
 */
import { fitWithin, isAcceptedImageType, MAX_IMAGE_EDGE } from "@/lib/core/transcription";

export interface PreparedImage {
  mediaType: "image/jpeg";
  base64: string;
  /** 画面にそのまま出せる形。送る前に本人が確認するために使う */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Anthropicが受ける1枚あたりの上限（5MB）に対する余裕をみた値。
 * base64は元の約4/3になるので、ここを超えたらもう一段縮める。
 */
const MAX_BASE64_BYTES = 4_500_000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした。別の写真で試してください。"));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, width: number, height: number, quality: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("この端末では画像を縮小できませんでした。");
  // 手書きを潰さないために補間を効かせる
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * 写真を縮めて base64 にする。
 *
 * HEIC など Anthropic が受けない形式は、ブラウザが読めれば JPEG に変換されるので
 * ここを通れば通る。読めない場合は `loadImage` が失敗する。
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.type && !isAcceptedImageType(file.type) && !file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選んでください。");
  }
  const img = await loadImage(file);
  const size = fitWithin(img.naturalWidth, img.naturalHeight, MAX_IMAGE_EDGE);
  if (size.width === 0 || size.height === 0) {
    throw new Error("画像の大きさを読み取れませんでした。");
  }

  /*
   * 画質を落としながら上限に収める。
   * 落としすぎると手書きが読めなくなるので 0.6 で打ち切り、
   * それでも入らなければ寸法のほうを削る（潰れるより小さいほうがまし）。
   */
  let width = size.width;
  let height = size.height;
  let dataUrl = "";
  for (const quality of [0.85, 0.75, 0.6]) {
    dataUrl = draw(img, width, height, quality);
    if (dataUrl.length <= MAX_BASE64_BYTES) break;
  }
  while (dataUrl.length > MAX_BASE64_BYTES && width > 640) {
    const next = fitWithin(width, height, Math.round(Math.max(width, height) * 0.8));
    width = next.width;
    height = next.height;
    dataUrl = draw(img, width, height, 0.75);
  }
  if (dataUrl.length > MAX_BASE64_BYTES) {
    throw new Error("写真が大きすぎて送れませんでした。撮り直すか、範囲を絞って撮ってください。");
  }

  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return {
    mediaType: "image/jpeg",
    base64,
    dataUrl,
    width,
    height,
    bytes: Math.round((base64.length * 3) / 4),
  };
}
