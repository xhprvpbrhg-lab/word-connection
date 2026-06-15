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
