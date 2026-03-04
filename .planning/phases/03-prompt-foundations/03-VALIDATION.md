---
phase: 3
slug: prompt-foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/prompt.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/prompt.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | PROMPT-01 | unit | `npx vitest run tests/prompt.test.ts -t "anti-example"` | Needs new assertions | ⬜ pending |
| 03-01-02 | 01 | 1 | PROMPT-03 | unit | `npx vitest run tests/prompt.test.ts -t "severity"` | Needs new assertions | ⬜ pending |
| 03-01-03 | 01 | 1 | PROMPT-01, PROMPT-03 | integration | `npx vitest run tests/eval.test.ts` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test assertions in `tests/prompt.test.ts` for anti-example content (PROMPT-01)
- [ ] New test assertions in `tests/prompt.test.ts` for severity examples presence and identity across modes (PROMPT-03)

*Existing eval infrastructure covers regression testing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Anti-examples actually reduce false positives | PROMPT-01 | Requires running against real PRs | Review a known-noisy PR before and after prompt changes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
