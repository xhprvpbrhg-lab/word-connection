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
const FOCUSES = [
  ['performance', '演奏全体'], ['instrument', '楽器'], ['interpretation', '解釈'],
  ['recording', '録音'], ['acoustics', '空間'], ['moment', '瞬間'],
];
const focusLabel = Object.fromEntries(FOCUSES);
const ORIGINS = [
  ['direct', '自分の体感'], ['x', 'X'], ['youtube_comment', 'YTコメント'], ['other', 'その他'],
];
const originLabel = Object.fromEntries(ORIGINS);

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
  const [focus, setFocus] = useState('performance');
  const [person, setPerson] = useState('');
  const [personKind, setPersonKind] = useState('pianist');
  const [source, setSource] = useState('');
  const [sourceKind, setSourceKind] = useState('youtube');
  const [sourceRef, setSourceRef] = useState('');
  const [showContrast, setShowContrast] = useState(false);
  const [contrast, setContrast] = useState('');
  const [note, setNote] = useState('');
  const [via, setVia] = useState('direct');
  const [showLocation, setShowLocation] = useState(false);
  const [timestamp, setTimestamp] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [persons, setPersons] = useState([]);
  const [sources, setSources] = useState([]);
  const [recentSrc, setRecentSrc] = useState([]);
  const [recentPpl, setRecentPpl] = useState([]);
  const [saved, setSaved] = useState('');

  const reloadLists = () => {
    repo.listPersons().then(setPersons);
    repo.listSources().then(setSources);
    repo.recentSources(5).then(setRecentSrc);
    repo.recentPersons(5).then(setRecentPpl);
  };
  useEffect(reloadLists, []);

  useEffect(() => {
    let live = true;
    const t = term.trim();
    if (!t) { setSuggest([]); return; }
    repo.termSuggestions(t).then((s) => {
      if (!live) return;
      setSuggest(s.filter((x) => x.label !== t)); // 完全一致は自動同一視されるので除く
    });
    return () => { live = false; };
  }, [term]);

  // Focus = 瞬間 のときは場所・Timestamp欄を自動で開く
  useEffect(() => { if (focus === 'moment') setShowLocation(true); }, [focus]);

  const onTerm = (v) => { setTerm(v); setFileUnder(null); };

  // 既存Sourceを選んだら kind / ref を自動で紐づける
  const onSource = (v) => {
    setSource(v);
    const found = sources.find((s) => s.label === v);
    if (found) { setSourceKind(found.kind); setSourceRef(found.ref || ''); }
  };
  const pickSource = (s) => { setSource(s.label); setSourceKind(s.kind); setSourceRef(s.ref || ''); };
  const pickPerson = (p) => { setPerson(p.name); setPersonKind(p.kind); };

  // keepContext=true: source/person/origin/focus/timestamp/locationNote を維持し term/note/contrast だけ消す
  const doSave = async (keepContext) => {
    const label = term.trim();
    if (!label) return;
    let termLabel = label;
    if (fileUnder) {
      if (label !== fileUnder.label) await repo.addAlias(fileUnder.id, label);
      termLabel = fileUnder.label;
    }
    await repo.addUtterance({
      termLabel, valence, focus,
      personName: person.trim() || null, personKind,
      sourceLabel: source.trim() || null, sourceKind, sourceRef: sourceRef.trim(),
      contrastLabel: contrast.trim() || null,
      note: note.trim(), observedVia: via,
      timestamp, locationNote,
    });
    reloadLists();
    // term レベルのみクリア
    setTerm(''); setContrast(''); setNote(''); setShowContrast(false);
    setSuggest([]); setFileUnder(null);
    if (!keepContext) {
      // 通常保存: 瞬間的な文脈はゆるめる（source/person/origin は利便のため維持）
      setFocus('performance'); setTimestamp(''); setLocationNote(''); setShowLocation(false);
    }
    setSaved(keepContext ? 'next' : 'done');
    setTimeout(() => setSaved(''), 1400);
    onSaved && onSaved();
  };

  const locOpen = showLocation || focus === 'moment';

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

      <div class="sub">観察対象</div>
      <div class="focuses">
        ${FOCUSES.map(([k, l]) => html`
          <button class=${'fbtn' + (focus === k ? ' on' : '')} onClick=${() => setFocus(k)}>${l}</button>`)}
      </div>

      <div class="opt-row">
        <div class="opt">
          <label>誰が</label>
          <input list="persons" placeholder="任意" value=${person} onInput=${(e) => setPerson(e.target.value)} />
          <select value=${personKind} onChange=${(e) => setPersonKind(e.target.value)}>
            ${PERSON_KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
          </select>
        </div>
        ${recentPpl.length > 0 && html`
          <div class="recent-chips">
            <span class="rc-label">最近:</span>
            ${recentPpl.map((p) => html`
              <button class="chip ghost" onClick=${() => pickPerson(p)}>${p.name}</button>`)}
          </div>`}

        <div class="opt">
          <label>何について</label>
          <input list="sources" placeholder="任意" value=${source} onInput=${(e) => onSource(e.target.value)} />
          <select value=${sourceKind} onChange=${(e) => setSourceKind(e.target.value)}>
            ${SOURCE_KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
          </select>
        </div>
        ${recentSrc.length > 0 && html`
          <div class="recent-chips">
            <span class="rc-label">最近:</span>
            ${recentSrc.map((s) => html`
              <button class="chip ghost" onClick=${() => pickSource(s)}>${s.label}</button>`)}
          </div>`}
        ${source.trim() && html`
          <input class="ref" placeholder="URL / 製番など（任意）" value=${sourceRef}
            onInput=${(e) => setSourceRef(e.target.value)} />`}
      </div>

      ${focus === 'moment'
        ? html`<div class="sub loc-cue">瞬間：場所・Timestampを指定</div>`
        : html`<button class="disclose" onClick=${() => setShowLocation(!showLocation)}>
            ◎ 場所・Timestampを指定（任意）${showLocation ? '▲' : '▼'}</button>`}
      ${locOpen && html`
        <div class="loc">
          <input class="ts" placeholder="Timestamp 例 2:14" value=${timestamp}
            onInput=${(e) => setTimestamp(e.target.value)} />
          <input class="locnote" placeholder="場所メモ 例 ppの入り" value=${locationNote}
            onInput=${(e) => setLocationNote(e.target.value)} />
        </div>`}

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
          ${ORIGINS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
        </select>
        <button class="save" disabled=${!term.trim()} onClick=${() => doSave(false)}>
          ${saved === 'done' ? '✓ 記録した' : '記録する'}
        </button>
      </div>
      <button class="save-next" disabled=${!term.trim()} onClick=${() => doSave(true)}>
        ${saved === 'next' ? '✓ 次へ（文脈を保持）' : '保存して次の言葉 ↻'}
      </button>

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
            <span class="ftag">${focusLabel[u.focus || 'performance']}</span>
            <span class="meta">
              ${[u.source && u.source.label, u.person && u.person.name].filter(Boolean).join(' ・ ')}
              ${u.timestamp ? ` @${u.timestamp}` : ''}
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

      <div class="sec-title">Focus内訳</div>
      <div class="focus-counts">
        ${FOCUSES.filter(([k]) => d.focusCounts[k]).map(([k, l]) => html`
          <span class="fc"><span class="fc-l">${l}</span> <span class="fc-n">${d.focusCounts[k]}</span></span>`)}
      </div>

      <div class="sec-title">発話の記録 (${d.total})</div>
      <div class="ulist">
        ${d.utterances.map((u) => html`
          <div class="urow">
            <span class=${'vm ' + vCls[u.valence]}>${vMark[u.valence]}</span>
            <span class="ftag">${focusLabel[u.focus || 'performance']}</span>
            ${u.timestamp && html`<span class="uts">@${u.timestamp}</span>`}
            ${u.locationNote && html`<span class="uloc">${u.locationNote}</span>`}
            <span class="umeta">
              ${[u.source && u.source.label, u.person && u.person.name, originLabel[u.observedVia]].filter(Boolean).join(' ・ ')}
            </span>
          </div>`)}
      </div>
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
