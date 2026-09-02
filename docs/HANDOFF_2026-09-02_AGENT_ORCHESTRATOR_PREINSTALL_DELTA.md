# Agent Orchestrator インストール前追加要件 HANDOFF

更新: 2026-09-02 JST  
対象リポジトリ: `AZ-claude/agent-orchestrator`  
基礎要件: `docs/HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md`  
現行詳細設計: `docs/DESIGN_2026-08-31_AGENT_ORCHESTRATOR_V1.md`  
現行task-board: `docs/task-boards/2026-08-31-agent-orchestrator-v1.md`  
現行machine manifest: `tasks/agent-orchestrator-v1.yaml`  
状態: **REQUIREMENTS COMPLETE — Planning Terra による差分task-board / DAG作成待ち**

## 0. この文書の位置づけ

この文書は、既に実装済みの Agent Orchestrator v1 を実ホストへinstallする前に追加する要件の正本である。

既存v1要件・設計を全面的に置き換えるものではない。**本書と既存v1が矛盾する箇所だけ本書を優先し、それ以外のv1要件・安全境界・pilot制約は維持する。**

主目的は次の3点である。

1. Terraのtoken消費を減らし、通常TaskごとのTerra review/mergeを廃止する。
2. Human Gateを本当に人間判断が必要なケースに限定し、夜間・離席時の自動継続性を高める。
3. 将来WorkerをQwen等へ差し替えやすい契約にする。ただし今回Qwen integrationや汎用routerまで実装しない。

YAGNIを優先する。今回必要な最小変更だけを実装し、将来用の複雑なframeworkを先回りして作らない。

---

## 1. 現行v1からの差分サマリ

| 項目 | 現行v1 | インストール前追加要件 |
|---|---|---|
| Terra Planning | HANDOFFからtask-board/DAG作成 | 維持。加えてrequirements/task/dependency/acceptanceの整合性監査を行う |
| Taskごとのsemantic review | Independent Luna review後、Terraがsemantic approval | **廃止**。Independent ReviewerのAPPROVEをTaskの意味レビュー完了とする |
| Task merge | Terraがmerge | **daemonがdeterministic gateを確認してauto-merge** |
| daemon merge | 禁止 | 条件付きで許可し、通常Task mergeの主体にする |
| Terra途中介入 | Task review/reworkで頻繁に使用 | **reviewer-confirmed PLAN_CONFLICTのPlan Revisionだけ** |
| Terra最終受入 | 全Task後に実施 | 維持 |
| REWORK | APPROVEまで同じLuna sessionで反復 | 最大3回。同一失敗反復は早期STUCK→fresh Recovery Worker |
| Recovery | crash/rate-limit中心 | 実装上のSTUCKに対するfresh-context Recovery Workerを追加 |
| Worker概念 | Luna固定 | 契約上はPrimary Worker / Recovery Workerとして扱う。ただしruntime provider routerは今回作らない |
| task-board編集 | Terra planning中心 | **task-board/DAGの意味変更権限はTerraだけ**と明示 |
| Plan矛盾 | 明確な専用経路なし | PLAN_CONFLICTを追加。Independent Reviewer確認後のみTerra Plan Revision |
| Requirement矛盾 | Human Gate相当 | REQUIREMENT_CONFLICTとして明示しHuman Gate |
| session cleanup | retention/再開中心 | Task完了ごとに不要sessionをretire/cleanup |
| task情報 | dependency/completion/safety等 | `assumptions` / `invariants` を追加 |
| Plan Revision中の並列 | 規定なし | Worker全停止はせず、global merge barrierだけ張る |

---

## 2. 新しい責務分離

### 2.1 Terraは「入口・計画修正・出口」に限定する

Terraの責務は次の3種類だけとする。

#### A. Planning Terra

- HANDOFF / requirementsを読む。
- 対象repoの現在状態を確認する。
- task-board / DAGを作る。
- scope / non-scope / completion criteria / dependency / SAFE・EXCLUSIVE / Human Gateを定義する。
- 各Taskの `assumptions` / `invariants` を必要な範囲で定義する。
- requirements ↔ task scope ↔ dependency ↔ acceptance criteriaに明白な矛盾がないか整合性監査を行う。

#### B. Plan Revision Terra

通常の実装失敗では呼ばない。

Independent Reviewerが `PLAN_CONFLICT_CONFIRMED` とした場合だけ、task-board / DAGを修正する。

#### C. Final Acceptance Terra

全Taskが完了・mergeされた後、canonical HANDOFF全体に対してwhole-product acceptanceを行う。

