# Agent Orchestrator v1 要件 HANDOFF

更新: 2026-08-31 JST  
対象リポジトリ: `AZ-claude/agent-orchestrator`  
最初のpilot対象: `AZ-claude/slot`  
状態: **REQUIREMENTS COMPLETE — Terraによる実装タスク分解待ち**

## 0. このHANDOFFの目的

この文書は、現在うまく回っている Terra / Luna 開発運用を壊さず、GitHub Issues とローカルdaemonを追加して、人間が行っている不要な交通整理だけを自動化するための v1 要件正本である。

次工程の Terra は、いきなり実装せず、まずこのHANDOFFと最初のpilotである `/slot` の現在の運用・task-boardを確認し、v1実装のtask-board / DAGを作成すること。

このリポジトリは `/slot` 専用機能ではなく、将来ほかの開発リポジトリでも使える orchestrator を置くために新設した。ただし **v1で汎用multi-repo化はしない。最初は `/slot` だけを対象に完成させる。**

---

## 1. 背景: 現在の運用と、実際に困っていること

現在の開発フローは概ね次の通りで、ユーザーはこの流れ自体を気に入っている。

```text
ChatGPTと要件を詰める
  ↓
GitへHANDOFF / 要件正本を残す
  ↓
TerraがHANDOFFを読み、task-board / DAGを作る
  ↓
依存しないTaskをLunaの別sessionで並列実装
  ↓
Lunaがtest / commit / push
  ↓
Terraがreviewし、必要ならrework
  ↓
Terraがmerge
  ↓
全体完了後、Terraが最終acceptance
```

問題はこの役割分担ではなく、**TerraとLunaの間を人間が往復していること**である。

現在の無駄な作業の代表例:

1. TerraがLuna向けの指示を作る。
2. 人間がその指示をLunaへコピー / ペーストする、またはLuna session起動を手伝う。
3. Lunaが完了して停止する。
4. 人間が完了に気づくまで次工程が止まる。
5. 人間がTerraへ「Lunaが終わった」と伝える。
6. Terraがreviewし、reworkなら再び人間がLunaへ指示を運ぶ。

夜間・離席中は特に「Lunaは終わっているのに人間が気づかず、開発全体が止まる」という問題がある。

### v1の中心要件

> **今ある仕組みは残す。GitHub Issuesでタスク管理と実行状態を明確にする。人間によるTerra↔Lunaのpromptコピー、session起動、完了報告の往復をなくす。**

---

## 2. 絶対に維持する設計原則

### 2.1 Gitが正本

GitHub Issuesは仕様の正本にしない。

Gitに残すもの:

- HANDOFF / requirements
- design
- Terraが作るtask-board / DAG
- taskの目的・scope・non-scope
- dependency
- completion / acceptance criteria
- safety / human gate
- code
- tests
- durable evidence / result
- 最終的な完了状態として残すべきドキュメント更新

GitHub Issuesに置くもの:

- 現在の実行状態
- ready / running / paused / worker-done / reviewing / rework / blocked-human などの一時状態
- 現在のbranch / commit / attempt等の実行情報
- blockerの表示
- canonical task-board / HANDOFFへの参照

したがってIssueは、**Git上のtaskを実行するためのcontrol-plane / execution card** と位置付ける。

Issueだけを読めば全仕様を復元できるように仕様を重複コピーする必要はない。Git task-boardから再投影できる構造を目指す。

### 2.2 現在のTerra task-board思想を残す

新しいtask管理思想を発明しない。

`/slot` ではすでに、少なくとも以下の情報を持つtask-boardが運用されている。

- 境界と前提
- Task ID / task名
- 状態 / 着手条件
- dependency / DAG
- completion criteria
- non-target / 禁止事項
- decision gate
- 実装順の運用
- 共通acceptance
- 管理者判断が必要な点
- 必要に応じてpriority、Git境界、evidence、review gate、handoff等

Terraは対象作業に必要な項目を既存運用に合わせて使う。daemonの都合でtask-boardを過度に簡略化しない。

### 2.3 LLMは判断にだけ使う

原則:

> **LLMは意味判断にのみ使う。状態監視、検証可能な事実確認、dependency評価、scheduler、process管理には使わない。**

通常コードで行える以下の処理にTerra/Lunaを呼ばない。

- GitHub Issues polling
- dependency充足判定
- process起動 / 終了検知
- worker枠管理
- branch / worktree確認
- commit存在確認
- remote push確認
- changed files取得
- allowed scopeとの機械比較
- git status確認
- test command実行とexit code取得
- Issue state / label更新
- reboot後のreconcile

