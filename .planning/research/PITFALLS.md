# Pitfalls Research

**Domain:** Claude Code agent teams integration into an existing production CLI code review tool
**Researched:** 2026-03-05
**Confidence:** HIGH (official Claude Code docs, changelog, security research, multiple community sources)

---

## Critical Pitfalls

### Pitfall 1: Conflating Agent Teams with Non-Interactive (`-p`) Mode

**What goes wrong:**
The existing codebase uses `claude -p` for quick mode and `spawn('claude')` for deep mode — both non-interactive subprocess invocations. Agent teams are an interactive feature: the lead session must be running interactively for teammates to spawn, communicate, and be coordinated. Attempting to invoke a team session via `claude -p` does not spawn teammates; it falls back to a single-agent session silently or produces output that contains only the lead's findings without teammate results.

**Why it happens:**
Developers assume the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var activates the feature for all invocation modes. In practice, teammate spawning requires the Claude Code TUI (interactive session) to be active. The official docs describe the flow from an interactive perspective; the non-interactive (`-p`/`--print`) path behavior with agent teams is not explicitly documented as guaranteed.

**How to avoid:**
Treat agent teams as a prompt-driven behavior of the lead's agentic session, not as a CLI flag. The integration approach must use `spawn('claude')` with `--output-format stream-json` and structure the prompt to instruct the lead session to create a team internally. The lead's result event in the stream-json output will contain synthesized findings from all teammates. Verify with a controlled test that teammate spawning actually occurs when invoked non-interactively before building the full pipeline on top of this assumption.

**Warning signs:**
- Output from the agent session shows no teammate activity in stderr stream
- The final result contains only one model's perspective on the PR
- Session duration is similar to a single-agent agentic review

**Phase to address:**
Proof-of-concept validation phase (earliest phase). This is the foundational assumption the entire milestone rests on. Must be proven before any other work begins.

---

### Pitfall 2: Token Cost Explosion Without User Awareness

**What goes wrong:**
A 4-agent team (lead + 3 aspect reviewers) does not cost 4x a single review. It costs 4-7x depending on context window usage per teammate. The official docs state agent teams use "approximately 7x more tokens than standard sessions when teammates run in plan mode." Each teammate loads its own context: `CLAUDE.md`, project structure, spawn prompt, and the full PR diff. For a single deep review that costs $0.50, the agent team version may cost $2-5. Users running this on large PRs (80KB+ diffs) or with Opus model will face costs in the $10-20+ range per review.

**Why it happens:**
Each teammate is a full independent Claude Code instance. The PR diff is provided to every teammate in their spawn prompt — meaning 4 teammates each receive the full diff in their context. Coordination messages between teammates add additional token overhead on top of this baseline multiplication.

**How to avoid:**
- Default teammates to Sonnet (not Opus) regardless of what the lead uses
- Include explicit cost warning in CLI output before starting a team review, showing estimated multiplier
- Expose `--model` flag granularity: `--lead-model` and `--agent-model` separate options
- Set a max-turns limit per teammate that is lower than the agentic review default (75) — each aspect reviewer needs fewer turns than a full review
- Keep spawn prompts short: each additional token in the spawn prompt is paid once per teammate

**Warning signs:**
- Users reporting unexpectedly high Anthropic API bills
- Review operations that previously took 10-15 minutes now taking 45+ minutes
- Context window exhaustion messages in teammate stderr

**Phase to address:**
Implementation phase for the analyzer module. Cost transparency must be built in from the first implementation, not added retroactively.

---

### Pitfall 3: Credential Leakage Through Teammate Environment Inheritance

**What goes wrong:**
The existing `filterEnv()` function strips dangerous env var prefixes before passing the environment to the Claude CLI subprocess. When agent teams are enabled, the lead session spawns teammates using its own permission settings and environment. The teammates are not spawned by this tool directly — they are spawned internally by Claude Code. The env filtering applied to the lead subprocess may not apply to teammate subprocesses spawned within Claude Code's internal orchestration. If the lead receives filtered env, but Claude Code itself re-reads `process.env` when spawning teammates, dangerous env vars could be re-exposed to teammate sessions.

