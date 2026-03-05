---
phase: 1
slug: orchestration-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest v4.0.18 |
| **Config file** | Implicit (vitest resolves from package.json `"test": "vitest run"`) |
| **Quick run command** | `npx vitest run tests/orchestrator.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/orchestrator.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | SYNTH-02 | unit | `npx vitest run tests/schemas.test.ts -t "aspect"` | No -- indirect via analyzer.test.ts | ⬜ pending |
| 01-02-01 | 02 | 1 | ORCH-06 | unit | `npx vitest run tests/prompt.test.ts -t "aspect"` | Partially (prompt.test.ts exists) | ⬜ pending |
| 01-03-01 | 03 | 2 | ORCH-01 | unit | `npx vitest run tests/orchestrator.test.ts -t "team"` | No -- Wave 0 | ⬜ pending |
| 01-03-02 | 03 | 2 | ORCH-02 | unit | `npx vitest run tests/orchestrator.test.ts -t "partial"` | No -- Wave 0 | ⬜ pending |
| 01-03-03 | 03 | 2 | ORCH-03 | unit | `npx vitest run tests/orchestrator.test.ts -t "quick"` | No -- Wave 0 | ⬜ pending |
| 01-03-04 | 03 | 2 | ORCH-04 | unit | `npx vitest run tests/orchestrator.test.ts -t "deep"` | No -- Wave 0 | ⬜ pending |
| 01-04-01 | 04 | 2 | ORCH-05 | unit | `npx vitest run tests/cli.test.ts -t "no-team"` | No -- no cli.test.ts | ⬜ pending |
| 01-05-01 | 05 | 2 | SYNTH-01 | unit | `npx vitest run tests/orchestrator.test.ts -t "dedup"` | No -- Wave 0 | ⬜ pending |
| 01-05-02 | 05 | 2 | SYNTH-03 | unit | `npx vitest run tests/orchestrator.test.ts -t "merge"` | No -- Wave 0 | ⬜ pending |
| 01-06-01 | 06 | 1 | SEC-01 | unit | `npx vitest run tests/security.test.ts -t "ANTHROPIC_BASE_URL"` | Partially (security.test.ts exists) | ⬜ pending |
| 01-06-02 | 06 | 1 | SEC-02 | static | `npx vitest run tests/security.test.ts -t "scrub"` | Partially (security.test.ts exists) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/orchestrator.test.ts` — stubs for ORCH-01, ORCH-02, ORCH-03, ORCH-04, SYNTH-01, SYNTH-03
- [ ] New tests in `tests/prompt.test.ts` — stubs for ORCH-06 (aspect overlay tests)
- [ ] New test in `tests/security.test.ts` — stub for SEC-01 (ANTHROPIC_BASE_URL filtering)

*Existing infrastructure covers framework install — Vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 4 concurrent processes visible in process table | ORCH-01 | Requires live Claude CLI | Run `codereview <url>` and verify 4 `claude` processes in `ps aux` |
| Deep mode cloned repo accessible to all agents | ORCH-04 | Requires live repo clone | Run with `--deep` and verify all 4 agents produce findings |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