ローカルdaemon自体のLLM token消費は **0** とする。

---

## 3. GitHub Issuesモデル

### 3.1 HANDOFF単位の親Issueを作る

1つのHANDOFF / 開発テーマにつき、進捗入口として親Issueを1つ持つ。

例:

```text
Parent: Slopachi結果取り込み
  ├─ SRI-0
  ├─ SRI-1
  ├─ SRI-2
  └─ ...
```

親Issueは進捗を見やすくするためのcontrol-planeであり、仕様正本ではない。

### 3.2 `1 Terra Task = 1 GitHub Issue`

Terraがtask-boardで独立Taskとして切った単位を、そのまま1 Issueに投影する。

- daemonはTask粒度を勝手に分割 / 統合しない。
- Issue粒度が大きすぎる / 小さすぎるという判断はTerraのplanning責務。
- v1では1 Luna sessionで複数Issueを束ねる最適化はしない。

Issueには最低限、次を追えること。

- Task ID
- task名
- canonical HANDOFF / task-board参照
- current execution state
- dependencies
- human gateの有無
- branch / commit / execution attempt
- review result / blocker

scope、acceptance、non-scope等の詳細はGit正本を参照してよい。

### 3.3 実行状態

概念上、少なくとも以下を表現できること。

```text
ready
running
paused
worker-done
reviewing
rework
blocked-human
closed
```

GitHub labelを使うかIssue metadata / comment等を併用するかはTerraがv1の最小実装を決めてよい。ただし状態は機械的に一意に判定できること。

`closed` はTerra approval + 必要なmergeが完了したtaskを表してよい。別の冗長な「orchestrator approved」状態はv1では不要。

---

## 4. Dependencyと並列実行

### 4.1 並列Lunaはv1必須

現在すでに依存しないTaskを並列で進めているため、v1で逐次実行へ退化させてはいけない。

Terraがtask-boardに記載したDAGをdaemonが機械的に評価する。

daemonはdependencyを「考える」のではなく、Terraが書いた依存関係が満たされたかだけを判定する。

READYの基本条件:

```text
Issue is open
AND execution state == ready相当
AND all dependencies are Terra-approved / closed
AND no unresolved human gate
AND worker slot is available
```

### 4.2 並列安全性

論理dependencyがなくても、同一DB / migration / Scheduler / live runtime等を触るTask同士は同時実行したくない場合がある。

v1では複雑なresource-lock systemを作らず、Terraがtaskに次のどちらかを付ける最小契約とする。

```text
Parallel: SAFE
Parallel: EXCLUSIVE
```

- `SAFE`: dependencyを満たしworker枠があれば他Taskと並列実行可。
- `EXCLUSIVE`: 他のLuna Taskと同時実行しない。

必要にならない限り、resource名ごとのlockやAIによる競合推論は追加しない。

### 4.3 worker数

`max_luna_workers` のような単純な設定値でbounded concurrencyを持つ。

具体的な初期値は実装時に小さく安全な値を選び、設定変更だけで増減できること。worker数最適化エンジンは作らない。

### 4.4 worktree / branch

並列Taskは作業ディレクトリを共有しない。

原則としてTaskごとに専用worktree / feature branchを使う。

```text
Issue A -> worktree A -> branch A
Issue B -> worktree B -> branch B
```

branch namingは既存repo運用に合わせ、daemon都合で新しい複雑な命名規則を強制しない。

---

## 5. Terra / Luna / daemon / Human の責務

### 5.1 Terra

Terraは意味判断・全体管理を担当する。

#### Planning Terra

- HANDOFFを読む。
- 対象repoの現状を確認する。
- task-board / DAGを作る。
- taskのscope / non-scope / completion / dependency / safety / human gate / parallel policyを定義する。
- GitHub Issueへ投影可能なTaskを作る。

#### Review Terra

- daemonが作ったreview packetと必要なdiff / codeを読む。
- 要件を正しく実現しているか判断する。
- implementation correctnessを判断する。
- acceptance criteriaを意味的に満たすか判断する。
- `APPROVE / REWORK / BLOCKED_HUMAN` のいずれかを返す。
- APPROVE時のmain mergeは、現在の運用どおりTerraが行う。

#### Final Terra

- 全Task完了後、HANDOFF単位のwhole-product / final acceptanceを行う。
- 必要な最終evidence / task-board更新をGitへ残す。