**Why it happens:**
The current security model assumes a single subprocess boundary: parent process (this tool) -> Claude CLI subprocess. With agent teams, there is an additional boundary: Claude CLI lead -> Claude CLI teammate. This second boundary is not controlled by `filterEnv()`.

**How to avoid:**
- Pass `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` explicitly in the filtered env, not relying on the user's shell environment
- Verify that teammates inherit env from the lead subprocess (not from the parent tool process) by checking Claude Code's internal spawn behavior
- Until confirmed safe: treat this as an accepted risk per the existing `filterEnv()` blocklist approach and document it in SECURITY.md alongside the existing env filtering limitation
- The Check Point Research CVE-2025-59536 / CVE-2026-21852 disclosures showed that Claude Code itself had env-based exfiltration vulnerabilities via `ANTHROPIC_BASE_URL` redirection — ensure the tool is running a patched Claude Code version and that `ANTHROPIC_BASE_URL` is scrubbed or overridden in the filtered env

**Warning signs:**
- Teammate stderr showing references to env vars that were supposed to be filtered
- API calls going to unexpected endpoints (indicating ANTHROPIC_BASE_URL manipulation)

**Phase to address:**
Security review phase, before any production deployment. Add explicit test to `security.test.ts` covering the multi-agent env boundary.

---

### Pitfall 4: Output Aggregation Assumes Lead Synthesizes — It Does Not Guarantee It

**What goes wrong:**
The project plan calls for the lead to "synthesize and deduplicate findings across aspect agents." This is a prompt-engineering expectation, not a structural guarantee. The lead agent decides whether and how to synthesize based on its prompt and its own discretion. In practice: (1) the lead may report its own findings and a summary of teammate findings rather than a merged list; (2) deduplication quality varies — two teammates citing the same security issue will produce duplicate findings in the final JSON unless the synthesis prompt explicitly instructs deduplication; (3) if a teammate hits max-turns or errors, the lead may synthesize from partial findings without indicating the gap.

**Why it happens:**
Agent teams are designed for open-ended collaboration, not structured JSON output aggregation. The JSON output format (`ReviewFinding[]`) is this tool's schema, not Claude Code's native output. The synthesis step is emergent behavior from the prompt, not a built-in aggregation pipeline.

**How to avoid:**
- Design the lead prompt explicitly: "You will receive findings from three aspect reviewers. Merge all findings into a single JSON array. If two findings describe the same issue at the same file/line, keep the more detailed one. Label each finding with its source aspect."
- Add an `aspect` field to `ReviewFindingSchema` to track provenance
- Post-process the merged findings list in the tool itself (not just the prompt) to detect near-duplicates (same file, same line range, same severity)
- The lead prompt should instruct teammates to report findings in the same JSON schema the tool uses, making synthesis a merge operation rather than a translation step

**Warning signs:**
- Findings array contains duplicates with different descriptions for the same location
- Findings count is lower than expected (lead dropped teammate findings)
- The result text contains prose synthesis paragraphs rather than structured JSON

**Phase to address:**
Prompt engineering phase and schema design phase. The `aspect` field addition and deduplication logic should be designed before writing any integration code.

---

### Pitfall 5: Graceful Degradation Is Not Automatic — It Requires Explicit Detection