Terraは通常Taskの実装、通常Taskごとのsemantic review、通常Taskのmergeを担当しない。

### 2.2 Worker

個別Taskの実装者。

今回のruntime実装では既存Lunaを使用してよい。ただし概念・契約はLuna固有名称へ過度に固定せず、少なくとも以下を区別する。

- Primary Worker
- Recovery Worker

現フェーズの実体:

```text
Primary Worker  = Luna
Recovery Worker = Lunaのfresh session
```

将来、たとえばPrimary=Qwen3.6 / Recovery=Qwen3.8等へ差し替え可能な境界を壊さないこと。

ただし今回以下は作らない。

- Qwen/Ollama integration
- multi-provider worker router
- Task単位のmodel/provider選択UI
- provider最適化engine

### 2.3 Independent Reviewer

Workerの実装を独立contextで意味レビューする。

- implementation reasoning/historyを継承しない。
- codeを変更しない。
- task scope、completion criteria、assumptions、invariants、allowed paths、source HEAD、machine evidenceを確認する。
- `APPROVE` / `REWORK` を返す。
- PLAN_CONFLICTの疑いが出た場合は、後述の専用contractで確認する。

現行の「implementation Lunaがread-only reviewer subagentを起動する」仕組みは、独立性が維持される限り再利用してよい。今回、review transportを一般化するためだけの大規模rewriteはしない。

### 2.4 daemon

daemonは引き続きLLMではないtraffic controllerであり、semantic judgmentをしない。

追加後の担当:

- scheduling / dependency evaluation
- Worker process/session lifecycle
- machine validation
- review/rework routing
- STUCK / retry counter等の機械的状態管理
- Plan Revision時のmerge barrier
- deterministic auto-merge
- Issue close / dependency unlock
- session retire/cleanup
- restart/reconcile

意味判断をdaemonへ移さない。

---

## 3. 通常Taskの新しい完了フロー

通常Taskは次の流れとする。

```text
Primary Worker implementation
  ↓
machine validation
  ↓
Independent Reviewer
  ├─ REWORK → same Primary Worker session
  └─ APPROVE
        ↓
      deterministic merge gates
        ↓
      daemon auto-merge
        ↓
      Issue close / dependency unlock
        ↓
      unnecessary sessions cleanup
```

**TaskごとのTerra semantic approvalは行わない。**

### 3.1 auto-mergeの条件

ReviewerのAPPROVEだけでmergeしない。daemonが少なくとも以下を機械的に再確認し、すべてPASSした場合だけmergeする。

- required tests PASS
- machine validation PASS
- allowed scope逸脱なし
- unexpected diffなし
- working tree clean
- remote branch push済み
- dependency/base consistency PASS
- reviewerが確認したHEADと現在HEADが一致
- unresolved Human Gateなし
- active merge barrierなし

merge方式はtarget repositoryの既存Git rulesを尊重する。Worker自身にmain merge判断をさせない。

### 3.2 mergeはLLM judgmentではない

Independent Reviewerが意味的に `APPROVE` するところまでがLLM責務。

その後のmerge可否は、上記のdeterministic factsのみでdaemonが決定する。

---

## 4. REWORKとSTUCK

### 4.1 same-session REWORK

通常のReviewer `REWORK` は同じPrimary Worker session/worktree/branchへ戻す。

同じWorkerでのreview/rework cycleは**最大3回**とする。

### 4.2 早期STUCK

最大回数を待たず、少なくとも以下の反復を機械的に観測できる場合はSTUCKとしてRecoveryへ切り替える。

- 同一review findingが2回連続
- 同一test failureが2回連続
- 実質同じ変更を戻す/再適用する明白なdiff oscillation

YAGNIを優先し、汎用的なAI loop detectorは作らない。安定したfinding ID / normalized failure signature /簡単なGit evidence等で判定できる最小実装にする。

---

## 5. Recovery Worker

Primary WorkerがSTUCKした場合、古い会話historyをそのまま引き継がないfresh Recovery Workerへtakeoverさせる。

Recovery Workerへ渡す情報はdurable evidence中心とする。

- canonical task
- acceptance criteria
- assumptions / invariants
- current branch / HEAD
- machine validation evidence
- test failures
- reviewer findings
- attempted fixesの短いstructured summary

古いWorkerの全reasoning/historyを渡すことを必須にしない。

### 5.1 Recoveryの上限

