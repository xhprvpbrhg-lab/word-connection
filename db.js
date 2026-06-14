// データ層。Dexie(IndexedDB) を repo に閉じ込め、将来クラウド同期へ差し替えやすくする。
import Dexie from 'https://esm.sh/dexie@4';

export const db = new Dexie('toneVocab');

// スキーマ定義（SCHEMA.md 準拠）
db.version(1).stores({
  terms: 'id, label, *normKeys, createdAt',
  persons: 'id, name, kind, createdAt',
  sources: 'id, kind, label, createdAt',
  utterances: 'id, termId, personId, sourceId, contrastTermId, valence, createdAt',
});

// v2: Utterance に focus（観察対象）を追加し索引化。timestamp / locationNote も追加（索引不要）。
// 既存データは focus 未設定なので 'performance' を補完する。
db.version(2).stores({
  utterances: 'id, termId, personId, sourceId, contrastTermId, valence, focus, createdAt',
}).upgrade((tx) => tx.table('utterances').toCollection().modify((u) => {
  if (!u.focus) u.focus = 'performance';
  if (u.timestamp == null) u.timestamp = '';
  if (u.locationNote == null) u.locationNote = '';
}));

// focus の許容キー（不正値は performance に丸める）
export const FOCUS_KEYS = ['performance', 'instrument', 'interpretation', 'recording', 'acoustics', 'moment'];

// --- ユーティリティ ---------------------------------------------------------

// 時系列ソート可能なID（簡易ULID風: 時刻48bit + ランダム）
function newId() {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = Math.random().toString(36).slice(2, 10);
  return `${t}${r}`;
}

const nowISO = () => new Date().toISOString();