**What goes wrong:**
The project requires fallback to single-agent review if agent teams are unavailable. "Unavailable" can mean: Claude Code version too old to support the feature, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` not set, or the feature being removed/changed in a Claude Code update. Without explicit feature detection, the tool will either: (a) succeed but run a single-agent review silently (worst case — no indication teams were skipped), or (b) fail with an opaque error from Claude Code internals.

**Why it happens:**
There is no `claude --list-features` or equivalent capability probe. Feature detection must be done by parsing Claude Code's version string or by attempting the feature and catching specific failure signals in the stream output.

**How to avoid:**
- Implement a feature probe: check Claude Code version via `claude --version` and compare against the minimum version where agent teams are confirmed available
- Alternatively, treat `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` presence as the capability gate: if the env var is not set in the user's environment, skip teams entirely and run single-agent with a notice
- In the stream-json output, watch for specific error signals that indicate teammate spawn failure; on detecting these, abort the team attempt and re-run as single-agent
- Make the degradation visible to the user: print "Agent teams unavailable — running single-agent review" rather than silently falling back

**Warning signs:**
- Review completes in normal single-agent time when team review was expected
- No teammate activity in stderr during the review
- Claude Code update breaks the feature without a code change on this tool's side

**Phase to address:**
Implementation phase. Feature detection and fallback must be built into the initial version, not treated as an enhancement.

---

### Pitfall 6: Timeout Calculation Ignores Parallel Session Wall-Clock Time

**What goes wrong:**
The current deep review timeout is 10 minutes. With agent teams, the wall-clock time is approximately the time of the slowest teammate, not the sum of all teammate times (because they run in parallel). However, the token consumption is much higher, and rate limits scale by TPM (tokens per minute). If the API rate limit is 200k TPM and 4 teammates each consume 50k tokens simultaneously, the effective throughput is constrained by the rate limit, causing exponential slowdown rather than parallel speedup. In practice, the 10-minute wall-clock timeout may not be sufficient for the lead to: spawn teammates, wait for all teammates to complete, and synthesize results.

**Why it happens:**
Single-agent agentic timeout = time for one agent to complete. Multi-agent timeout needs to account for: spawn overhead, teammate coordination latency, synthesis step, and potential rate limit throttling across 4+ parallel API consumers. The official docs note "agent teams add coordination overhead."

**How to avoid:**
- Set a separate, longer timeout for team reviews (e.g., 20-25 minutes) — not simply 4x the single-agent timeout
- Add progress output showing teammate status to stderr during the wait (prevents users from thinking the tool is hung)
- Implement per-teammate max-turns limits lower than the full review default — each aspect reviewer should complete faster than a unified review

**Warning signs:**
- Team reviews timing out at 10 minutes with incomplete results
- Rate limit errors appearing in stderr (HTTP 429 from Anthropic API)
- Users reporting the tool appears hung with no progress output

**Phase to address:**
Implementation phase, timeout configuration. Handle alongside the `analyzeAgentic()` rework.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single timeout for all review modes | Simple code | Team reviews time out prematurely at 10 min | Never — team reviews need their own timeout constant |
| Reuse `analyzeAgentic()` for team review | Less new code | Mixes single-agent and team logic in one function, making both harder to test | Only during initial PoC; refactor before merge |
| Let the lead handle all deduplication via prompt | No post-processing code | Inconsistent deduplication quality; untestable behavior | Only if deduplication quality is acceptable in testing; add code-level dedup as safety net |
| Skip `aspect` field in schema | Faster initial implementation | Cannot distinguish which agent found what; breaks grouped output in terminal and HTML | Never — adding a field later requires a schema migration and breaks existing tests |
| Same model for lead and all teammates | Simpler CLI flags | Unnecessarily high cost for routine aspect agents | Never — default teammates to Sonnet, Opus is too expensive for parallel workers |
| Assume agent teams always activates from env var | Simpler code | Silent fallback with no user feedback if feature is unavailable | Never — explicit feature detection is a one-time cost |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code agent teams + `--output-format stream-json` | Assuming the final `result` event has the same single-session shape when teams are active | Verify that the final result event structure is identical whether or not teams are used; the lead's result is what gets emitted regardless of internal team coordination |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env var | Setting it in `filterEnv()` output without explicitly controlling whether teams activate | Treat this env var as a feature gate controlled by this tool, not inherited from the user's shell; set it deliberately or withhold it deliberately |
| Multi-agent stderr output | Treating all stderr as a single agent's exploration output | With teams, stderr may contain interleaved output from multiple agents, making real-time parsing unreliable; scrub and stream as before, but do not attempt to parse structure from it |
| Team cleanup after review | Not cleaning up team resources if the subprocess is killed mid-review | Ensure `try/finally` and SIGINT handler explicitly handle the case where a team was started; Claude Code may leave `~/.claude/teams/{name}/` directories behind |
| Credential scrubbing for teammate output | Only scrubbing the lead's result, not intermediate teammate messages visible in stream | All stream output must pass through `scrubSecrets()` — teammates may echo back credentials from error messages the same as a single agent would |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Broadcasting the full PR diff to all teammates | 4x token cost on diff delivery alone | Pass diff to lead; lead distributes aspect-specific context to each teammate in spawn prompt | Any PR; worsens with diff size |
| Not capping per-teammate max-turns | Runaway teammate consuming tokens past useful contribution | Set `--max-turns` per teammate in the spawn prompt (Claude allows per-agent turn limits) | Complex PRs where one aspect reviewer gets stuck exploring |
| Synchronous wait for slowest teammate | Review blocked on one slow agent while others finished early | Nothing to do here — agent teams inherently wait for all teammates; ensure per-teammate timeouts exist | PRs with complex security surface (security agent takes much longer than others) |
| 10MB stdout buffer for stream-json with teams | Buffer overflow on large team sessions with verbose output | Increase or remove `MAX_BUFFER` for team reviews, or move to streaming parse; team sessions produce more total output than single-agent | PRs with >20 findings per agent combined with verbose mode |
| Accumulating stderr without bounds in team mode | Memory growth proportional to team size | Apply same stream buffering concern that exists in the current `analyzeAgentic()` — even more important with 4x output | Long-running team sessions; verbose mode |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not scrubbing teammate stderr before writing to terminal | Teammates may echo sensitive env vars from error messages | Apply `scrubSecrets()` to all stderr output, including any teammate output visible via the lead's stream |
| Trusting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` from user env | User could have a non-standard Claude Code build or override the env var to force unexpected behavior | Control this env var explicitly in `filterEnv()` — either always set it to `"1"` when teams are wanted, or strip it from the filtered env when falling back |
| Not stripping `ANTHROPIC_BASE_URL` from filtered env | CVE-2026-21852: attackers can redirect API traffic via this var in Claude Code project files | Add `ANTHROPIC_BASE_URL` to `DANGEROUS_EXACT` set in `filterEnv()` unless it needs to be overridden for enterprise use; document the risk |
| Spawning teams with `--dangerously-skip-permissions` | All teammates inherit this flag; each teammate can then execute arbitrary commands with the same permission escalation | Never use `--dangerously-skip-permissions` in team review mode; this is even higher risk than single-agent because multiple simultaneous agents have the escalated access |
| Leaving team resource directories after review | Orphaned `~/.claude/teams/` and `~/.claude/tasks/` directories may persist sensitive data from the reviewed PR | Add cleanup of these directories to the try/finally cleanup logic alongside clone directory cleanup |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No indication that teams mode is active | User cannot tell if they got a team review or a single-agent fallback | Print "Running 4-agent team review (security, performance, quality, tests)" at start; print "Single-agent review (agent teams unavailable)" when degraded |
| Cost surprise on first team review | User gets an unexpectedly large API bill without warning | Print estimated cost multiplier before starting team review: "Note: Agent team reviews use approximately 4-7x tokens of a single review" |
| Grouping findings by aspect confuses users unfamiliar with the feature | Grouped output looks broken if user expected flat finding list | Keep flat output as default; group by aspect only when using team mode; explain grouping in output header |
| Long silence during team coordination | User thinks the tool is hung during teammate spawning and synthesis | Stream real-time progress indicators showing teammate status ("Security agent: working...", "Performance agent: done (12 findings)") |
| No distinction between "aspect not covered" vs "no findings in aspect" | Empty security findings could mean perfect security or a failed security agent | Mark each aspect explicitly: "Security: 3 findings" or "Security: 0 findings" — not just omitting sections with no findings |

