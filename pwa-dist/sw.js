/*
 * オフラインキャッシュ
 *
 * 方針: アプリ本体（index.html / bundle.js / styles.css）はネットワーク優先、
 * アイコン類はキャッシュ優先。
 *
 * 以前はすべてキャッシュ優先だったが、それだと配信ファイルを差し替えても
 * 端末側は古い bundle.js を永久に使い続け、更新がユーザーに届かなかった。
 * オフラインで動くことより先に「直したものが反映される」ことを保証する。
 * ネットワークが無いときは従来どおりキャッシュから返すのでオフラインでも動く。
 *
 * リリースのたびに VERSION を必ず上げること（上げないと install が走らない）。
 */
const VERSION = "forge-v52";
const ASSETS = [
  "./",
  "./index.html",
  "./bundle.js",
  "./styles.css",
  "./manifest.webmanifest",
  /*
   * アイコンは版数つきのURLで取る。
   * build-static が index.html と manifest の参照にも同じクエリを付けるので、
   * ここを素のファイル名にしておくと、オフライン時にアイコンだけ取れなくなる。
   * （クエリを付けているのは、iOSがホーム画面のアイコンを焼き付けたうえ
   *   Safariが画像自体もキャッシュするため。URLが変わらないと追加し直しても古いまま）
   */
  `./icon-180.png?v=${VERSION}`,
  `./icon-32.png?v=${VERSION}`,
  `./icon-192.png?v=${VERSION}`,
  `./icon-512.png?v=${VERSION}`,
  `./icon-maskable-512.png?v=${VERSION}`,
  /*
   * ブランド資産。styles.css から参照されるのでオフラインでも要る。
   * アイコンと違い版数クエリを付けないのは、CSSの url() 側にクエリが無く
   * URLが一致しないとキャッシュヒットしないため（fetchハンドラは
   * ignoreSearch で拾うが、install時のaddAllはURL一致で入る）。
   */
  "./brand-wordmark.png",
];

/** 更新を必ず取りに行く対象（アプリ本体） */
function isAppShell(url) {
  const p = new URL(url).pathname;
  return (
    p.endsWith("/") ||
    p.endsWith("/index.html") ||
    p.endsWith("/bundle.js") ||
    p.endsWith("/styles.css") ||
    p.endsWith("/manifest.webmanifest")
  );
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      // reload: HTTPキャッシュを迂回して必ず新しい実体を取る
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const sameOrigin = new URL(e.request.url).origin === location.origin;

  /*
   * Supabaseなど外部originの通信はService Workerで横取りしない。
   * アプリ本体のオフラインキャッシュと無関係なうえ、iOSではCORS失敗が
   * Service Workerのfetch失敗に見えて原因を追えなくなるため。
   */
  if (!sameOrigin) return;

  if (isAppShell(e.request.url)) {
    // ネットワーク優先 + 成功したらキャッシュ更新 / 失敗したらキャッシュ
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(e.request, { ignoreSearch: true })
            .then((hit) => hit || caches.match("./index.html"))
        )
    );
    return;
  }

  // それ以外（アイコン等）はキャッシュ優先
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          if (res.ok) {
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});