Terraをpollingやprocess監視には使わない。

### 5.2 Luna

Lunaは個別Taskの実装workerである。

現在の運用を維持する。

- Task専用worktree / branchで作業。
- task-board / task scopeに従って実装。
- tests実行。
- commit。
- push。
- mainへmergeしない。

Luna自身にGitHub Issueの状態管理を大量にさせない。Issueのexecution state更新は原則daemon側が担当し、Lunaは実装に集中させる。

### 5.3 daemon

daemonは非LLMのtraffic controllerである。

担当:

- GitHub Issues監視
- task projection / state transitionの機械処理
- dependency判定
- parallel slot管理
- worktree / worker process起動
- Luna終了検知
- machine validation
- Terra review起動 / resume
- TerraのREWORKをLunaへ渡す
- local checkpoint管理
- crash / rate-limit / reboot recovery
- startup reconcile

担当しない:

- task分解の意味判断
- dependencyの意味推論
- code reviewの意味判断
- requirement interpretation
- merge判断
- production GOの代行

### 5.4 Human

通常の実装フローでは、人間がTerra/Luna間のtraffic controllerにならない。

人間を止めるgateは最小化する。

原則、人間GO不要:

- read-only調査
- reversibleなbranch内実装
- tests
- commit / push
- normal review
- rework

Human Gateを残す代表例:

- production mutation
- 不可逆またはrollback困難な操作
- 外部公開 / production publish
- 金銭・権限・外部サービス等に重大な影響を与える操作
- 要件上、人間のbusiness判断が必要とTerraが明示した事項

「念のため」の承認を増やさない。

---

## 6. Luna完了 -> Terra Review の自動化

### 6.1 人間の完了報告をなくす

現在の

```text
Luna完了
 -> 人間が気づく
 -> 人間がTerraへ「終わった」と伝える
```

を廃止する。

Luna process終了をdaemonが検知し、自動で次工程へ進める。

### 6.2 daemonによるmachine validation

Lunaの自然言語自己申告をそのままTerraへ渡すのではなく、daemonが可能な限り事実を自分で取得する。

例:

- branch
- HEAD commit SHA
- commit存在
- remote push済みか
- git status clean / dirty
- changed files
- taskで許可されたscopeとの差分
- configured test commandとexit code
- dependency state
- unexpected files

必要に応じてLunaが小さなstructured resultを残してもよいが、daemonがGit / process / testから取得できる情報をLLMに再生成させない。

### 6.3 Review Packet

Terraには、毎回repo全体の事実確認をやり直させず、daemonがcompactなreview packetを渡す。

概念例:

```text
Task: SRI-2
Canonical task: <task-board ref>
Branch: agent/SRI-2
Commit: abc123
Push: PASS
Git status: CLEAN
Changed files: ...
Scope check: PASS
Tests: PASS
Dependencies: PASS
Unexpected files: NONE

Review only:
- requirement correctness
- implementation correctness
- acceptance satisfaction
```

Terraは必要な場合だけ深い資料や追加diffを読む。

### 6.4 Terra review result

v1の基本結果は次の3つでよい。

```text
APPROVE
REWORK
BLOCKED_HUMAN
```

#### APPROVE

```text
Terra approves
 -> Terra merges according to existing repo rules
 -> Issue closes
 -> dependency unlock
 -> daemon dispatches newly-ready Task
```

#### REWORK

```text
Terra returns concrete rework instruction
 -> daemon records it
 -> same Issue / same task branch
 -> Luna rework session
 -> machine validation
 -> Terra review again
```

人間はTerraのreview指摘をLunaへコピーしない。

#### BLOCKED_HUMAN

本当に人間判断が必要な時だけ停止する。

### 6.5 Terra sessionの扱い

HANDOFFごとに、原則として1つのTerra orchestrator sessionを維持する方向を優先する。

理由:

- HANDOFFを読み直すtokenを減らす。
- task分解理由 / DAG / 全体contextを保持できる。
- 現在人間が送っている「Lunaが終わった」をdaemonから同sessionへ送る形に近い。

sessionが壊れた、resume不能、極端に長大化した等の場合だけ新sessionへ移行できること。

複数のLunaがほぼ同時にworker-doneになっている場合、Terraが空いた時点で待機中review packetをまとめて渡してよい。timerを使った複雑なbatchingは不要。

---

## 7. Git操作の境界

v1では新しいGit権限モデルを発明せず、対象repoの現行運用に合わせる。

`/slot` pilotでの意図する責務は次の通り。

