# データスキーマ（MVP）

[CONCEPT.md](CONCEPT.md) の設計を実装可能なデータ定義に落としたもの。
最小単位は **発話（Utterance）**。言葉どうしの関係は基本「発話から導出」する。

---

## 全体像（ER）

```
Person ──┐
         ├──< Utterance >── Term （termId：その発話で使われた言葉）
Source ──┘        │
                  └──────── Term （contrastTermId：任意。その時の反対極）

TermRelation … Utterance 群から導出される（≒近い / ⇄対）。実体は持たず計算 or キャッシュ。
```

- 1つの **Utterance** は、必ず 1つの **Term** を指す（`termId`）。
- `personId` `sourceId` `contrastTermId` は **すべて任意**（クイック入力で省略可）。
- ID は文字列（ULID 推奨：時系列ソート可・衝突しにくい）。日時は ISO 8601 文字列。

---

## 1. Term（言葉）

音色を表す語・フレーズ。表記ゆれ・活用は `aliases` に吸収して**1ノードにまとめる**。

| field | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | ULID |
| `label` | string | ✓ | 代表表記。例: `"明るい"` |
| `aliases` | string[] | | 表記/活用ゆれ。例: `["明るめ","明るさ"]` |
| `note` | string | | 自由メモ |
| `createdAt` | string | ✓ | ISO 8601 |

> **正規化**: 入力時は `label` と全 `aliases` を照合キーにして既存 Term を探す。
> 照合は「全角半角・送り仮名・末尾活用」を吸収した正規化文字列で行う（実装メモ参照）。

---

## 2. Person（人）

発話の主。視点の持ち主。

| field | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | ULID |
| `name` | string | ✓ | 表示名。例: `"田中さん"` |
| `kind` | enum | ✓ | `self` / `pianist` / `commenter` / `other` |
| `handle` | string | | X等のアカウント（任意） |
| `note` | string | | 傾向メモなど |
| `createdAt` | string | ✓ | ISO 8601 |

> `self`（自分）は初期データとして1件用意しておく。

---

## 3. Source（源）

言葉が向けられた対象。多様な対象を1つの抽象で包括する。

| field | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | ULID |
| `kind` | enum | ✓ | `piano` / `youtube` / `recording` / `venue` / `other` |
| `label` | string | ✓ | 表示名。例: `"YT音源 #41"` / `"SK-EX 製番12345"` |
| `ref` | string | | URL や製番など一意参照。例: YouTube URL |
| `meta` | object | | 任意の付加情報（`model`,`serial` 等の自由キー） |
| `note` | string | | |
| `createdAt` | string | ✓ | ISO 8601 |

---

## 4. Utterance（発話）★中心

「〔誰が〕〔何について〕〔どの言葉で〕〔良し悪し〕表現した」の1件。

| field | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | ULID |
| `termId` | string | ✓ | → Term。その発話で使われた言葉 |
| `valence` | enum | ✓ | `positive` / `neutral` / `negative` |
| `personId` | string | | → Person（省略可） |
| `sourceId` | string | | → Source（省略可） |
| `contrastTermId` | string | | → Term。**任意**。その時の反対極（人ごとの対比） |
| `aspect` | string | | 何の側面か。例: `"高音"` `"余韻"`（自由語、当面リスト化しない） |
| `note` | string | | 自由メモ・引用原文 |
| `observedVia` | enum | | 観測元。`direct` / `x` / `youtube_comment` / `other` |
| `createdAt` | string | ✓ | ISO 8601 |

> **両義（「キツいけど良い」）** は当面 `valence` ＋ `note` で吸収。専用構造は後回し。
> **対比** は付いた時だけ `contrastTermId` に入る（疎な前提）。これが人ごとの ⇄対 の素。

---

## 5. TermRelation（言葉どうしの関係）— 導出

実体テーブルは持たず、Utterance 群から計算する。重い場合のみキャッシュ。

| type | 導出ルール（MVPの素朴版） |
|---|---|
| `≒ similar` | 同じ `sourceId` に対して別 Term が使われている共起回数が多いほど近い |
| `⇄ opposite` | `contrastTermId` で結ばれたペア。`personId` を保持して**人ごと**に集計 |

キャッシュする場合の形:
```
{ type:"similar"|"opposite", termA, termB, personId?, weight:number, fromUtterances:string[] }
```

> 「意味の揺れフラグ」も導出: ある Term の Utterance を集計し、`positive` と `negative` が
> ともに閾値以上、または `contrastTermId` が人によって割れている → フラグ（静かに表示）。

---

## 例データ（「明るい」の揺れを表現）

```json
{
  "terms": [
    { "id": "T_akarui", "label": "明るい", "aliases": ["明るめ","明るさ"], "createdAt": "2026-06-12T00:00:00Z" },
    { "id": "T_komotta", "label": "こもった", "aliases": [], "createdAt": "2026-06-12T00:00:00Z" },
    { "id": "T_kinkin", "label": "キンキン", "aliases": [], "createdAt": "2026-06-12T00:00:00Z" },
    { "id": "T_nuke", "label": "抜けが良い", "aliases": [], "createdAt": "2026-06-12T00:00:00Z" }
  ],
  "persons": [
    { "id": "P_self", "name": "自分", "kind": "self", "createdAt": "2026-06-12T00:00:00Z" },
    { "id": "P_tanaka", "name": "田中さん", "kind": "pianist", "createdAt": "2026-06-12T00:00:00Z" },
    { "id": "P_cmt", "name": "コメント主xxx", "kind": "commenter", "handle": "@xxx", "createdAt": "2026-06-12T00:00:00Z" }
  ],
  "sources": [
    { "id": "S_yt41", "kind": "youtube", "label": "YT音源 #41", "ref": "https://youtu.be/xxxx", "createdAt": "2026-06-12T00:00:00Z" }
  ],
  "utterances": [
    { "id": "U1", "termId": "T_akarui", "valence": "positive", "personId": "P_tanaka", "sourceId": "S_yt41",
      "contrastTermId": "T_komotta", "aspect": "高音", "observedVia": "direct", "createdAt": "2026-06-12T01:00:00Z" },
    { "id": "U2", "termId": "T_akarui", "valence": "negative", "personId": "P_cmt", "sourceId": "S_yt41",
      "contrastTermId": "T_kinkin", "note": "明るすぎてキンキンする", "observedVia": "youtube_comment", "createdAt": "2026-06-12T01:05:00Z" },
    { "id": "U3", "termId": "T_nuke", "valence": "positive", "personId": "P_self", "sourceId": "S_yt41",
      "observedVia": "direct", "createdAt": "2026-06-12T01:10:00Z" }
  ]
}
```

この3件から導出されるもの:
- `明るい` は **ポジ(田中)とネガ(コメント主)に割れる** → 揺れフラグ
- 反対極が **田中=こもった / コメント主=キンキン** → 人ごとの ⇄対
- `明るい` と `抜けが良い` が **同じ S_yt41 で共起** → ≒近い候補

---

## 実装メモ（次工程の入口）

- **正規化関数** `normalize(label)`: NFKC正規化＋末尾の送り仮名/活用を緩く吸収。完全自動マージは危険なので、
  「これにまとめる？」のサジェスト提示に留め、確定は人が押す（誤マージ防止）。
- **保存方式（要決定）**: スマホ・ローカル前提。候補は PWA + IndexedDB（手軽・無料）または
  ネイティブ + SQLite。上記JSONはどちらでもそのまま表現可能。
- **将来の複数ユーザー化**: 各レコードに `ownerId` を足せば視点共有へ拡張できる（今は付けない）。
