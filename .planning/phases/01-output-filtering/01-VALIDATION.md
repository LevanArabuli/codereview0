---
phase: 1
slug: output-filtering
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/dedup.test.ts tests/output.test.ts tests/formatter.test.ts tests/review-builder.test.ts tests/html-report.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/dedup.test.ts tests/output.test.ts tests/formatter.test.ts tests/review-builder.test.ts tests/html-report.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | FILT-01 | unit | `npx vitest run tests/dedup.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | FILT-01 | unit | `npx vitest run tests/dedup.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | FILT-01 | unit | `npx vitest run tests/dedup.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | FILT-02 | unit | `npx vitest run tests/output.test.ts` | ✅ extend | ⬜ pending |
| 01-02-02 | 02 | 1 | FILT-02 | unit | `npx vitest run tests/formatter.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | FILT-02 | unit | `npx vitest run tests/review-builder.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | FILT-02 | unit | `npx vitest run tests/html-report.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/dedup.test.ts` — stubs for FILT-01 dedup logic (new file)
- [ ] `tests/formatter.test.ts` — stubs for FILT-02 inline comment confidence (new file; formatter.ts has zero test coverage)
- [ ] `tests/review-builder.test.ts` — stubs for FILT-02 off-diff body confidence (new file; review-builder.ts has zero test coverage)
- [ ] Extend `tests/output.test.ts` — stubs for FILT-02 terminal confidence labels
- [ ] Extend `tests/html-report.test.ts` — stubs for FILT-02 HTML confidence labels

*Existing infrastructure covers framework setup. Wave 0 creates test files and stubs only.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
