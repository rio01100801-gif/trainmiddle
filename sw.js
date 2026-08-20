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
const VERSION = "forge-v118";
/*
 * 分割された chunk（遅延読み込みの画面・FIT解析）。
 *
 * ファイル名にハッシュが入るので、ここには実体の名前を書けない。
 * ビルド時に scripts/build-static.mjs がこの行を実体の名前で置き換える。
 *
 * **プリキャッシュしないと、インストール直後にオフラインへ入ったとき
 * 遅延読み込みの画面だけが開けない。** fetchハンドラはchunkをキャッシュ優先で
 * 扱うが、一度も取っていなければキャッシュに無く、通信も無いので開けない。
 */
const CHUNKS = ["./chunk-0x6psvs6.js", "./chunk-0zz4ffgv.js", "./chunk-1ss3y454.js", "./chunk-2g6yavtv.js", "./chunk-2rg05nn6.js", "./chunk-37qa9tfx.js", "./chunk-3fm88e87.js", "./chunk-4pcb5xbv.js", "./chunk-5b5mq7c8.js", "./chunk-5dj0700d.js", "./chunk-6c2ncnhp.js", "./chunk-6g3z241z.js", "./chunk-6v0etyfb.js", "./chunk-71x9ewts.js", "./chunk-749fhp76.js", "./chunk-8b7jndhm.js", "./chunk-8j8ctsz7.js", "./chunk-911a0dzb.js", "./chunk-9s39y4gb.js", "./chunk-9wq7sepq.js", "./chunk-bq17rxjn.js", "./chunk-c4zrsb43.js", "./chunk-cjk3jhrj.js", "./chunk-cpvvrp3r.js", "./chunk-dxp033ds.js", "./chunk-fg7p2nc7.js", "./chunk-gd4v40hv.js", "./chunk-gs8by31p.js", "./chunk-hktr403n.js", "./chunk-kayr60p6.js", "./chunk-kq98xbvg.js", "./chunk-kt740v9b.js", "./chunk-mmctgxhs.js", "./chunk-n5m0byjc.js", "./chunk-n7y65drj.js", "./chunk-pksxk2f2.js", "./chunk-pp92640h.js", "./chunk-pvkzr4kx.js", "./chunk-smzxnkcd.js", "./chunk-sx57hzh6.js", "./chunk-t5rhv99v.js", "./chunk-tasssvwk.js", "./chunk-th76emhd.js", "./chunk-tw5wnhb2.js", "./chunk-v1h42qn5.js", "./chunk-v9hrt3ra.js", "./chunk-w8n918vr.js", "./chunk-x11746r0.js", "./chunk-xa9sanpf.js", "./chunk-xxswvqzx.js", "./chunk-y9dd9tek.js", "./chunk-yv21m5vf.js", "./chunk-z72tgmx3.js", "./chunk-za3pwwyc.js", "./chunk-znc9w7ja.js"];
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
    caches.open(VERSION).then(async (c) => {
      // reload: HTTPキャッシュを迂回して必ず新しい実体を取る
      // アプリ本体はそろわないと動かないので、1つでも失敗したらinstallも失敗させる
      await c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })));
      /*
       * chunkは1つ落ちても他の画面は動くので、installごと失敗させない。
       * 画面を分けたぶん数が増えており（数十件）、ここを全部必須にすると
       * たまたま1つ取れなかっただけで**新しい版が一切届かなくなる**。
       * 取れなかったchunkは、その画面を開いたときにfetchハンドラが取りに行く。
       */
      await Promise.allSettled(
        CHUNKS.map((u) => c.add(new Request(u, { cache: "reload" })))
      );
      await self.skipWaiting();
    })
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
    /*
     * stale-while-revalidate: キャッシュがあれば即返し、更新は裏で取る。
     *
     * 以前はネットワーク優先だった。理由は「VERSIONを上げ忘れて再配信しても
     * 端末に新版が届く」という保険で、それ自体は要る（`e2e-update.mjs` が見張っている）。
     * ただし代償として、**手元に完動品があるのに毎回まず通信を待っていた**。
     * bundle.js は1MB近くあるので、電波が悪いと起動のたびに白い画面が数秒続く。
     * iOSでアプリがメモリから落とされたあとの起動で、これがそのまま体感になる。
     *
     * キャッシュを即返し、取得した新版はキャッシュに入れて**次回の起動で反映**する。
     * 保険は1回遅れで残る。VERSIONを上げた場合は install が新しいキャッシュを
     * 作り直すので、これまで通り次の起動で即座に切り替わる（遅れない）。
     */
    e.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(e.request, { ignoreSearch: true }).then((hit) => {
          const fresh = fetch(e.request)
            .then((res) => {
              if (res.ok) cache.put(e.request, res.clone());
              return res;
            })
            .catch(() => hit || caches.match("./index.html"));
          if (hit) {
            // 裏の更新は応答と切り離す。ここで待たないので起動は速いまま
            e.waitUntil(fresh.catch(() => {}));
            return hit;
          }
          return fresh;
        })
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
