---
phase: 04
slug: context-aware-review-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (inferred from package.json) |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PROMPT-02 | unit | `npx vitest run tests/prompt.test.ts` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | PROMPT-02 | unit | `npx vitest run tests/prompt.test.ts` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | PROMPT-04 | unit | `npx vitest run tests/prompt.test.ts` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 2 | PROMPT-04 | unit | `npx vitest run tests/prompt.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Vitest framework installed, 304+ tests already passing, prompt tests and eval fixtures provide strong regression coverage.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Convention findings reference patterns | PROMPT-04 | Requires real repo + Claude analysis | Run `npx tsx src/cli.ts --deep <PR>` on a real PR and verify findings cite convention evidence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
