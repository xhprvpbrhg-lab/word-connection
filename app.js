import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
import * as repo from './db.js';
import { fetchSourceMetadata, detectProvider, fetchPersonMetadata, extractXUsername } from './metadata.js';

const html = htm.bind(h);

// 良し悪し（残り方）。世界観に合わせ観察的な言葉で。内部キーは従来どおり。
const VALENCES = [
  { key: 'positive', label: 'ここちよい', cls: 'v-pos' },
  { key: 'neutral', label: 'ふつう', cls: 'v-neu' },
  { key: 'negative', label: 'ひっかかる', cls: 'v-neg' },
];
const vCls = { positive: 'v-pos', neutral: 'v-neu', negative: 'v-neg' };
const vWord = { positive: 'ここちよい', neutral: 'ふつう', negative: 'ひっかかる' };

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

const TERM_PLACEHOLDERS = ['白い霧', '張りつめた', '湿度', '呼吸', '冷たい光', '古木', '遠い灯'];
const pickPlaceholder = () => TERM_PLACEHOLDERS[Math.floor(Math.random() * TERM_PLACEHOLDERS.length)];

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
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const m = hash.match(/^#\/term\/(.+)$/);
  return html`
    <div class="app">
      <header class="topbar">
        <div class="brand" onClick=${() => go('#/')}>
          <span class="brand-name">聴景</span>
          <span class="brand-sub">音の観察ノート</span>
        </div>
        <${BackupMenu} onChange=${refresh} />
      </header>
      ${m
        ? html`<${TermDetail} termId=${decodeURIComponent(m[1])} key=${m[1] + tick} />`
        : html`<${Home} tick=${tick} onSaved=${refresh} />`}
    </div>`;
}

function Home({ tick, onSaved }) {
  return html`
    <${NoteInput} onSaved=${onSaved} />
    <${ObservationLog} tick=${tick} />
    <${TermCloud} tick=${tick} />`;
}

