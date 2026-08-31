# Agent Orchestrator v1 詳細設計

更新: 2026-08-31 JST
要件正本: [HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md](./HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md)
pilot: `AZ-claude/slot`
状態: **DESIGNED — 実装未開始**

## 1. 結論と境界

v1 は、`/slot` 専用設定を読む単一の Node.js/TypeScript local daemon とする。daemon は GitHub Issue と Git/worktree/Codex CLI の事実を機械的に扱い、LLM を呼ばない。意味判断は、既存の Terra session に review packet を送ったときだけ発生する。

実装の正本は Git の task manifest と task-board である。GitHub Issue はその manifest の execution card であり、仕様本文を複製しない。daemon は merge を実行しない。Luna と Terra の既存 Git operating rules を prompt に含め、Terra が APPROVE 後に既存ルールに従い merge/push する。

v1 の対象外は multi-repo、worker abstraction、Ollama、GitHub Projects、独自 UI、resource 名 lock、AI scheduler、AI polling、daemon merge である。

## 2. 採用する最小構成

| 項目 | 採用 | 理由 |
|---|---|---|
| 実装 | Node.js 22 + TypeScript | `/slot` と同じ実行系。`gh`、`git`、`codex` を child process で安全に扱える。|
| GitHub 接続 | `gh api` / `gh issue` | 既存認証を再利用し、PAT・SDK・webhook server を増やさない。|
| Issue 状態 | 排他的な `ao:state:*` label 1 個 | 一覧・手動確認が容易で、API から一意に判定できる。|
| 依存 | Git manifest の `dependsOn` + GitHub blocking relation | manifest を正本にしつつ Issue 上でも可視化する。|
| checkpoint | repo 外の daemon state directory に atomic JSON | v1 の単一 process/単一 pilot に SQLite は不要。Git/Issue から再構成可能な補助状態だけを保持する。|
| process 実行 | `codex exec --json` と `codex exec resume <session-id> --json` | session ID と lifecycle event を保存し、同じ session を最優先で再開できる。|
| 自動起動 | pilot host の `launchd` LaunchAgent | 現在の pilot controller host は macOS。Windows 操作や `/slot` の production scheduler は触らない。|

`codex queue` は Desktop の実行中 session へのキュー用途であり、daemon の durable な review/restart 経路には採用しない。daemon は保存した UUID に対して `codex exec resume` を起動し、終了を監視する。

## 3. Git 上の workflow contract

HANDOFF ごとに、以下を `agent-orchestrator` の Git に置く。

```text
docs/task-boards/<handoff-slug>.md     # 人間が読む canonical board / DAG / gate
tasks/<handoff-slug>.yaml              # daemon が読む canonical manifest
```

YAML は task-board の機械可読な投影であり、別の仕様ではない。両方を同じ commit で更新する。manifest の v1 schema は次だけに固定する。

```yaml
handoff:
  id: agent-orchestrator-v1
  source: docs/HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md
  targetRepo: /Users/eita/projects/slot
  baseBranch: main
tasks:
  - id: AO-01
    title: Codex CLI lifecycle contract spike
    dependsOn: []
    parallel: SAFE # SAFE | EXCLUSIVE
    humanGate: false
    allowedPaths: [src/codex/**, test/fixtures/codex/**]
    test: npm test -- codex-lifecycle
```

prompt 本文、branch/worktree、attempt、session ID、HEAD は manifest に書かず、Issue と local checkpoint に置く。task 追加・分割・依存変更は Terra planning のみが行う。

## 4. GitHub Issue projection

bootstrap は parent Issue を 1 件作り、各 manifest task を同 parent の sub-issue として作成する。Issue body には、task ID、task-board の commit/path、dependency task ID、parallel policy、human gate、canonical task への短い参照だけを書く。`<!-- agent-orchestrator:task=AO-xx -->` marker で再実行時の二重作成を防ぐ。

state label は次のいずれか一つだけである。

```text
ao:state:ready | running | paused | worker-done | reviewing | rework | blocked-human
```

close は label ではなく GitHub Issue の closed state で表す。daemon は起動時・poll ごとに、同一 Issue の複数 state label、manifest にない Issue、closed なのに merge 未検証といった矛盾を dispatch せず `blocked-human` にする。履歴は state transition ごとの短い Issue comment と daemon log に残す。

## 5. コンポーネントとデータの流れ

```text
Git task-board + manifest ──> projector ──> parent/sub Issues
                                      │
GitHub Issues <── poll/reconcile ─ scheduler ──> worktree manager
                                      │                    │
                                  checkpoint            Luna process
                                      │                    │
                                      └── validator <──────┘
                                                │
                                           review packet
                                                │
                                      Terra session runner
                                      /        |         \
                                 APPROVE    REWORK  BLOCKED_HUMAN
                                    │          │          │
                           verify merge/close  └── resume Luna
```

### 5.1 Scheduler

poll interval ごとに、manifest と open Issue を読み、次の全条件を満たす task だけを dispatch 候補にする。

```text
Issue is open
AND state == ready
AND every dependsOn task is closed and its merged commit is ancestor of origin/<base>
AND humanGate is false or its explicit Issue marker is satisfied
AND no exclusive task is running
AND (task is EXCLUSIVE => no Luna task is running)
AND (task is SAFE => running SAFE workers < maxLunaWorkers)
```