- fresh takeoverは1回
- Recovery Worker内のreview/rework cycleは最大3回
- Recovery WorkerにもIndependent Reviewerを必須とする
- Reviewer APPROVE後の完了条件・auto-merge gateは通常Taskと同一

Recoveryでも解決できなければ、単純にTerraへコード修正を依頼しない。まず原因を分類する。

```text
Recovery exhausted
  ├─ PLAN_CONFLICT suspicion → Independent Reviewer confirmation flow
  └─ pure implementation failure → BLOCKED_HUMAN
```

---

## 6. PLAN_CONFLICTとREQUIREMENT_CONFLICT

### 6.1 PLAN_CONFLICT

canonical HANDOFF / requirements自体は明確だが、Terraが作ったtask-board / DAG側に矛盾・不足がある状態。

代表例:

- 2つ以上のacceptance criteriaを同時に満たせない
- Task scopeだけではcompletion criteriaを満たせない
- 必須dependencyが欠落・誤設定されている
- HANDOFFとtask-boardが矛盾している
- Task完了に明示non-scope/forbidden pathの変更が必須
- Taskのassumption/invariantがrepo/runtime evidenceにより偽と判明
- Task完了が既完了Taskを無効化し、DAG変更なしでは進められない

以下はPLAN_CONFLICTではない。

- 実装が難しい
- testが失敗した
- reviewerが通常のコード修正を要求した
- Workerが方法を思いつかない
- 選んだ実装アプローチが失敗した

これらは通常REWORK/Recoveryで処理する。

### 6.2 PLAN_CONFLICT claim

Workerはtask-boardを直接変更せず、structured claimを返す。

最低限の情報:

- `conflictType`
- `taskId`
- `canonicalRequirementRefs`
- `conflictingTaskFields`
- `repoEvidence`
- `whyWorkerCannotResolveWithinScope`
- optional `proposedPlanChange`

### 6.3 Independent Reviewer confirmation

WorkerがPLAN_CONFLICTを主張しただけではTerraを呼ばない。

Independent Reviewerが、通常の実装問題ではなく本当にplan-level contradictionかを確認する。

```text
PLAN_CONFLICT claim
  ↓
Independent Reviewer
  ├─ NOT_CONFIRMED → normal rework/recovery
  └─ PLAN_CONFLICT_CONFIRMED → Terra Plan Revision
```

これにより、Workerが難しい実装をPLAN_CONFLICTとしてTerraへ逃がすことを防ぐ。

### 6.4 task-board / DAG編集権限

**task-board / DAGの意味変更権限はTerraだけが持つ。**

Worker / Reviewerは次だけ可能。

- 矛盾を報告する
- evidenceを示す
- 疑わしいTask/dependency/acceptance fieldを指摘する
- 修正案を提案する

Worker / Reviewerが行ってはいけないこと:

- Task追加/削除
- dependency変更
- scope/non-scope変更
- acceptance criteria変更
- SAFE/EXCLUSIVE変更
- Human Gate分類変更
- DAGの意味変更

### 6.5 REQUIREMENT_CONFLICT

canonical HANDOFF / requirementsそのものが曖昧・矛盾している、またはプロダクト判断が必要な状態。

Terraはこれをtask-board修正だけで隠してはいけない。

```text
REQUIREMENT_CONFLICT
  ↓
BLOCKED_HUMAN
  ↓
User + ChatGPT がcanonical requirementsを決定/更新
  ↓
Planning Terraが再Planning
```

Terraにもcanonical HANDOFFを勝手に変更する権限は与えない。

---

## 7. Plan Revision中の並列実行

PLAN_CONFLICT_CONFIRMED後、全Workerを停止する必要はない。

最小ルール:

1. conflict対象Taskと、現行DAG上のその下流dependencyはpauseする。
2. 無関係なSAFE Taskは実装/test/pushを継続してよい。
3. Terra Plan Revision中は**global merge barrier**を有効にし、どのTaskもmainへauto-mergeしない。
4. Terraがtask-board/DAGを更新した後、daemonがcanonical board/manifestを再同期する。
5. revised planで影響を受けないTaskはbarrier解除後に通常フローへ戻す。
6. 影響Taskはrevised scope/dependency/acceptanceに従ってresumeまたはfresh restartする。

複雑なmerge queueや汎用barrier frameworkは作らない。必要なのは「Plan Revision中はmergeしない」という単純なglobal flag/stateでよい。

### 7.1 Plan Revision後のsession再利用

変更が実行上軽微で旧contextが有効ならsame session resumeを許す。