---

## "Looks Done But Isn't" Checklist

- [ ] **Agent team activation**: Appears to run in team mode (env var set), but verify that teammate spawning actually occurs — check stderr for teammate activity signals before declaring integration working
- [ ] **Deduplication**: The result JSON looks clean, but verify by testing with two teammates reviewing the same issue — the dedup logic must handle the same finding from two sources
- [ ] **Fallback transparency**: The fallback to single-agent "works" — verify it also prints a user-visible message instead of silently running single-agent
- [ ] **Cost reporting**: `meta.cost_usd` is reported — verify it aggregates cost across all teammates, not just the lead session
- [ ] **Credential scrubbing in team mode**: `scrubSecrets()` is called — verify it is called on ALL stream output, not just the final result parsing path
- [ ] **Cleanup completeness**: Clone directory is cleaned up — verify `~/.claude/teams/` and `~/.claude/tasks/` entries are also cleaned up after a team review

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Agent teams don't work in non-interactive subprocess mode | HIGH | Pivot to DIY parallel subprocesses: spawn 4 `claude -p` processes (one per aspect), collect results in parallel, merge findings in tool code; this is a different architecture than the agent teams API but achieves the same user outcome |
| Token costs too high in production | MEDIUM | Switch all teammates to a cheaper model, reduce max-turns per teammate, or reduce from 4 aspects to 2 (security + quality); consider making team reviews opt-in via `--team` flag rather than default |
| Deduplication quality too low (too many duplicates) | MEDIUM | Add code-level post-processing: cluster findings by (file, line range, severity), keep the most detailed description from each cluster; this is deterministic and testable unlike prompt-level dedup |
| Security finding about env filtering through teammate boundary | HIGH | Add `ANTHROPIC_BASE_URL` and other redirection vars to blocklist; audit all env vars passed to the lead subprocess; document the residual risk in SECURITY.md |
| Breaking change in agent teams experimental API | HIGH | Version-pin Claude Code CLI requirement; add integration test that runs a minimal team session against a fixture PR to detect format changes before they reach users |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Agent teams incompatible with non-interactive subprocess | Phase 1: Proof-of-concept validation | Spike: invoke `spawn('claude')` with team prompt, verify teammate activity in stream output |
| Token cost explosion | Phase 1 (design) + Phase 2 (implementation) | Test with a small PR; measure actual cost multiplier before full integration |
| Credential leakage through teammate env | Phase 2: Security review | Add test to `security.test.ts`; audit what env the lead subprocess receives vs what teammates inherit |
| Output aggregation not guaranteed by prompt alone | Phase 2: Schema design + prompt engineering | Test with a PR containing a known issue that two agents would both catch; verify dedup logic |
| Graceful degradation is not automatic | Phase 2: Implementation | Integration test with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset; verify fallback message prints |
| Timeout too short for team coordination | Phase 2: Implementation | Run a mid-size PR through team review; measure wall-clock time |
| Orphaned team resource directories | Phase 3: Cleanup + hardening | Manual test: kill tool mid-review with Ctrl+C; verify no `~/.claude/teams/` residue |
| `aspect` field omitted from schema | Phase 2: Schema design | Verify `ReviewFindingSchema` in `schemas.ts` has `aspect` before any output formatting code is written |

