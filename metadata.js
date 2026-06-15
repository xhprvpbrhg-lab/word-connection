// ソースURLからタイトル等のメタデータを取得する。
// 将来 Apple Music / Spotify / X などに広げられるよう、provider判定と取得を分離。
// 返り値: { title, provider, url } もしくは null（失敗時。例外は投げない＝保存を妨げない）。

// YouTube動画IDを各種URL形から抽出する。
//   youtube.com/watch?v=ID / music.youtube.com/watch?v=ID
//   youtu.be/ID
//   youtube.com/shorts/ID
//   youtube.com/embed/ID（おまけ）
export function extractYouTubeId(url) {
  const u = (url || '').trim();
  if (!u) return null;
  let m = u.match(/(?:^|\/\/|\.)youtu\.be\/([\w-]{6,})/i);
  if (m) return m[1];
  m = u.match(/youtube\.com\/shorts\/([\w-]{6,})/i);
  if (m) return m[1];
  m = u.match(/youtube\.com\/embed\/([\w-]{6,})/i);
  if (m) return m[1];
  m = u.match(/youtube\.com\/watch\?[^#]*\bv=([\w-]{6,})/i);
  if (m) return m[1];
  return null;
}

// URLからプロバイダ名を判定。未対応なら null。
export function detectProvider(url) {
  if (extractYouTubeId(url)) return 'youtube';
  // 将来: apple_music / spotify / x ...
  return null;
}

async function fetchYouTube(url) {
  const id = extractYouTubeId(url);
  if (!id) return null;
  // どの形のURLでも canonical watch URL に正規化してから oEmbed に渡す
  const canonical = `https://www.youtube.com/watch?v=${id}`;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`;
  const res = await fetch(endpoint);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.title) return null;
  return { title: data.title, provider: 'youtube', url: canonical };
}

const PROVIDERS = {
  youtube: fetchYouTube,
};

// --- X / Twitter（Person用） -------------------------------------------------

// プロフィールでない予約パス。これらは username とみなさない。
const X_RESERVED = new Set([
  'home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i',
  'intent', 'share', 'hashtag', 'compose', 'login', 'logout', 'signup',
  'about', 'tos', 'privacy', 'help', 'status',
]);

// X / Twitter URL から username を抽出。プロフィール・投稿どちらの形でも username を返す
// （投稿URLは対象外だが、可能なら username 抽出してよい、という方針に沿う）。未対応は null。
export function extractXUsername(url) {
  const u = (url || '').trim();
  const m = u.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (!m) return null;
  const name = m[1].replace(/^@/, '');
  if (X_RESERVED.has(name.toLowerCase())) return null;
  return name;
}

// Personメタデータ取得。返り値 { name, username, url, provider:'x' } もしくは null。
// X oEmbed は本来ツイート用でプロフィールでは失敗しがち。失敗時は @username にフォールバック。
export async function fetchPersonMetadata(url) {
  try {
    const username = extractXUsername(url);
    if (!username) return null;
    const profileUrl = `https://x.com/${username}`;
    let name = `@${username}`;
    try {
      const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(profileUrl)}&omit_script=1`;
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        if (data && data.author_name) name = data.author_name; // 表示名が取れたら優先
      }
    } catch (e) { /* oEmbed失敗は @username のまま */ }
    return { name, username, url: profileUrl, provider: 'x' };
  } catch (e) {
    return null;
  }
}

// メイン入口。ネットワーク/CORS等の失敗はすべて null で吸収する。
export async function fetchSourceMetadata(url) {
  try {
    const provider = detectProvider(url);
    if (!provider) return null;
    const fn = PROVIDERS[provider];
    if (!fn) return null;
    return await fn(url);
  } catch (e) {
    return null;
  }
}