一方、scope・acceptance criteria・assumptions・invariants・主要dependency等が変わり旧contextを信用できない場合は、旧sessionをretireしfresh Workerで再開する。

実装は可能な限りdeterministicなfield changeで判断し、daemonに意味推論させない。必要ならTerraのrevision artifactに明示的なresume/restart指示を持たせてもよいが、汎用workflow languageは作らない。

---

## 8. Session lifecycleとcleanup

subagent/session起動上限へ不要に近づかないよう、orchestratorがsession lifecycleを明示的に管理する。

概念状態:

```text
ACTIVE     現在実行中。保持必須
RESUMABLE  REWORK / rate-limit / crash / temporary pause。session ID保持
RETIRED    Task完了、fresh takeover、旧planで不要になったsession
CLEANUP    RETIRED sessionの安全な終了/削除
```

### 8.1 Reviewer session

Independent Reviewerは原則使い捨て。

review result/evidenceをdurable stateへ保存した後、そのreviewer sessionはretire/cleanupしてよい。

### 8.2 Implementation session

- REWORK中はsame session resumeのため保持
- temporary failure/rate-limit中はRESUMABLE
- Taskがauto-mergeされIssue closeしたらRETIRED→cleanup
- Recoveryへtakeoverした旧Primary sessionもRETIRED

### 8.3 sessionを証跡にしない

必要な情報はsession内だけに残さず、checkpoint/Git/Issue/run evidenceへ保存する。

最低限残すもの:

- task/commit/HEAD
- review result
- test/machine evidence
- failure reason
- checkpoint
- PLAN_CONFLICT evidence
- recovery attempt summary

provider側都合で古いsessionが消えても、完了済みTaskの正本/evidenceが失われない設計にする。

---

## 9. task-board / manifestの追加情報

既存の以下は維持する。

- Task ID / title
- state
- dependency / DAG
- completion criteria
- SAFE / EXCLUSIVE
- Human Gate
- allowed paths / scope
- tests
- common acceptance

今回、各Taskに必要に応じて次を追加する。

```yaml
assumptions:
  - このTaskが成立するために真である必要がある前提

invariants:
  - このTask実装中・完了後も崩してはいけない条件
```

例:

```yaml
assumptions:
  - dependency task AO-XXでcheckpoint schemaが確定済み
  - DB schema変更は不要

invariants:
  - backward compatibilityを維持する
  - production mutationは禁止
```

目的はPLAN_CONFLICTを明確に検出できるようにすることであり、複雑なconstraint DSLは作らない。**自由記述の配列で十分。**

Planning Terraは全Taskへ無意味なboilerplateを書く必要はない。実装判断やplan validityに関係する前提/不変条件だけを書く。

---

## 10. Human Gateを最小化する

通常フローでHuman Gateへ上げるのは原則次の3系統に限定する。

1. `REQUIREMENT_CONFLICT`
   - canonical requirementsの曖昧/矛盾
   - product/business choiceが必要
2. Recoveryまで自動回復を尽くしても解決できないpure implementation failure
3. canonical planで事前にHuman Gate指定された操作
   - production mutation
   - 不可逆/rollback困難
   - deploy/publication
   - credential/permission/financial/external-service等の重大操作

通常test failure、通常review REWORK、worker crash、rate-limit、PLAN_CONFLICTは、それだけでHuman Gateにしない。

---

## 11. Final Terra Acceptance

全Task auto-merge後、Terraがwhole-HANDOFF acceptanceを行う。

結果:

```text
PASS
  → HANDOFF DONE

REWORK
  → Terraがtask-boardへ修正Taskを追加/修正
  → Worker pipeline
  → Independent Reviewer
  → daemon auto-merge
  → 再度 Final Terra Acceptance

REQUIREMENT_CONFLICT
  → BLOCKED_HUMAN
```

Final Terraがエラーを発見しても、**Terra自身はコードを修正しない。**

Terraは不足をTask化する。実装はWorker、reviewはIndependent Reviewer、mergeはdeterministic gate後のdaemonが担当する。

これによりTerraの役割をPlanning / Plan Revision / Final Acceptanceに保つ。

---

## 12. authority matrix

