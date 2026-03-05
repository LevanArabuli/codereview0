# Requirements: codereview — Agent Team Support

**Defined:** 2026-03-05
**Core Value:** Every PR gets thorough, multi-dimensional review coverage by running specialized agents in parallel

## v1 Requirements

### Parallel Orchestration

- [x] **ORCH-01**: Tool spawns a single `claude` CLI session whose prompt instructs it to use built-in subagents (Task tool) to run 4 parallel aspect reviewers (security, performance, code quality, test coverage)
- [x] **ORCH-02**: The lead Claude session manages subagent lifecycle internally; partial aspect failure does not abort the full review
- [x] **ORCH-03**: Parallel review works in quick mode (lead session receives PR diff, dispatches to subagents)
- [x] **ORCH-04**: Parallel review works in deep mode (lead session has cloned repo access, dispatches to subagents)
- [ ] **ORCH-05**: Tool gracefully degrades to single-agent review when parallel mode is opted out via `--no-team` flag
- [x] **ORCH-06**: Each aspect agent receives a focused, expert-scoped prompt for its domain (not a generalist prompt)

### Finding Synthesis

- [x] **SYNTH-01**: Tool deduplicates findings across aspects using file + line + description similarity
- [x] **SYNTH-02**: `ReviewFinding` schema has optional `aspect` field (`'security' | 'performance' | 'quality' | 'tests'`)
- [x] **SYNTH-03**: All aspect findings merge into a single `ReviewFinding[]` array (backwards-compatible with existing output)
- [ ] **SYNTH-04**: Terminal output shows aspect summary headers with finding counts ("Security: 3 findings", "Performance: no issues")

### Output

- [ ] **OUT-01**: Terminal output groups findings by aspect with clear section headers
- [ ] **OUT-02**: Per-aspect progress indicators shown during review ("Analyzing security... done")

### Security

- [x] **SEC-01**: `filterEnv()` extended to scrub `ANTHROPIC_BASE_URL` from subprocess environment
- [x] **SEC-02**: Credential scrubbing (`scrubSecrets()`) applied to all 4 agent outputs before display

## v2 Requirements

### Output Extensions

- **OUT-03**: GitHub review comments grouped by aspect sections
- **OUT-04**: HTML report renders aspect-grouped sections with collapsible views
- **OUT-05**: Per-agent cost and duration displayed in `--verbose` mode

### Orchestration Extensions

- **ORCH-07**: Cost warning output alerting users to 4-7x token cost increase

## Out of Scope

| Feature | Reason |
|---------|--------|
| DIY parallel `claude -p` subprocesses from our tool | Single session with internal subagents is simpler and lets Claude manage parallelism |
| Configurable aspect selection (`--aspects` flag) | Fixed four aspects is simpler; revisit if users request |
| Inter-agent debate/challenge patterns | Expensive token cost, contradictory output risk |
| Real-time per-agent streaming to terminal | Interleaved output from 4 agents is unreadable |
| Per-file agent parallelism | Aspects are the semantic unit; files are not independent |
| Custom aspect definitions / plugin system | 4-dep budget, no extension framework |
| Interactive agent team display modes (tmux/split) | Non-interactive CLI tool |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ORCH-01 | Phase 1 | Complete |
| ORCH-02 | Phase 1 | Complete |
| ORCH-03 | Phase 1 | Complete |
| ORCH-04 | Phase 1 | Complete |
| ORCH-05 | Phase 1 | Pending |
| ORCH-06 | Phase 1 | Complete |
| SYNTH-01 | Phase 1 | Complete |
| SYNTH-02 | Phase 1 | Complete |
| SYNTH-03 | Phase 1 | Complete |
| SYNTH-04 | Phase 2 | Pending |
| OUT-01 | Phase 2 | Pending |
| OUT-02 | Phase 2 | Pending |
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements defined: 2026-03-05*
*Last updated: 2026-03-05 after roadmap revision to 2 phases*
