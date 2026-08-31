# Agent Orchestrator v1 実装タスクボード

更新: 2026-08-31 JST
要件: [v1 requirements handoff](../HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md)
詳細設計: [v1 detailed design](../DESIGN_2026-08-31_AGENT_ORCHESTRATOR_V1.md)
機械正本: [`tasks/agent-orchestrator-v1.yaml`](../../tasks/agent-orchestrator-v1.yaml)
状態: **PLANNED — 実装未開始**

## 0. 境界と前提

- pilot は `/slot` 1 repository のみ。multi-repo、worker router、Ollama、独自 UI、GitHub Projects は作らない。
- daemon の LLM token 消費は 0。Luna/Terra 呼出しは task execution/review のみで、polling・DAG・validation・recovery に LLM を使わない。
- daemon は merge、production DB mutation、`/slot` Windows Scheduler、deploy を実行しない。
- `/slot` の既存 AGENTS/common operating rules を Luna/Terra prompt と Terra merge に優先適用する。
- 全実装 task は、machine validation PASS後に implementation Luna が起動する read-only reviewer subagent の independent review が PASSするまで完了ではない。REWORK は同じ implementation Luna session へ自動で戻して、修正→machine validation→reviewer subagentを繰り返す。task ごとの review 指示や人間による prompt 転送は不要である。
- reviewer subagent は implementation の reasoning/history を継承せず、task scope、source branch/HEAD、review packet のみを受け取る独立 agent context とする。subagent 起動を提供しない環境だけ、同じ review contract の別 Luna session をフォールバックにする。Terra は独立 review の依頼・指示・再依頼をしない。Terra の責務は reviewer PASS 後の semantic approval/merge のみである。
- `tasks/agent-orchestrator-v1.yaml` の `workerCompletionContract` と [Luna implementation prompt template](../../prompts/luna-implementation-task.md) は、**すべての implementation Luna 起動 prompt にそのまま注入する実行契約**である。管理者は individual review prompt を発行せず、implementation Luna 自身が同一 session 内で reviewer subagent を起動し、`APPROVE` まで rework loop を完結させる。subagent capability が実際に無い場合だけ、その事実を structured result で返して停止し、フォールバックを判断する。
- `AO-14` は `/slot` の disposable/documentation-only task だけで受入する。live runtime 変更は Human Gate の別 task とする。

## 1. 依存関係

```text
AO-02 ──┬─ AO-01 ─┬─ AO-04 ─┬─ AO-07 ─┬─ AO-09 ─┬─ AO-11 ─┬─ AO-13 ─ AO-14 ─ AO-15
        │          │          │          │          │          │
        ├─ AO-03 ─┼─ AO-05 ──┘          │          └─ AO-12 ─┘
        └─ AO-06 ─┘                     │
AO-08 ───────────────────────────┘
AO-10 ─────────────────────────────────────────────┘

AO-16 (launchd) depends on AO-13 and is independent of AO-14/15.
```

## 2. 実装タスク

### 全 Task の共通完了条件

表中の各 Task は、固有の完了条件に加え、以下をすべて満たして初めて完了とする。

1. 指定 test と関連 build/lint/test が PASS し、machine validation が PASS する。
2. implementation Luna の structured completion result が `independentReview: required` を返す。
3. implementation Luna が起動する read-only reviewer subagent の independent review が PASS する。
4. 独立 review が REWORK を返した場合、同じ implementation Luna session/worktree/branch で修正し、1〜3 を PASS するまで繰り返す。
5. Luna review PASS 後に限り Terra semantic approval/merge へ進む。

reviewer subagent の標準 prompt は implementation Luna が `workerCompletionContract` を受けて同一 session 内で起動するため、各 Task や Terra に review 用の別指示を追加しない。subagent 非対応環境だけ structured result の capability failure を根拠に、同じ prompt を別 Luna session に渡す。

