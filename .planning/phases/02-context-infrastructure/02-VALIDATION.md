---
phase: 2
slug: context-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/context.test.ts tests/prompt.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/context.test.ts tests/prompt.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | CTX-03 | unit | `npx vitest run tests/context.test.ts -t "ReviewContext"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | CTX-02 | unit | `npx vitest run tests/context.test.ts -t "import parsing"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | CTX-02 | unit | `npx vitest run tests/context.test.ts -t "naming patterns"` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | CTX-02 | unit | `npx vitest run tests/github.test.ts -t "fetchFileContent"` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | CTX-02 | unit | `npx vitest run tests/context.test.ts -t "budget"` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | CTX-01 | unit | `npx vitest run tests/prompt.test.ts -t "exploration guidance"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | CTX-02 | unit | `npx vitest run tests/prompt.test.ts -t "related files"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/context.test.ts` — stubs for CTX-02, CTX-03 (import parsing, naming patterns, file fetching, budget enforcement, deduplication)
- [ ] New tests in `tests/prompt.test.ts` — stubs for CTX-01 (structured exploration guidance in deep mode prompt), CTX-02 (related files in quick mode prompt)
- [ ] New tests in `tests/github.test.ts` — stubs for `fetchFileContent()` with mock Octokit

*Existing infrastructure covers test framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Context gathering latency | CTX-02 | Network-dependent | Run quick review on a real PR with `--verbose`, verify context fetch adds <5s |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