// --- 入力（ノートに書き込む感覚） --------------------------------------------
function NoteInput({ onSaved }) {
  const [term, setTerm] = useState('');
  const [valence, setValence] = useState('positive');
  const [suggest, setSuggest] = useState([]);
  const [fileUnder, setFileUnder] = useState(null);
  const [focus, setFocus] = useState('performance');
  const [person, setPerson] = useState('');
  const [personKind, setPersonKind] = useState('pianist');
  const [personUrl, setPersonUrl] = useState('');
  const [personProvider, setPersonProvider] = useState('manual');
  const [personAuto, setPersonAuto] = useState(''); // 自動入力した名前（手入力と区別して置換判定）
  const [personMetaStatus, setPersonMetaStatus] = useState(''); // '' | 'loading' | 'error'
  const [source, setSource] = useState('');
  const [sourceKind, setSourceKind] = useState('youtube');
  const [sourceRef, setSourceRef] = useState('');
  const [via, setVia] = useState('direct');
  const [contrast, setContrast] = useState('');
  const [note, setNote] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [showPerson, setShowPerson] = useState(false);
  const [showContrast, setShowContrast] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [persons, setPersons] = useState([]);
  const [sources, setSources] = useState([]);
  const [recentSrc, setRecentSrc] = useState([]);
  const [recentPpl, setRecentPpl] = useState([]);
  const [metaStatus, setMetaStatus] = useState(''); // '' | 'loading' | 'error'
  const [saved, setSaved] = useState('');
  const [ripple, setRipple] = useState(false);
  const [ph] = useState(pickPlaceholder);

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
      setSuggest(s.filter((x) => x.label !== t));
    });
    return () => { live = false; };
  }, [term]);

  useEffect(() => { if (focus === 'moment') setShowLocation(true); }, [focus]);

  // Source URL欄に対応URLが入ったら、Source名が空のときだけタイトルを自動取得（補助機能）。
  // 手入力があれば上書きしない。失敗しても保存は妨げない。
  useEffect(() => {
    const url = sourceRef.trim();
    if (!url || source.trim() || !detectProvider(url)) { setMetaStatus(''); return; }
    let live = true;
    setMetaStatus('loading');
    const timer = setTimeout(async () => {
      const meta = await fetchSourceMetadata(url);
      if (!live) return;
      if (meta && meta.title) {
        setSource((prev) => (prev.trim() ? prev : meta.title)); // 取得中に手入力されていたら尊重
        if (meta.provider === 'youtube') setSourceKind('youtube');
        setMetaStatus('');
      } else {
        setMetaStatus('error');
      }
    }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [sourceRef, source]);

  // Person URL欄に X プロフィールURLが入ったら、Person名が空のとき @username を仮入力し、
  // 可能なら表示名に置換する。手入力があれば上書きしない。失敗は @username のまま。
  useEffect(() => {
    const url = personUrl.trim();
    const username = extractXUsername(url);
    if (!url || !username) { setPersonMetaStatus(''); return; }
    setPersonProvider('x');
    // 1) name が空なら即座に @username（手入力は尊重）
    let auto = '';
    if (!person.trim()) {
      auto = `@${username}`;
      setPerson(auto);
      setPersonAuto(auto);
    } else if (person === personAuto) {
      auto = person; // すでに自動入力済み。置換対象。
    } else {
      return; // 手入力済み → 何もしない
    }
    let live = true;
    setPersonMetaStatus('loading');
    const timer = setTimeout(async () => {
      const meta = await fetchPersonMetadata(url);
      if (!live) return;
      setPersonMetaStatus('');
      if (meta && meta.name) {
        // 取得中に手入力で変えられていなければ表示名へ置換
        setPerson((prev) => (prev === auto || prev === `@${username}` ? meta.name : prev));
        setPersonAuto((prev) => (prev === auto || prev === `@${username}` ? meta.name : prev));
      }
    }, 500);
    return () => { live = false; clearTimeout(timer); };
  }, [personUrl, person]);

  const onTerm = (v) => { setTerm(v); setFileUnder(null); };
  const onSource = (v) => {
    setSource(v);
    const found = sources.find((s) => s.label === v);
    if (found) { setSourceKind(found.kind); setSourceRef(found.ref || ''); }
  };
  const pickSource = (s) => { setSource(s.label); setSourceKind(s.kind); setSourceRef(s.ref || ''); setShowSource(true); };
  const pickPerson = (p) => {
    setPerson(p.name); setPersonKind(p.kind);
    setPersonUrl(p.url || ''); setPersonProvider(p.provider || 'manual'); setPersonAuto(''); setShowPerson(true);
  };
  // Person名を手入力したら、自動入力マーカーを解除（X URLが無ければ provider も manual に）
  const onPersonName = (v) => {
    setPerson(v);
    if (v !== personAuto) { setPersonAuto(''); if (!extractXUsername(personUrl)) setPersonProvider('manual'); }
  };

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
      personUrl: personUrl.trim(), personProvider,
      sourceLabel: source.trim() || null, sourceKind, sourceRef: sourceRef.trim(),
      contrastLabel: contrast.trim() || null,
      note: note.trim(), observedVia: via,
      timestamp, locationNote,
    });
    reloadLists();
    setRipple(true); setTimeout(() => setRipple(false), 500);
    setTerm(''); setContrast(''); setNote(''); setShowContrast(false);
    setSuggest([]); setFileUnder(null);
    if (!keepContext) {
      setFocus('performance'); setTimestamp(''); setLocationNote(''); setShowLocation(false);
    }
    setSaved(keepContext ? 'next' : 'done');
    setTimeout(() => setSaved(''), 1500);
    onSaved && onSaved();
  };

  const locOpen = showLocation || focus === 'moment';
  const ctx = [source.trim(), person.trim()].filter(Boolean).join(' ・ ');

  return html`
    <section class=${'note' + (ripple ? ' rippling' : '')}>
      <div class="field-label">今日残った景色</div>
      <input class="term-write" placeholder=${ph} value=${term}
        onInput=${(e) => onTerm(e.target.value)} />

      ${fileUnder
        ? html`
          <div class="merge-hint">
            <span>→ <b>${fileUnder.label}</b> にまとめます</span>
            <button class="undo" onClick=${() => setFileUnder(null)}>解除</button>
          </div>`
        : suggest.length > 0 && html`
          <div class="suggests">
            <span class="sg-label">まとめる</span>
            ${suggest.map((s) => html`
              <button class="chip" onClick=${() => setFileUnder(s)}>${s.label}</button>`)}
          </div>`}

      <div class="valence">
        ${VALENCES.map((v) => html`
          <button class=${'vchip ' + v.cls + (valence === v.key ? ' on' : '')}
            onClick=${() => setValence(v.key)}>
            <span class="vdot"></span>${v.label}
          </button>`)}
      </div>

      <div class="field-label soft">何を聴いていたか</div>
      <div class="focuses">
        ${FOCUSES.map(([k, l]) => html`
          <button class=${'chip focus' + (focus === k ? ' on' : '')} onClick=${() => setFocus(k)}>${l}</button>`)}
      </div>

      ${focus === 'moment'
        ? html`<div class="field-label soft loc-cue">どこで残ったか</div>`
        : html`<button class="fold" onClick=${() => setShowLocation(!showLocation)}>
            どこで残ったか${showLocation ? '　−' : '　＋'}</button>`}
      ${locOpen && html`
        <div class="loc reveal">
          <input class="line-in ts" placeholder="2:14 など" value=${timestamp}
            onInput=${(e) => setTimestamp(e.target.value)} />
          <input class="line-in" placeholder="ppの入り / 再現部 など" value=${locationNote}
            onInput=${(e) => setLocationNote(e.target.value)} />
        </div>`}

      <button class="fold" onClick=${() => setShowSource(!showSource)}>
        何を聴いたか${source.trim() ? `　— ${source.trim()}` : ''}${showSource ? '　−' : '　＋'}</button>
      ${showSource && html`
        <div class="reveal">
          <input class="line-in" list="sources" placeholder="動画 / ピアノ / 録音 …"
            value=${source} onInput=${(e) => onSource(e.target.value)} />
          <input class="line-in" placeholder="YouTube URL / 製番（任意）" value=${sourceRef}
            onInput=${(e) => setSourceRef(e.target.value)} />
          ${metaStatus === 'loading' && html`<div class="meta-status">タイトル取得中…</div>`}
          ${metaStatus === 'error' && html`<div class="meta-status err">取得できませんでした</div>`}
          <div class="mini-row">
            <select value=${sourceKind} onChange=${(e) => setSourceKind(e.target.value)}>
              ${SOURCE_KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
            <select value=${via} onChange=${(e) => setVia(e.target.value)}>
              ${ORIGINS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
          </div>
          ${recentSrc.length > 0 && html`
            <div class="suggests">
              <span class="sg-label">最近</span>
              ${recentSrc.map((s) => html`<button class="chip" onClick=${() => pickSource(s)}>${s.label}</button>`)}
            </div>`}
        </div>`}

      <button class="fold" onClick=${() => setShowPerson(!showPerson)}>
        誰の視点か${person.trim() ? `　— ${person.trim()}` : ''}${showPerson ? '　−' : '　＋'}</button>
      ${showPerson && html`
        <div class="reveal">
          <input class="line-in" list="persons" placeholder="自分 / ピアニスト名 / コメント主 …"
            value=${person} onInput=${(e) => onPersonName(e.target.value)} />
          <input class="line-in" placeholder="X プロフィールURL（任意）" value=${personUrl}
            onInput=${(e) => setPersonUrl(e.target.value)} />
          ${personMetaStatus === 'loading' && html`<div class="meta-status">表示名を取得中…</div>`}
          ${personMetaStatus === 'error' && html`<div class="meta-status err">取得できませんでした</div>`}
          <div class="mini-row">
            <select value=${personKind} onChange=${(e) => setPersonKind(e.target.value)}>
              ${PERSON_KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
          </div>
          ${recentPpl.length > 0 && html`
            <div class="suggests">
              <span class="sg-label">最近</span>
              ${recentPpl.map((p) => html`
                <button class="chip" onClick=${() => pickPerson(p)} title=${p.url || ''}>
                  ${p.name}${p.url ? html`<span class="chip-sub">@${p.url.replace(/\/+$/, '').split('/').pop()}</span>` : ''}
                </button>`)}
            </div>`}
        </div>`}

      <button class="fold" onClick=${() => setShowContrast(!showContrast)}>
        対になる景色${showContrast ? '　−' : '　＋'}</button>
      ${showContrast && html`
        <input class="line-in reveal" placeholder="強いて言えば反対は… こもった / キンキン"
          value=${contrast} onInput=${(e) => setContrast(e.target.value)} />`}

      <textarea class="note-write" placeholder="余白に書き添える（任意）" value=${note}
        onInput=${(e) => setNote(e.target.value)}></textarea>

      ${ctx && html`<div class="ctx-hint">${ctx}</div>`}

      <button class=${'save' + (saved === 'done' ? ' ok' : '')} disabled=${!term.trim()}
        onClick=${() => doSave(false)}>${saved === 'done' ? '残しました' : '景色を残す'}</button>
      <button class=${'save-next' + (saved === 'next' ? ' ok' : '')} disabled=${!term.trim()}
        onClick=${() => doSave(true)}>${saved === 'next' ? '次の景色へ…' : '次の景色へ'}</button>

      <datalist id="persons">${persons.map((p) => html`<option value=${p.name} />`)}</datalist>
      <datalist id="sources">${sources.map((s) => html`<option value=${s.label} />`)}</datalist>
    </section>`;
}

// --- 観察ログ（景色カード） --------------------------------------------------
function ObservationLog({ tick }) {
  const [items, setItems] = useState([]);
  useEffect(() => { repo.recentUtterances(12).then(setItems); }, [tick]);
  if (!items.length) return null;
  return html`
    <section class="section">
      <div class="section-head">観察ログ</div>
      <div class="cards">
        ${items.map((u) => html`
          <a class="scene-card" href=${'#/term/' + encodeURIComponent(u.termId)}>
            <div class="sc-term">
              <span class=${'vdot ' + vCls[u.valence]}></span>
              ${u.term ? u.term.label : '—'}
              ${u.contrastTerm ? html`<span class="sc-contrast">／ ${u.contrastTerm.label}</span>` : ''}
            </div>
            <div class="sc-meta">
              <span class="sc-focus">${focusLabel[u.focus || 'performance']}</span>
              ${[u.source && u.source.label, u.person && u.person.name].filter(Boolean).map((x) => html`<span>${x}</span>`)}
              ${u.timestamp ? html`<span>${u.timestamp}</span>` : ''}
              ${u.locationNote ? html`<span>${u.locationNote}</span>` : ''}
            </div>
            ${u.note ? html`<div class="sc-note">${u.note}</div>` : ''}
          </a>`)}
      </div>
    </section>`;
}

// --- ことばの景色（タグクラウド的ナビ） --------------------------------------
function TermCloud({ tick }) {
  const [terms, setTerms] = useState([]);
  useEffect(() => { repo.allTermsWithCounts().then(setTerms); }, [tick]);
  if (!terms.length) return null;
  const max = Math.max(...terms.map((t) => t.count), 1);
  return html`
    <section class="section">
      <div class="section-head">ことば（${terms.length}）</div>
      <div class="cloud">
        ${terms.map((t) => html`
          <a class="cloud-term" href=${'#/term/' + encodeURIComponent(t.id)}
            style=${`font-size:${(0.95 + (t.count / max) * 0.85).toFixed(2)}rem`}>${t.label}</a>`)}
      </div>
    </section>`;
}

// --- 詳細（観察ノート） ------------------------------------------------------
function TermDetail({ termId }) {
  const [d, setD] = useState(null);
  useEffect(() => { repo.termDetail(termId).then(setD); }, [termId]);
  if (!d) return html`<div class="section">…</div>`;

  const total = d.valence.positive + d.valence.neutral + d.valence.negative;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const cloudMax = Math.max(...d.nearList.map((n) => n.weight), 1);

  return html`
    <div class="detail">
      <button class="back" onClick=${() => go('#/')}>← もどる</button>

      <div class="d-hero">
        <div class="d-term">${d.term.label}</div>
        <div class="d-count">${d.total} の観察</div>
        ${d.term.aliases.length > 0 && html`<div class="d-aliases">${d.term.aliases.join('・')}</div>`}
      </div>

      <div class="vbar">
        <div class="seg v-pos" style=${`flex:${pct(d.valence.positive)}`}></div>
        <div class="seg v-neu" style=${`flex:${pct(d.valence.neutral)}`}></div>
        <div class="seg v-neg" style=${`flex:${pct(d.valence.negative)}`}></div>
      </div>
      <div class="vleg">
        <span><i class="vdot v-pos"></i>${vWord.positive} ${d.valence.positive}</span>
        <span><i class="vdot v-neu"></i>${vWord.neutral} ${d.valence.neutral}</span>
        <span><i class="vdot v-neg"></i>${vWord.negative} ${d.valence.negative}</span>
      </div>

      ${d.flag && html`
        <div class="murmur">人によって、見える景色が違うようです</div>`}

      ${d.nearList.length > 0 && html`
        <div class="section-head q">よく一緒に現れる景色</div>
        <div class="cloud">
          ${d.nearList.map((n) => html`
            <a class="cloud-term" href=${'#/term/' + encodeURIComponent(n.term.id)}
              style=${`font-size:${(0.95 + (n.weight / cloudMax) * 0.7).toFixed(2)}rem`}>${n.term.label}</a>`)}
        </div>`}

      ${d.contrasts.length > 0 && html`
        <div class="section-head q">対になる景色</div>
        <div class="contrasts">
          ${d.contrasts.map((c) => html`
            <div class="con">
              <div class="con-pair">
                <span class="con-l">${d.term.label}</span>
                <span class="con-arrow">←→</span>
                <a class="con-r" href=${'#/term/' + encodeURIComponent(c.contrastTerm.id)}>${c.contrastTerm.label}</a>
              </div>
              ${c.person && html`<div class="con-who">${c.person.name}</div>`}
            </div>`)}
        </div>`}

      <div class="section-head q">何を聴いていたか</div>
      <div class="cloud">
        ${FOCUSES.filter(([k]) => d.focusCounts[k]).map(([k, l]) => html`
          <span class="fc">${l}<span class="fc-n">${d.focusCounts[k]}</span></span>`)}
      </div>

      <div class="section-head q">観察ログ</div>
      <div class="cards">
        ${d.utterances.map((u) => html`
          <div class="scene-card flat">
            <div class="sc-meta">
              <span class=${'vdot ' + vCls[u.valence]}></span>
              <span class="sc-focus">${focusLabel[u.focus || 'performance']}</span>
              ${u.timestamp ? html`<span>${u.timestamp}</span>` : ''}
              ${u.locationNote ? html`<span>${u.locationNote}</span>` : ''}
              ${u.source && u.source.label ? html`<span>${u.source.label}</span>` : ''}
              ${u.person && (u.person.url
                ? html`<a class="p-link" href=${u.person.url} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}>${u.person.name}</a>`
                : html`<span>${u.person.name}</span>`)}
              <span>${originLabel[u.observedVia]}</span>
            </div>
            ${u.note ? html`<div class="sc-note">${u.note}</div>` : ''}
          </div>`)}
      </div>
    </div>`;
}

// --- バックアップ ------------------------------------------------------------
function BackupMenu({ onChange }) {
  const exportJson = async () => {
    const data = await repo.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chokei-${new Date().toISOString().slice(0, 10)}.json`;
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
      <button onClick=${exportJson} aria-label="書き出し" title="書き出し">⤓</button>
      <label class="imp" aria-label="読み込み" title="読み込み">⤒
        <input type="file" accept="application/json" onChange=${importJson} hidden />
      </label>
    </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
