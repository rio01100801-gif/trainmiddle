/**
 * サンドボックス内での型チェック専用スタブ（@types/node が無い環境向け）。
 * 本体の tsconfig.json からは除外されており、実ビルドには影響しない。
 */
declare module "path" {
  export function join(...parts: string[]): string;
  export function dirname(p: string): string;
  export function resolve(...parts: string[]): string;
}
declare module "fs" {
  export function mkdirSync(p: string, opts?: { recursive?: boolean }): void;
}
declare module "better-sqlite3";
declare module "bun:sqlite";

declare var process: {
  argv: string[];
  cwd(): string;
  versions: { bun?: string; node?: string };
};
declare function require(id: string): any;
declare const __dirname: string;
