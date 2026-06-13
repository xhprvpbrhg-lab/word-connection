import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
import * as repo from './db.js';

const html = htm.bind(h);

const VALENCES = [
  { key: 'positive', label: 'ポジ ＋', cls: 'v-pos' },
  { key: 'neutral', label: '中立', cls: 'v-neu' },
  { key: 'negative', label: 'ネガ −', cls: 'v-neg' },
];
const vMark = { positive: '＋', neutral: '○', negative: '−' };
const vCls = { positive: 'v-pos', neutral: 'v-neu', negative: 'v-neg' };

const SOURCE_KINDS = [
  ['youtube', 'YouTube'], ['piano', 'ピアノ'], ['recording', '録音'], ['venue', '会場'], ['other', 'その他'],
];
const PERSON_KINDS = [
  ['self', '自分'], ['pianist', 'ピアニスト'], ['commenter', 'コメント主'], ['other', 'その他'],
];

// --- ルーティング（ハッシュ） ----------------------------------------------
function useHashRoute() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}
const go = (h) => { location.hash = h; };

// --- アプリ ------------------------------------------------------------------
function App() {
  const hash = useHashRoute();
  const [tick, setTick] = useState(0); // 保存後の再描画トリガ
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const m = hash.match(/^#\/term\/(.+)$/);
  return html`
    <div class="app">
      <header class="topbar">
        <h1 onClick=${() => go('#/')}>音色のことば</h1>
        <${BackupMenu} onChange=${refresh} />
      </header>
      ${m
        ? html`<${TermDetail} termId=${decodeURIComponent(m[1])} key=${m[1] + tick} />`
        : html`<${Home} tick=${tick} onSaved=${refresh} />`}
    </div>`;
}

// --- ホーム（クイック入力 + 最近 + 言葉一覧） --------------------------------
function Home({ tick, onSaved }) {
  return html`
    <${QuickInput} onSaved=${onSaved} />
    <${RecentList} tick=${tick} />
    <${TermList} tick=${tick} />`;
}

// --- クイック入力 ------------------------------------------------------------
function QuickInput({ onSaved }) {
  const [term, setTerm] = useState('');
  const [valence, setValence] = useState('positive');
  const [suggest, setSuggest] = useState([]);
  const [fileUnder, setFileUnder] = useState(null); // 人が確定した「まとめ先」既存Term
  const [person, setPerson] = useState('');
  const [personKind, setPersonKind] = useState('pianist');
  const [source, setSource] = useState('');
  const [sourceKind, setSourceKind] = useState('youtube');
  const [sourceRef, setSourceRef] = useState('');
  const [showContrast, setShowContrast] = useState(false);
  const [contrast, setContrast] = useState('');
  const [note, setNote] = useState('');
  const [via, setVia] = useState('direct');
  const [persons, setPersons] = useState([]);
  const [sources, setSources] = useState([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    repo.listPersons().then(setPersons);
    repo.listSources().then(setSources);
  }, []);

  useEffect(() => {
    let live = true;
    const t = term.trim();
    if (!t) { setSuggest([]); return; }
    repo.termSuggestions(t).then((s) => {
      if (!live) return;
      // 完全一致は getOrCreateTerm が自動で同一視するので候補から除く
      setSuggest(s.filter((x) => x.label !== t));
    });
    return () => { live = false; };
  }, [term]);

  // 言葉を打ち直したら、まとめ先の確定は解除
  const onTerm = (v) => { setTerm(v); setFileUnder(null); };

  const reset = () => {
    setTerm(''); setContrast(''); setNote(''); setShowContrast(false);
    setSuggest([]); setFileUnder(null);
  };

  const save = async () => {
    const label = term.trim();
    if (!label) return;
    // まとめ先を人が確定した場合は、打った表記を alias 化してから既存の label を使う
    let termLabel = label;
    if (fileUnder) {
      if (label !== fileUnder.label) await repo.addAlias(fileUnder.id, label);
      termLabel = fileUnder.label;
    }
    await repo.addUtterance({
      termLabel, valence,
      personName: person.trim() || null, personKind,
      sourceLabel: source.trim() || null, sourceKind, sourceRef: sourceRef.trim(),
      contrastLabel: contrast.trim() || null,
      note: note.trim(), observedVia: via,
    });
    reset();
    repo.listPersons().then(setPersons);
    repo.listSources().then(setSources);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
    onSaved && onSaved();
  };

  return html`
    <section class="card qi">
      <div class="qi-head"><span class="bolt">⚡</span> クイック入力</div>

      <input class="term-in" placeholder="言葉を入力… 例: 明るい" value=${term}
        onInput=${(e) => onTerm(e.target.value)} />

      ${fileUnder
        ? html`
          <div class="merge-hint">
            → <b>${fileUnder.label}</b> にまとめます
            <button class="undo" onClick=${() => setFileUnder(null)}>解除</button>
          </div>`
        : suggest.length > 0 && html`
          <div class="suggests">
            <span class="sg-label">まとめる候補:</span>
            ${suggest.map((s) => html`
              <button class="chip ghost" onClick=${() => setFileUnder(s)}>${s.label} にまとめる</button>`)}
          </div>`}

      <div class="valence">
        ${VALENCES.map((v) => html`
          <button class=${'vbtn ' + v.cls + (valence === v.key ? ' on' : '')}
            onClick=${() => setValence(v.key)}>${v.label}</button>`)}
      </div>

      <div class="opt-row">
        <div class="opt">
          <label>誰が</label>
          <input list="persons" placeholder="任意" value=${person} onInput=${(e) => setPerson(e.target.value)} />
          <select value=${personKind} onChange=${(e) => setPersonKind(e.target.value)}>
            ${PERSON_KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
          </select>
        </div>
        <div class="opt">
          <label>何について</label>
          <input list="sources" placeholder="任意" value=${source} onInput=${(e) => setSource(e.target.value)} />
          <select value=${sourceKind} onChange=${(e) => setSourceKind(e.target.value)}>
            ${SOURCE_KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
          </select>
        </div>
        ${source.trim() && html`
          <input class="ref" placeholder="URL / 製番など（任意）" value=${sourceRef}
            onInput=${(e) => setSourceRef(e.target.value)} />`}
      </div>

      <button class="disclose" onClick=${() => setShowContrast(!showContrast)}>
        ⇄ 対比（任意）— 強いて言えば反対は？ ${showContrast ? '▲' : '▼'}
      </button>
      ${showContrast && html`
        <input class="ref" placeholder="例: こもった / キンキン" value=${contrast}
          onInput=${(e) => setContrast(e.target.value)} />`}

      <textarea class="note" placeholder="メモ・引用（任意）" value=${note}
        onInput=${(e) => setNote(e.target.value)}></textarea>

      <div class="qi-foot">
        <select class="via" value=${via} onChange=${(e) => setVia(e.target.value)}>
          <option value="direct">自分の体感</option>
          <option value="x">X</option>
          <option value="youtube_comment">YTコメント</option>
          <option value="other">その他</option>
        </select>
        <button class="save" disabled=${!term.trim()} onClick=${save}>
          ${saved ? '✓ 記録した' : '記録する'}
        </button>
      </div>

      <datalist id="persons">${persons.map((p) => html`<option value=${p.name} />`)}</datalist>
      <datalist id="sources">${sources.map((s) => html`<option value=${s.label} />`)}</datalist>
    </section>`;
}

// --- 最近の記録 --------------------------------------------------------------
function RecentList({ tick }) {
  const [items, setItems] = useState([]);
  useEffect(() => { repo.recentUtterances(8).then(setItems); }, [tick]);
  if (!items.length) return null;
  return html`
    <section class="card">
      <div class="sec-title">最近の記録</div>
      <div class="recent">
        ${items.map((u) => html`
          <div class="rec">
            <span class=${'vm ' + vCls[u.valence]}>${vMark[u.valence]}</span>
            <a href=${'#/term/' + encodeURIComponent(u.termId)}>${u.term ? u.term.label : '—'}</a>
            <span class="meta">
              ${[u.person && u.person.name, u.source && u.source.label].filter(Boolean).join(' ・ ')}
              ${u.contrastTerm ? ` ⇄ ${u.contrastTerm.label}` : ''}
            </span>
          </div>`)}
      </div>
    </section>`;
}

// --- 言葉一覧 ----------------------------------------------------------------
function TermList({ tick }) {
  const [terms, setTerms] = useState([]);
  useEffect(() => { repo.allTermsWithCounts().then(setTerms); }, [tick]);
  if (!terms.length) return null;
  return html`
    <section class="card">
      <div class="sec-title">言葉 (${terms.length})</div>
      <div class="termlist">
        ${terms.map((t) => html`
          <a class="chip" href=${'#/term/' + encodeURIComponent(t.id)}>
            ${t.label} <span class="cnt">${t.count}</span>
          </a>`)}
      </div>
    </section>`;
}

// --- 言葉詳細 ----------------------------------------------------------------
function TermDetail({ termId }) {
  const [d, setD] = useState(null);
  useEffect(() => { repo.termDetail(termId).then(setD); }, [termId]);
  if (!d) return html`<div class="card">読み込み中…</div>`;

  const total = d.valence.positive + d.valence.neutral + d.valence.negative;
  const pct = (n) => (total ? (n / total) * 100 : 0);

  return html`
    <div class="detail">
      <button class="back" onClick=${() => go('#/')}>← もどる</button>
      <div class="d-title">
        <span class="d-label">${d.term.label}</span>
        <span class="d-count">${d.total}件の発話</span>
      </div>
      ${d.term.aliases.length > 0 && html`
        <div class="aliases">表記ゆれ: ${d.term.aliases.join('、')}</div>`}

      <div class="sec-title">良し悪しの内訳</div>
      <div class="vbar">
        <div class="seg v-pos" style=${`flex:${pct(d.valence.positive)}`}></div>
        <div class="seg v-neu" style=${`flex:${pct(d.valence.neutral)}`}></div>
        <div class="seg v-neg" style=${`flex:${pct(d.valence.negative)}`}></div>
      </div>
      <div class="vleg">
        <span><i class="dot v-pos"></i>ポジ ${d.valence.positive}</span>
        <span><i class="dot v-neu"></i>中立 ${d.valence.neutral}</span>
        <span><i class="dot v-neg"></i>ネガ ${d.valence.negative}</span>
      </div>

      ${d.flag && html`
        <div class="flag">人によって指すもの・評価が割れているかも</div>`}

      <div class="sec-title">誰が使ったか</div>
      <div class="who">
        ${d.byPerson.length === 0 && html`<div class="muted">（記録なし）</div>`}
        ${d.byPerson.map((p) => html`
          <div class="who-row">
            <span>${p.person ? p.person.name : '（人物なし）'}</span>
            <span class="who-v">
              ${p.positive ? html`<span class="v-pos">ポジ×${p.positive}</span>` : ''}
              ${p.neutral ? html`<span class="v-neu">中立×${p.neutral}</span>` : ''}
              ${p.negative ? html`<span class="v-neg">ネガ×${p.negative}</span>` : ''}
            </span>
          </div>`)}
      </div>

      ${d.nearList.length > 0 && html`
        <div class="sec-title">≒ よく一緒に使われる言葉</div>
        <div class="termlist">
          ${d.nearList.map((n) => html`
            <a class="chip" href=${'#/term/' + encodeURIComponent(n.term.id)}>
              ${n.term.label} <span class="cnt">${n.weight}</span></a>`)}
        </div>`}

      ${d.contrasts.length > 0 && html`
        <div class="sec-title">⇄ 反対に置かれた言葉（人ごと）</div>
        <div class="contrasts">
          ${d.contrasts.map((c) => html`
            <div class="con-row">
              <span class="muted">${c.person ? c.person.name : '不明'}:</span>
              ${d.term.label} ⇄ <a href=${'#/term/' + encodeURIComponent(c.contrastTerm.id)}>${c.contrastTerm.label}</a>
            </div>`)}
        </div>`}
    </div>`;
}

// --- バックアップ（エクスポート/インポート） --------------------------------
function BackupMenu({ onChange }) {
  const exportJson = async () => {
    const data = await repo.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tone-vocab-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        await repo.importAll(JSON.parse(r.result));
        onChange && onChange();
        alert('読み込みました');
      } catch (err) { alert('読み込み失敗: ' + err.message); }
    };
    r.readAsText(file);
  };
  return html`
    <div class="backup">
      <button onClick=${exportJson} title="バックアップ書き出し">⤓</button>
      <label class="imp" title="バックアップ読み込み">⤒
        <input type="file" accept="application/json" onChange=${importJson} hidden />
      </label>
    </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