| 操作 | User+ChatGPT | Terra | Worker | Reviewer | daemon |
|---|---:|---:|---:|---:|---:|
| canonical requirements変更 | YES | NO | NO | NO | NO |
| initial task-board/DAG作成 | - | YES | NO | NO | NO |
| task-board/DAG意味変更 | - | YES | NO | NO | NO |
| Task実装 | - | NO | YES | NO | NO |
| semantic implementation review | - | finalのみ | NO | YES | NO |
| PLAN_CONFLICT claim | - | - | YES | YES | NO |
| PLAN_CONFLICT confirmation | - | NO | NO | YES | NO |
| deterministic validation | - | NO | NO | evidence確認 | YES |
| normal Task merge | - | NO | NO | NO | YES |
| session scheduling/cleanup | - | NO | NO | NO | YES |
| final whole-product acceptance | - | YES | NO | NO | NO |

---

## 13. YAGNI / 今回やらないこと

この追加フェーズでは以下を実装しない。

- Qwen/Ollama/local model接続
- generic multi-provider worker router
- taskごとのworker/model指定
- multi-repo化
- dashboard/UI
- GitHub Projects化
- resource-name lock framework
- AI scheduler / AI polling
- generic policy language / workflow DSL
- 高度なsemantic loop detector
- 複雑なmerge queue
- Plan Revisionの高度なimpact analysis engine
- daemonによるrequirements rewrite

ただし将来providerを差し替えやすいよう、Primary Worker / Recovery Workerの責務境界だけはLuna固有ロジックと過度に混ぜない。

---

## 14. この追加フェーズのacceptance

Planning TerraはこのHANDOFFを読んで、既存AO-01〜AO-16を不用意に作り直さず、**既存実装との差分だけを新しいTask/DAGへ分解すること。**

実装完了時に少なくとも次を証明する。

1. 通常Taskの完了にTerra per-task reviewが不要になっている。
2. Independent Reviewer APPROVEだけではmergeせず、deterministic merge gatesをdaemonが再確認する。
3. 全gate PASS時にdaemonがnormal Taskを安全にmerge/closeできる。
4. reviewed HEADが変化した場合はmergeしない。
5. normal REWORK最大3回と早期STUCKが再現可能なfixture/testで証明される。
6. STUCKからfresh Recovery Workerへtakeoverできる。
7. RecoveryにもIndependent Reviewerが必須である。
8. Recovery exhausted時にPLAN_CONFLICT候補とpure implementation failureを混同しない。
9. PLAN_CONFLICT claimはIndependent Reviewer確認なしでTerraへ送られない。
10. task-board/DAGの意味変更をWorker/Reviewer/daemonが行わない。
11. REQUIREMENT_CONFLICTはHuman Gateへ止まる。
12. Plan Revision中にglobal merge barrierが働き、Worker全停止は要求しない。
13. Plan Revision後にboard/manifest再同期が行われる。
14. Task close後に不要sessionがretire/cleanupされる。
15. resumable sessionはcleanupされない。
16. task-board/manifestで `assumptions` / `invariants` を扱える。
17. Final Terra REWORKはTerra自身のcode fixではなく修正Task化される。
18. `npm test`, `npm run build`, `npm run lint` がPASSする。
19. daemonのnormal scheduler/polling/validation/merge decisionにLLM invocationを追加しない。
20. pilot-only / production safety等、今回変更していないv1境界を維持する。

### 実host installについて

AO-16のpackage-level verificationは既に完了しているが、実ホストへのLaunchAgent登録/有効化はHuman Gateのままとする。

**この追加要件の実装・最終acceptanceが完了するまでは、今回の流れの中で実host installを実行しない。**

---

## 15. Planning Terraへの指示

次工程のTerraは、まず以下を読むこと。

1. 本HANDOFF
2. `docs/HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md`
3. `docs/DESIGN_2026-08-31_AGENT_ORCHESTRATOR_V1.md`
4. `docs/task-boards/2026-08-31-agent-orchestrator-v1.md`
5. `tasks/agent-orchestrator-v1.yaml`
6. 現在のsource/tests/prompts/runbooks

そのうえで現行実装とのgapを確認し、追加Taskだけをtask-board / DAGへ分解する。

Planning時の重要ルール:

- いきなり実装しない。
- 既存AO-01〜AO-16のDONE evidenceを無視して作り直さない。
- 本HANDOFFと旧v1が矛盾する箇所は本HANDOFFを優先する。
- task-board/DAG変更はTerra自身が行う。
- `assumptions` / `invariants` をplan validityに必要なTaskへ付ける。
- task同士、dependency、scope、acceptance criteriaの矛盾を先に監査する。
- YAGNIを守り、Qwen/router/multi-repo等へscopeを広げない。
- 実host LaunchAgent installは行わない。
- task-board / machine manifest / 必要なplanning docsをGitへcommit/pushしてからPlanning完了を報告する。