候補の順番は manifest の stable order とする。優先度最適化はしない。状態更新と checkpoint write は dispatch 前に行い、worktree 作成失敗時は `paused` に戻す。

### 5.2 Worktree と Luna 実行

task ごとに `agent/<task-id>` branch と daemon state root 以下の専用 worktree を作る。既存 branch/worktree が checkpoint と一致すれば再利用する。Luna はその worktree で `codex exec --json` を起動する。標準出力 JSONL と終了 code を run log に保存し、最初に得た session UUID を checkpoint に永続化する。

rework/crash/rate-limit からの再開は、新しい task を作らず、同じ worktree/branch と `codex exec resume <saved-session-id>` を使う。session が存在しない場合だけ、有限 retry を使い、再開不能なら `blocked-human` にする。`--last` は別 task の session を選び得るため使用しない。

### 5.3 Machine validation

Luna exit は成功宣言ではない。validator が LLM なしで以下を集める。

- branch と expected worktree、HEAD commit、working tree clean
- commit が存在し、remote branch に push 済みであること
- merge-base と changed files
- `allowedPaths` に対する path scope check
- task 固有 test command と exit code
- dependency と base revision の整合性

すべて PASS なら `worker-done` として review packet を作る。失敗なら、技術的に再開可能な failure は `paused`、scope mismatch や retry exhausted は `blocked-human` とする。validator は code correctness を判定しない。

### 5.4 Terra review と merge

review packet は canonical task ref、branch、HEAD、push、cleanliness、changed files、scope/test/dependency 結果、前回 rework を持つ短い JSON/Markdown artifact である。daemon は保存済み Terra session に、機械事実と以下だけを要求する。

```text
Return exactly one result: APPROVE, REWORK, or BLOCKED_HUMAN.
For REWORK/BLOCKED_HUMAN, include a concrete reason/instruction.
For APPROVE, merge/push by the target repository's existing rules before replying.
```

Terra response は JSON schema で parse する。APPROVE は `origin/<base>` が task HEAD を含むことを daemon が検証して初めて Issue close と dependency unlock になる。REWORK は同 Issue の `rework` 状態と instruction を checkpoint/Issue に記録し、同じ Luna session に渡す。BLOCKED_HUMAN は dispatch を止める。

### 5.5 Reconcile と rate limit

checkpoint は `issueNumber`, `taskId`, `phase`, `attempt`, `sessionId`, `branch`, `worktree`, `pid`, `lastHead`, `retryAt` のみを持つ。起動時には Issue、checkpoint、worktree、Git remote、process existence を照合する。

| 観測 | 機械処理 |
|---|---|
| `running` + PID あり | 監視を再接続する。|
| `running` + PID なし + pushed commit | validator から再開する。|
| `running` + PID なし + session ID | 同 session を有限回 resume する。|
| `reviewing` + Terra PID なし + session ID | 同 Terra session を resume する。|
| `closed` + checkpoint | state/log/worktree の cleanup 候補にする（削除は retention 後）。|

Codex JSONL/exit output で実証した rate-limit signature を AO-01 が adapter に定義する。該当時は `paused` と retry-at を記録し、retry-at まで process を起動しない。時刻が得られなければ config の低頻度 interval を使う。rate limit を task failure として扱わない。

## 6. 安全性・運用契約

- daemon が行う Git write は task worktree/branch の作成だけであり、target `main` の merge、production DB、scheduler、deploy は行わない。
- `EXCLUSIVE` は実行中 Luna task がゼロでなければ開始せず、開始中は他 task を開始しない。`SAFE` は `maxLunaWorkers` に制限する。
- Human gate は Issue の明示 marker/label がない限り解除されない。「以前の会話で GO だった」ことを daemon は推論しない。
- filesystem state の更新は temp file + fsync + rename で atomic にする。secret/token は checkpoint・Issue・log に書かない。
- `launchd` install は daemon の通常起動と別 command にし、runbook に従って一度だけ明示的に行う。daemon 自体は `/slot` の Windows Task Scheduler を作成・変更しない。

## 7. OSS 比較と判断

Symphony 系の Issue polling/worktree/concurrency/reconcile という概念は参考にする。ただし v1 は既存 Terra/Luna session、Terra merge、manifest 正本、three-outcome review、Codex rate-limit resume を保持しなければならない。これらを既存 framework の lifecycle に合わせて無効化/差し替えする方が、`gh`/`git`/`codex` を薄く包む daemon より大きくなる。

したがって **thin custom daemon を採用する**。この判断は feature parity を捨てる判断であり、上記 v1 必須要件を捨てる判断ではない。

## 8. pilot acceptance

fixture-backed fake `gh`/`git`/`codex` adapter と disposable local Git remote で unit/integration を先に作る。その後 `/slot` の production を触らない documentation-only または disposable test task を二つ用意し、SAFE parallel、EXCLUSIVE serialization、worker exit→validation→Terra review→merge verification、REWORK、rate-limit resume、daemon restart reconcile を証明する。production DB/Scheduler を含む task は明示 Human Gate のまま v1 acceptance から除外する。