// 表記ゆれ吸収用の正規化キー。NFKC + 小文字 + 空白除去。
// 末尾活用（明るい/明るめ/明るさ）は自動マージしない方針なので、ここでは緩く揃えるだけ。
export function normalize(s) {
  return (s || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
}

// --- Term -------------------------------------------------------------------

// label/aliases から既存Termを探す（正規化一致）。無ければ null。
export async function findTermByText(text) {
  const key = normalize(text);
  if (!key) return null;
  return (await db.terms.where('normKeys').equals(key).first()) || null;
}

export async function createTerm({ label, aliases = [], note = '' }) {
  const id = newId();
  const all = [label, ...aliases];
  const term = {
    id, label, aliases, note,
    normKeys: [...new Set(all.map(normalize).filter(Boolean))],
    createdAt: nowISO(),
  };
  await db.terms.add(term);
  return term;
}

// 既存があれば返し、無ければ作る。
export async function getOrCreateTerm(label) {
  const found = await findTermByText(label);
  if (found) return found;
  return createTerm({ label });
}

// 既存Termに別表記を alias として追加（「明るめ→明るい にまとめる」を人が確定したとき）
export async function addAlias(termId, alias) {
  const term = await db.terms.get(termId);
  if (!term) return null;
  const aliases = [...new Set([...term.aliases, alias])];
  const normKeys = [...new Set([...term.normKeys, normalize(alias)])];
  await db.terms.update(termId, { aliases, normKeys });
  return { ...term, aliases, normKeys };
}

// --- Person / Source --------------------------------------------------------

export async function getOrCreatePerson(name, kind = 'other') {
  if (!name) return null;
  const found = await db.persons.where('name').equals(name).first();
  if (found) return found;
  const p = { id: newId(), name, kind, handle: '', note: '', createdAt: nowISO() };
  await db.persons.add(p);
  return p;
}

export async function getOrCreateSource(label, kind = 'other', ref = '') {
  if (!label) return null;
  const found = await db.sources.where('label').equals(label).first();
  if (found) return found;
  const s = { id: newId(), kind, label, ref, meta: {}, note: '', createdAt: nowISO() };
  await db.sources.add(s);
  return s;
}

// --- Utterance（中心） -------------------------------------------------------

// クイック入力の保存。文字列を受け取り、必要なTerm/Person/Sourceを解決/作成する。
export async function addUtterance(input) {
  const {
    termLabel, valence,
    personName, personKind,
    sourceLabel, sourceKind, sourceRef,
    contrastLabel, aspect = '', note = '', observedVia = 'direct',
    focus = 'performance', timestamp = '', locationNote = '',
  } = input;

  if (!termLabel || !valence) throw new Error('termLabel と valence は必須');

  const term = await getOrCreateTerm(termLabel);
  const person = personName ? await getOrCreatePerson(personName, personKind) : null;
  const source = sourceLabel ? await getOrCreateSource(sourceLabel, sourceKind, sourceRef) : null;
  const contrast = contrastLabel ? await getOrCreateTerm(contrastLabel) : null;

  const u = {
    id: newId(),
    termId: term.id,
    valence,
    personId: person ? person.id : null,
    sourceId: source ? source.id : null,
    contrastTermId: contrast ? contrast.id : null,
    focus: FOCUS_KEYS.includes(focus) ? focus : 'performance',
    timestamp: (timestamp || '').trim(), // 空は実質未保存（表示時に非表示）
    locationNote: (locationNote || '').trim(),
    aspect, note, observedVia,
    createdAt: nowISO(),
  };
  await db.utterances.add(u);
  return u;
}

export async function recentUtterances(limit = 10) {
  const us = await db.utterances.orderBy('createdAt').reverse().limit(limit).toArray();
  return hydrate(us);
}

export async function allTermsWithCounts() {
  const terms = await db.terms.orderBy('label').toArray();
  const counts = {};
  await db.utterances.each((u) => { counts[u.termId] = (counts[u.termId] || 0) + 1; });
  return terms.map((t) => ({ ...t, count: counts[t.id] || 0 }))
    .sort((a, b) => b.count - a.count);
}

// Utterance に term/person/source の表示名を付ける
async function hydrate(us) {
  const [terms, persons, sources] = await Promise.all([
    db.terms.toArray(), db.persons.toArray(), db.sources.toArray(),
  ]);
  const tmap = Object.fromEntries(terms.map((t) => [t.id, t]));
  const pmap = Object.fromEntries(persons.map((p) => [p.id, p]));
  const smap = Object.fromEntries(sources.map((s) => [s.id, s]));
  return us.map((u) => ({
    ...u,
    term: tmap[u.termId],
    contrastTerm: u.contrastTermId ? tmap[u.contrastTermId] : null,
    person: u.personId ? pmap[u.personId] : null,
    source: u.sourceId ? smap[u.sourceId] : null,
  }));
}

// --- 導出: 言葉詳細の統計 ----------------------------------------------------

export async function termDetail(termId) {
  const term = await db.terms.get(termId);
  if (!term) return null;

  const us = await db.utterances.where('termId').equals(termId).toArray();

  // 良し悪し内訳
  const valence = { positive: 0, neutral: 0, negative: 0 };
  us.forEach((u) => { valence[u.valence] = (valence[u.valence] || 0) + 1; });

  // 誰が使ったか（person別 valence集計）
  const persons = await db.persons.toArray();
  const pmap = Object.fromEntries(persons.map((p) => [p.id, p]));
  const byPerson = {};
  us.forEach((u) => {
    const key = u.personId || '_unknown';
    byPerson[key] = byPerson[key] || { person: pmap[u.personId] || null, positive: 0, neutral: 0, negative: 0 };
    byPerson[key][u.valence] += 1;
  });

  // ≒近い: この言葉が現れた source で共起する別の言葉
  const sourceIds = [...new Set(us.map((u) => u.sourceId).filter(Boolean))];
  const near = {};
  if (sourceIds.length) {
    const terms = await db.terms.toArray();
    const tmap = Object.fromEntries(terms.map((t) => [t.id, t]));
    for (const sid of sourceIds) {
      const co = await db.utterances.where('sourceId').equals(sid).toArray();
      co.forEach((u) => {
        if (u.termId === termId) return;
        near[u.termId] = near[u.termId] || { term: tmap[u.termId], weight: 0 };
        near[u.termId].weight += 1;
      });
    }
  }
  const nearList = Object.values(near).filter((n) => n.term).sort((a, b) => b.weight - a.weight).slice(0, 8);

  // ⇄対: contrastTermId が付いた発話を person別に
  const terms2 = await db.terms.toArray();
  const tmap2 = Object.fromEntries(terms2.map((t) => [t.id, t]));
  const contrasts = us.filter((u) => u.contrastTermId).map((u) => ({
    person: pmap[u.personId] || null,
    contrastTerm: tmap2[u.contrastTermId],
  })).filter((c) => c.contrastTerm);

  // 揺れフラグ（静かに表示）: ポジとネガが両方ある or 対比が人によって割れている
  const distinctContrasts = new Set(contrasts.map((c) => c.contrastTerm.id));
  const flag = (valence.positive > 0 && valence.negative > 0) || distinctContrasts.size >= 2;

  // Focus 内訳（集計用）
  const focusCounts = {};
  us.forEach((u) => { const f = u.focus || 'performance'; focusCounts[f] = (focusCounts[f] || 0) + 1; });

  // 発話一覧（新しい順）。表示名を付ける。
  const list = (await hydrate(us)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return {
    term, total: us.length, valence, byPerson: Object.values(byPerson),
    nearList, contrasts, flag, focusCounts, utterances: list,
  };
}

// --- バックアップ ------------------------------------------------------------

export async function exportAll() {
  const [terms, persons, sources, utterances] = await Promise.all([
    db.terms.toArray(), db.persons.toArray(), db.sources.toArray(), db.utterances.toArray(),
  ]);
  return { version: 2, exportedAt: nowISO(), terms, persons, sources, utterances };
}

export async function importAll(data) {
  if (!data || (data.version !== 1 && data.version !== 2)) throw new Error('対応していないバックアップ形式');
  // v1 バックアップは focus 等が無いので補完する（後方互換）。
  const utterances = (data.utterances || []).map((u) => ({
    ...u,
    focus: u.focus || 'performance',
    timestamp: u.timestamp || '',
    locationNote: u.locationNote || '',
  }));
  await db.transaction('rw', db.terms, db.persons, db.sources, db.utterances, async () => {
    await Promise.all([db.terms.clear(), db.persons.clear(), db.sources.clear(), db.utterances.clear()]);
    await db.terms.bulkAdd(data.terms || []);
    await db.persons.bulkAdd(data.persons || []);
    await db.sources.bulkAdd(data.sources || []);
    await db.utterances.bulkAdd(utterances);
  });
}

// 共通接頭の長さ（送り仮名違い「明るい/明るめ」を拾うため）
function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

// 入力補助: 「まとめる候補」になりうる既存Termを近い順に返す。
// 完全一致(正規化)・包含・共通接頭2文字以上 を候補にする。自動マージはしない。
export async function termSuggestions(text, limit = 6) {
  const key = normalize(text);
  if (!key) return [];
  const terms = await db.terms.toArray();
  const scored = terms.map((t) => {
    const score = Math.max(...t.normKeys.map((k) => {
      if (k === key) return 100;
      if (k.includes(key) || key.includes(k)) return 50 + Math.min(k.length, key.length);
      return sharedPrefix(k, key);
    }));
    return { t, score };
  }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.t);
}

export async function listPersons() { return db.persons.orderBy('name').toArray(); }
export async function listSources() { return db.sources.orderBy('label').toArray(); }

// 直近の発話から、使った順（重複なし）に Source/Person を返す。再利用の優先表示用。
async function recentByField(field, mapTable, limit) {
  const us = await db.utterances.orderBy('createdAt').reverse().limit(300).toArray();
  const order = [];
  const seen = new Set();
  for (const u of us) {
    const id = u[field];
    if (id && !seen.has(id)) { seen.add(id); order.push(id); if (order.length >= limit) break; }
  }
  const map = Object.fromEntries((await mapTable.toArray()).map((x) => [x.id, x]));
  return order.map((id) => map[id]).filter(Boolean);
}
export function recentSources(limit = 5) { return recentByField('sourceId', db.sources, limit); }
export function recentPersons(limit = 5) { return recentByField('personId', db.persons, limit); }