---

## Sources

- [Orchestrate teams of Claude Code sessions — official docs](https://code.claude.com/docs/en/agent-teams) — HIGH confidence
- [Manage costs effectively — agent team token costs section](https://code.claude.com/docs/en/costs) — HIGH confidence (official, "approximately 7x more tokens in plan mode")
- [Claude Code Changelog — agent teams bug fixes v2.1.69](https://code.claude.com/docs/en/changelog) — HIGH confidence
- [Building Agent Teams in OpenCode: Architecture of Multi-Agent Coordination](https://dev.to/uenyioha/porting-claude-codes-agent-teams-to-opencode-4hol) — MEDIUM confidence (implementation reverse-engineering)
- [Claude Code's Hidden Multi-Agent System](https://paddo.dev/blog/claude-code-hidden-swarm/) — MEDIUM confidence (architectural analysis)
- [RCE and API Token Exfiltration via Claude Code — CVE-2025-59536 / CVE-2026-21852](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) — HIGH confidence (security research, now patched)
- [From Tasks to Swarms: Agent Teams in Claude Code](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/) — MEDIUM confidence (community guide)
- [AddyOsmani.com — Claude Code Swarms](https://addyosmani.com/blog/claude-code-agent-teams/) — MEDIUM confidence (community guide)
- [Claude Code Agent Teams Beginner Guide](https://smartscope.blog/en/generative-ai/claude/claude-code-agent-teams-guide/) — MEDIUM confidence (community guide)
- Existing codebase concerns (`.planning/codebase/CONCERNS.md`) — HIGH confidence (direct codebase knowledge)

---

*Pitfalls research for: Claude Code agent teams integration into codereview CLI*
*Researched: 2026-03-05*