### Luna

- feature branch / worktree上でedit
- test
- commit
- push
- main mergeは禁止

### Terra

- task-board / durable docs更新
- review
- 必要なrework指示
- APPROVE後のmerge
- final acceptance

### daemon

機械的なGit操作 / 読み取りだけを担当する。

- worktree準備 / lifecycle
- branch情報確認
- commit / remote push確認
- diff / changed files取得
- status確認
- scope機械比較

**mergeはdaemonに移さない。今まで通りTerraが行う。**

対象repoに既存の共通AI/Git operating rulesがある場合、それを優先して読み、上記と矛盾があれば勝手に上書きせずtask-boardで明示する。

---

## 8. 異常終了・Codex上限・PC再起動からの復旧

無人運転する以上、これはv1必須要件であり、将来機能ではない。

基本原則:

> **processが死んでもtaskは死なない。一度済んだLLM作業を最初からやり直さない。**

### 8.1 persistent local checkpoint

daemonの実行状態をmemoryだけに持たない。

Issueが論理的な実行状態を持ち、ローカルcheckpointはprocess/session復旧に必要な情報だけを持つ。

概念例:

```json
{
  "issue": 123,
  "task": "SRI-3",
  "phase": "luna",
  "sessionId": "...",
  "branch": "agent/SRI-3",
  "worktree": "...",
  "attempt": 1
}
```

checkpointは仕様正本ではない。消失してもGit上の仕様・code・Issueの論理状態が失われない構成にする。

### 8.2 Codex usage / rate limit

Codex上限は異常ではなく、通常発生する一時停止として扱う。

```text
Luna / Terra running
 -> usage/rate limit
 -> daemon detects it
 -> paused:rate-limit相当
 -> session/worktree/branch保存
 -> reset後にsame session resume
```

要件:

- 上限到達をFAILED扱いしない。
- 新sessionで最初からやり直さない。
- 同じsession / worktree / branchのresumeを第一選択にする。
- CLIがretry/reset時刻を返す場合はそれを利用する。
- 時刻が取れない場合も低頻度の再試行とし、短時間に何度もCodex起動しない。
- rate-limit待機中にLLMを使ったpollingをしない。
- 全Luna枠がlimitなら静かに待つ。

### 8.3 process crash / terminal切断 / network一時障害

process消失時:

1. session IDが残っていればsame session resumeを試す。
2. same worktree / branchを再利用する。
3. 自動resumeは有限回にする。
4. 無限retryしない。
5. recovery不能時だけ `blocked-human` へ送る。

具体的retry回数は小さなconfig値でよい。高度なretry policy engineは作らない。

技術的process failureのたびにTerraを呼び、LLMに「どうする？」と判断させない。

### 8.4 PC / host再起動

daemonはhost起動後に自動起動できること。

OS nativeなstartup mechanismを使う。pilot hostがWindowsならTask Scheduler等、既存運用に自然な方法を優先する。

起動時に必ずreconcileを行う。

照合対象:

- GitHub Issue state
- local checkpoint
- worker / Terra process存在
- worktree
- branch / commit / remote
- tests / completion evidence（必要な範囲）

代表ケース:

```text
Issue=running + processなし + sessionあり
 -> same session resume

Issue=running + processなし + completed/pushed commitあり
 -> workerを再起動せずmachine validation -> reviewへ

Issue=reviewing + Terra processなし + Terra sessionあり
 -> Terra resume

Issue=closed + stale local checkpoint
 -> cleanup
```

**machine unavailable != task failed** とする。

PCが落ちている間にIssueをFAILEDへ変える必要はない。復帰後のreconcileで安全に現在地を再構成する。

---

## 9. Token予算に関する要件

このプロジェクトの重要な目的の1つは、automationによってCodex token消費を増やさないこと。

期待する経済性:

```text
Luna implementation tokens ~= 現在の手動運用
Terra semantic review tokens <= 現在の手動運用
Daemon LLM tokens = 0
```

特に避けること:

- daemonがAIを使ってpollする
- dependency判定をAIにやらせる
- worker終了後にTerraへGit / testの事実確認を毎回やらせる
- errorごとに新sessionでHANDOFFを読み直す
- retryのたびにpreflightをLLMで最初から繰り返す
- Issue state更新のためだけにLuna/Terra turnを増やす

Terraは機械確認済みreview packetを受け取り、意味判断だけをする。

---

## 10. v1 End-to-Endの期待フロー