| ID | Task | 状態 | 依存 | Parallel | 完了条件 |
|---|---|---|---|---|---|
| AO-01 | Codex CLI lifecycle contract spike | PLANNED | AO-02 | SAFE | installed Codex の `exec --json` / `exec resume` から session ID・正常終了・rate-limit/crash の観測可能な契約を fixture と adapter test に固定する。未確認の output を推測しない。 |
| AO-02 | Node/TS scaffold と設定/schema | PLANNED | — | SAFE | build/lint/test と pilot-only config、manifest/checkpoint/review-result schema が成立する。generic worker abstraction は作らない。 |
| AO-03 | canonical task manifest loader | PLANNED | AO-02 | SAFE | YAML manifest を parse/validate し、duplicate ID/cycle/unknown dependency/invalid parallel を fail closed にする。Markdown は生成対象であり parser にしない。 |
| AO-04 | local checkpoint store | PLANNED | AO-01, AO-02 | SAFE | atomic write、state migration、retry/attempt/session fields、restart load を unit test で証明する。checkpoint に仕様・secret を保存しない。 |
| AO-05 | GitHub Issue projector/reader | PLANNED | AO-02, AO-03 | SAFE | labels、parent/sub-issue、blocking relation、idempotent marker、排他的 state label、Issue snapshot を fake `gh` integration で証明する。Projects は使わない。 |
| AO-06 | Git/worktree adapter | PLANNED | AO-02 | SAFE | task 専用 branch/worktree の作成・再利用、remote/HEAD/status/changed files/scope/ancestor 判定を disposable repo で証明する。main merge は実装しない。 |
| AO-07 | Luna runner/process monitor | PLANNED | AO-01, AO-04, AO-06 | SAFE | new/resume process、JSONL log、PID/session capture、有限 retry、exit/recovery event を fake Codex で検証する。AI に exit reason を解釈させない。 |
| AO-08 | machine validator と review packet | PLANNED | AO-02, AO-03, AO-06 | SAFE | push/clean/changed paths/test/dependency の PASS/FAIL evidence と compact packet を生成する。semantic review/merge はしない。 |
| AO-09 | deterministic scheduler | PLANNED | AO-04, AO-05, AO-07, AO-08 | EXCLUSIVE | ready 条件、bounded SAFE concurrency、EXCLUSIVE serialization、state transition の table-driven test が PASS する。priority optimizer/lock framework は作らない。 |
| AO-10 | Terra review runner/result parser | PLANNED | AO-01, AO-02 | SAFE | saved Terra session に packet を送信し、schema-valid APPROVE/REWORK/BLOCKED_HUMAN だけを受理する。new Terra session の自動作成はしない。 |
| AO-11 | reviewer subagent/rework/merge-close controller | PLANNED | AO-09, AO-10 | EXCLUSIVE | machine validation→implementation Luna の reviewer subagent→Terra semantic approval の順序、Luna/Terra REWORK の same Luna session dispatch、Terra APPROVE 後の remote-base ancestor 確認→Issue close、BLOCKED_HUMAN stop を integration test で証明する。subagent 非対応時だけ別 Luna session を使う。daemon merge は禁止。 |
| AO-12 | startup reconcile と rate-limit pause | PLANNED | AO-04, AO-07, AO-08, AO-10 | SAFE | checkpoint/Issue/process/Git の代表不整合を安全に復元し、rate limit は pause→same session resume となる。reboot で完了済み task を再実行しない。 |
| AO-13 | daemon CLI/logging/operational runbook | PLANNED | AO-09, AO-11, AO-12 | EXCLUSIVE | bootstrap/run-once/daemon/reconcile/status の CLI と privacy-safe log、operator runbook、failure diagnosis がある。web dashboard は作らない。 |
| AO-14 | `/slot` non-production pilot acceptance | PLANNED | AO-13 | EXCLUSIVE | two SAFE tasks、EXCLUSIVE task、review/rework、restart/rate-limit fixture scenario を実証し、結果を Git に残す。production DB/Scheduler は触らない。 |
| AO-15 | final acceptance と durable evidence | PLANNED | AO-14 | EXCLUSIVE | v1 acceptance 1–18 の evidence matrix と既知制約を記録し、Terra final acceptance を実施する。 |
| AO-16 | launchd packaging/install verification | PLANNED | AO-13 | EXCLUSIVE | LaunchAgent template/install/uninstall/status runbook と non-destructive verification を作る。実 host install は operator が明示実行する。 |

## 3. 実装順の運用

1. AO-02 が test scaffold と strict schema の基盤を先に提供する。AO-01/AO-03 はこれを取り込んだ後に並列開始し、推測した Codex output へ依存しない。
2. AO-04〜08 は fake external command/disposable repo を用いて並列に実装・reviewできる。
3. AO-09〜13 で controller を統合する。AO-09/11/13 は state transition を触るため EXCLUSIVE とする。
4. AO-14 は `/slot` main の稼働中作業と切り離した worktree、read-only/disposable task のみで行う。
5. AO-15 が要件全体の final acceptance、AO-16 が OS 常駐の独立した packaging task である。どちらも daemon 自身による OS/production mutationは行わない。

## 4. 共通 acceptance

- manifest/Issue/checkpoint の不整合は silent dispatch せず fail closed にする。
- state transition、GitHub API、DAG、process、validation、recovery は fixture/integration test で再現可能にする。
- normal scheduler loop と validator に LLM invocation がないことを command-level test で確認する。
- worker-done の task は Terra に送る前に必ず implementation Luna の read-only reviewer subagent を通し、PASSしなければ完了しない。REWORK 後も修正→validation→reviewer subagentを繰り返し、この review を省略しない。review dispatch は implementation Luna の structured completion result を契機に自動化し、task ごとの別指示を要求しない。subagent 非対応時だけ別 Luna session を使う。
- worker task は target repo の Git rules を読み、branch/worktree 内でのみ edit/test/commit/push を行う。
- Issues は Git task-board のポインタであり、Issue 本文を仕様正本にしない。

## 5. Human Gate

- AO-14: `/slot` production DB、Windows single-writer runtime、Scheduler、deploy に触れる実験へ拡張する場合は、その操作を別 Issue にし明示 GO を要求する。
- AO-16: LaunchAgent を実 host に登録・有効化する操作は、runbook による operator の明示実行とする。
- それ以外の branch 内 implementation、test、commit/push、review/rework には人間の prompt 転送・個別 GO を要求しない。