```text
ChatGPT + Human
requirements
   ↓
Git HANDOFF
   ↓
Terra Planning
   ↓
Git task-board / DAG
   ↓
Parent Issue + 1 Task = 1 Issue
   ↓
             daemon
        dependency / slots
          0 LLM tokens
          /          \
         ↓            ↓
      Luna A        Luna B
      Task A        Task B
         ↓            ↓
       process exit / result
          \          /
             ↓
           daemon
      machine validation
        0 LLM tokens
             ↓
        review packet(s)
             ↓
   same Terra orchestrator
       /       |       \
 APPROVE    REWORK   BLOCKED_HUMAN
    ↓          ↓          ↓
Terra merge   Luna       Human
    ↓        rework       gate
Issue close
    ↓
dependency unlock
    ↓
next READY Luna auto-dispatch

all Tasks closed
    ↓
Terra Final Acceptance
```

正常時、人間は次をしない。

- Terra promptをLunaへコピー
- Luna sessionを手作業で次々起動
- Luna完了を目視監視
- Terraへ完了報告
- Terraのrework指示をLunaへコピー
- dependency完了を見て次Taskを手作業起動

---

## 11. v1 Acceptance Criteria

v1完成条件は、少なくとも `/slot` の実Taskで次を証明できること。

1. Git HANDOFF / Terra task-boardを正本として扱える。
2. HANDOFF親Issueと、Terra Task単位のIssueを作成 / 管理できる。
3. dependencyを満たしたTaskだけがREADYになる。
4. 複数の`Parallel: SAFE` Taskをbounded concurrencyでLunaへ並列dispatchできる。
5. `Parallel: EXCLUSIVE`を他Lunaと同時実行しない。
6. 各Taskが独立worktree / branchで実行される。
7. Luna完了を人間の報告なしでdaemonが検知する。
8. commit / push / diff / changed files / scope / test等のmachine validationをLLMなしで行う。
9. review packetからTerra reviewへ自動遷移できる。
10. Terra APPROVE後は現在のGit運用どおりTerraがmergeし、Issue close / dependency unlockへ進む。
11. Terra REWORKを人間のcopy/pasteなしでLunaへ返せる。
12. Human Gate以外は離席中でも次Taskへ進み続ける。
13. Codex rate limit時に安全にpauseし、limit解除後に可能な限りsame sessionからresumeできる。
14. worker / Terra process crash後に有限回の自動resumeができる。
15. host再起動後、Issues / local checkpoint / Git / processをreconcileして現在地から再開できる。
16. すでに完了・push済みのTaskをreboot後に最初からLunaへやり直させない。
17. daemonの通常監視・scheduler・validationにLLM tokenを使わない。
18. 全Task完了後にTerra final acceptanceまで到達できる。

成功のユーザー視点の定義:

> **「HANDOFFをTerraへ渡した後、Human Gateがない範囲では、人間がTerra/Luna間を往復しなくても複数Taskが進み、review・rework・merge・次Task解放まで継続する」こと。**

---

## 12. v1でやらないこと（YAGNI境界）

以下は意図的にv1対象外。

- Ollama / local LLM worker
- generic worker abstraction / worker selection engine
- automatic model switching
- Codex quota時の別model自動代替
- multi-repository orchestration
- GitHub Projects
- GitHub Actionsをorchestrator本体として使うこと
- web dashboard /独自UI
- AI scheduler
- AIによるdependency推論
- AI monitoring / AI polling
- cost optimization engine
- 複雑なresource-lock framework
- 複雑なretry strategy / backoff engine
- 複雑なmetrics / observability platform
- 1 Luna sessionへの複数Issue batching最適化
- 全Symphony機能の再実装

必要な状態はGitHub Issuesと最小local stateで可視化し、UIを新造しない。

---

## 13. v2で予定していること

v1が `/slot` で安定した後、Codex上限中にも進められる仕事を増やすためlocal workerを追加する。

### 13.1 Ollama / local worker

候補方針:

- local modelをOllamaで動かす。
- 可能ならCodex CLIのOSS / Ollama providerを使い、Lunaと同じcoding harnessを維持する。
- 別coding agent frameworkは必要性が出るまで増やさない。

### 13.2 worker selection

v2ではTerraがTask特性を見て、例えば次を指定できるようにする。

```text
worker: luna
worker: local
```

そこで初めてworker abstractionを導入する。

v1で将来のためだけのgeneric abstractionを先に作らない。

### 13.3 Codex limit中の継続

期待する状態:

```text
Codex quota / limit
 -> Luna Taskはpaused

local向きREADY Task
 -> Ollama workerで継続
```

### 13.4 local -> Luna fallback

local workerが次のような状態になった場合、Lunaへfallbackできる方向を想定する。

- failure
- timeout
- no meaningful diff
- tests fail and local recovery unsuccessful
- Terra / workerがexplicit escalationを要求

fallback条件はv2で実測して決める。v1には入れない。

---

## 14. Symphony等の既存実装の扱い

OpenAI Symphonyの思想は本要件と近く、参考にする価値がある。

参考にする概念:

- long-running non-LLM orchestration service
- issue tracker polling
- isolated per-issue workspace
- bounded concurrency
- reconciliation / recovery
- repo-owned workflow contract

一方、v1ではSymphonyそのもののfeature parityを目標にしない。

特に避けること:

- frameworkに合わせるため現在のTerra/Luna運用を壊す
- automatic continuation / 多turn retryによってtoken消費を増やす
- GitHub Projects導入
- v2のworker routingをv1で先取り

Terraは実装planning時に、既存OSS / Symphony系GitHub Issues実装から **必要部分を薄く再利用する方が小さいか、custom daemonの方が小さいか** を比較してよい。

評価軸は「コード量が少ない」だけでなく以下を優先する。

1. 現在の運用を変えない。
2. token消費が予測可能。
3. parallel + dependencyを満たせる。
4. resume / reconcileを安全に実装できる。
5. 不要なframework behaviorを無効化するための複雑さが増えない。

採用しないOSSを詳細に再実装・調査し続ける必要はない。

---

## 15. v1でまだ固定しなくてよい実装詳細

要件を満たす範囲でTerraが最小構成を選んでよい。

- daemon実装言語
- polling interval
- GitHub labelの具体名
- local checkpoint file layout
- `max_luna_workers`初期値
- crash時の有限retry回数
- Issue本文templateの細部
- Terra review packetのserialization形式
- daemon自身の最小log形式
- host auto-startの具体方式

ただし、これらを決めるために新しい大規模frameworkを導入しない。

---

## 16. Terraへの次工程指示

このHANDOFFを受け取ったTerraは、**まずplanningだけを行う。いきなり実装しない。**

### 必須確認

1. `/slot` の最新task-board / HANDOFF / agent-runsを確認し、現在の実運用を把握する。
2. `/slot` に存在する共通AI / Git operating rulesを確認し、Luna / TerraのGit操作境界を既存運用に合わせる。
3. 現在のCodex CLIでsession resumeをどう安定して識別・再開できるかを確認する。
4. Luna / Terra processの終了reason、特にusage/rate-limitを機械判定できる情報を確認する。
5. GitHub Issues APIで必要なstate projectionが最小構成で可能か確認する。
6. Symphony / GitHub-label系既存実装を流用する場合とthin custom daemonを比較し、v1要件に対して小さい方を選ぶ。

### 作るもの

- v1 implementation task-board
- dependency DAG
- 各Taskのscope / non-scope
- completion criteria
- safety / Human Gate
- `Parallel: SAFE / EXCLUSIVE`
- 実装順
- pilot acceptance plan

### planning原則

- YAGNIを守るが、**parallel Lunaとdependency handlingは削ってはいけない。**
- recovery / rate-limit / reboot reconcileも無人運転に必要なのでv1から削らない。
- Ollama / worker abstraction / multi-repo等はv1へ持ち込まない。
- daemonにLLMを入れない。
- mergeをdaemonへ移さない。
- `/slot` の既存workflowを置き換えるのではなく、traffic-control部分を包む。

Terraはtask-boardをGitへcommit / pushし、その後の実装に移る前に、task分割・依存関係・v1境界がこのHANDOFFと一致していることを確認すること。

---

## 17. 最終要約

このプロジェクトは「新しいAI開発システムを作る」ことが目的ではない。

目的は、すでに安定している次の役割分担を維持したまま、

```text
Terra = planning / semantic review / merge / final acceptance
Luna  = implementation worker
Git   = source of truth
```

人間が行っている、

```text
prompt転送
session起動
完了監視
完了報告
rework転送
dependencyを見た次Task起動
```

だけを、

```text
GitHub Issues + non-LLM local daemon
```

へ移すものである。

v1が成功した時の最も重要な変化は、**人間が離席していても、Human Gateがない限り Terra → Luna → validation → Terra review → rework/merge → 次Task が自動で進み続けること**である。
