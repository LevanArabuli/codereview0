# Pitfalls Research

**Domain:** AI-powered code review quality improvement (context-awareness, severity calibration, confidence scoring, noise reduction)
**Researched:** 2026-03-04
**Confidence:** HIGH (primary pitfalls verified across multiple sources; integration pitfalls derived from codebase analysis + research)

---

## Critical Pitfalls

### Pitfall 1: Detailed Prompts Cause Over-Rejection

**What goes wrong:**
Adding explanation requirements and fix suggestions to prompts — the natural instinct when improving review quality — systematically increases false rejection rates. Research on 5 major LLMs (GPT-4o, Claude, Gemini, Llama, Mistral) found false negative rates jump dramatically when prompts request reasoning: GPT-4o's false negative rate in one benchmark jumped from 26% to 73% when explanation and repair fields were added. The model shifts from analysis to constructing a plausible argument for why code fails.

**Why it happens:**
When instructed to produce an explanation and a suggested fix, the model anchors on completing those fields rather than accurately judging the code. It "invents" unstated constraints (14% of false rejections), asserts logic errors without evidence (48% of false rejections), and over-emphasizes edge cases (13%). The richer the output format, the more the model generates to fill it — regardless of whether the code actually has issues.

**How to avoid:**
Keep the required output fields minimal. The current schema (file, line, severity, confidence, category, description, optional suggestedFix) is near the boundary of safe complexity. Do NOT add required rationale chains, required fix examples, or required impact assessments. If adding fields for context-awareness, make them optional and short. Test every prompt change against the existing eval fixture corpus before shipping.

**Warning signs:**
- Eval fixture pass rate drops after adding a new required field to the finding format
- Same code produces more findings with the new prompt than the old one despite no change in code quality
- "suggestedFix" field populated on high-level architectural concerns that have no simple fix

**Phase to address:**
Context-awareness and confidence scoring phases. Any phase that adds new fields to the finding output must run evals against known-good fixtures before shipping.

---

### Pitfall 2: Confidence Scores Reflect Verbosity, Not Accuracy

**What goes wrong:**
LLMs asked to self-report confidence levels systematically over-report certainty. GPT-4o and GPT-4-turbo assign 100% confidence to all answers even when wrong. "Low confidence" findings from Claude are still likely-wrong findings stated with false authority — they are not calibrated probabilities. If confidence is used to filter or suppress findings (e.g., hide all "low" confidence findings), the output appears higher quality but may have the same or worse accuracy profile.

**Why it happens:**
LLMs do not have internally coherent uncertainty representations. The confidence field in the output is a completion task like any other — the model generates a token ("high", "medium", "low") based on learned patterns of how confident-sounding language correlates with the type of finding, not from an internal accuracy signal. Findings about well-known anti-patterns get "high" regardless of whether the anti-pattern actually applies here.

**How to avoid:**
Treat confidence as a sorting/display signal, not a filter. The current implementation correctly uses confidence for sort order within a severity tier — this is appropriate. Do NOT implement "suppress all low confidence findings" without running evals to verify suppression accuracy. If using confidence for suppression, calibrate against real PRs: measure what fraction of low-confidence findings are actually false positives vs. true positives before suppressing them.

**Warning signs:**
- All findings from a given finding category are "high confidence" regardless of how ambiguous the code is
- Suppressing "low confidence" findings removes known-true findings from your eval corpus
- Claude marks a speculative cross-file assumption as "high confidence" because it stated it assertively

**Phase to address:**
Confidence scoring implementation phase. Establish a calibration baseline before using confidence for suppression.

---

### Pitfall 3: Context Overload Degrades Focus

**What goes wrong:**
Adding codebase context to improve review quality can backfire when too much context is included. If the pre-analysis phase reads many convention files, README content, config files, and example implementations, the model has less attention budget for the diff. Results shift from "missed context from the codebase" to "missed issues in the diff" — a worse failure mode. Prompt truncation in the current system (80KB limit) already demonstrates awareness of this tradeoff; context-gathering features risk recreating the problem at a higher level.

**Why it happens:**
Claude's attention is not uniform across a large context window. Information at the beginning and end of the prompt is weighted more heavily than content in the middle. If convention files and codebase context land in the middle of a long prompt — between the security constraints and the diff — they may receive less attention than either. Additionally, more content to process means more time (and turns in agentic mode) spent on context rather than on finding real issues.

**How to avoid:**
Place gathered context immediately before the review instructions, not after a long preamble. Keep gathered context short and targeted: a 50-line "codebase conventions" summary is more effective than 500 lines of example files. In deep mode, instruct Claude to study conventions FIRST, then apply them during diff analysis — not as a parallel activity. Set a hard character budget for injected context (e.g., 8KB max for convention context).

**Warning signs:**
- Adding codebase context causes Claude to use more agentic turns reading files than reviewing the diff
- Finding count drops significantly when convention context is added (may indicate attention displacement)
- Review findings start referencing the convention content but miss issues in the diff itself

**Phase to address:**
Context-aware review phase (pre-analysis convention detection). Budget the context addition carefully before adding it to the prompt.

---

### Pitfall 4: Pattern Samples Are Too Small to Be Patterns

**What goes wrong:**
Convention detection identifies "patterns" from 2-3 occurrences of something in the codebase and flags deviations. But with small samples, what looks like a convention may be coincidence, legacy code, or a specific domain's local exception. Flagging deviations from coincidental patterns adds noise, not signal. The current agentic prompt already notes "a pattern requires 2-3 instances to be considered established" — the pitfall is treating this threshold as sufficient.

**Why it happens:**
When Claude explores a codebase to detect conventions, it uses heuristics about what counts as "established." With a small or inconsistent codebase, these heuristics misfire. The model is optimistic about pattern strength because finding patterns is the task — it is not asked to evaluate whether the pattern is intentional vs. accidental.

**How to avoid:**
Set a higher threshold for "established pattern" — at least 5 occurrences across multiple files, not just repeated in one file. When injecting detected conventions into the prompt, include only conventions that can be stated as concise, verifiable rules (e.g., "all exported functions have JSDoc"). Do not inject prose descriptions of patterns — inject rules only.

**Warning signs:**
- Convention detection surfaces "conventions" present only in a single directory or author's contributions
- Detected pattern directly contradicts something in an existing config file (e.g., detected "no semicolons" but .eslintrc requires semicolons)
- The same codebase produces different detected conventions on different runs

**Phase to address:**
Context-aware review phase. Add validation: before injecting a convention into the prompt, verify it appears in N+ distinct files.

---

### Pitfall 5: Severity Inflation — Everything Becomes a Bug

**What goes wrong:**
Prompts that emphasize "be thorough" or "focus on bugs" cause the model to categorize suggestions as bugs to meet the stated emphasis. A concern about error handling that should be a "suggestion" gets labeled "bug." A style inconsistency gets labeled "suggestion" instead of "nitpick." The severity taxonomy collapses toward higher severity because the model learned that reviewers care more about bugs than nitpicks.

**Why it happens:**
Severity labels in LLM output are not derived from a consistent internal schema — they are generated based on which label matches the assertive framing the model chose for the description. If the description sounds urgent (because the model is pattern-matching on "thorough review"), it generates "bug" as the severity. Mode overlays (strict, detailed, lenient, balanced) partially mitigate this, but only by adjusting what the model reports, not how it labels what it does report.

**How to avoid:**
Add concrete severity criteria with examples directly in the prompt, not just labels. The current FINDING_FORMAT_INSTRUCTIONS gives good definitions but no examples. Adding two or three concrete examples of each severity (showing what a "bug" looks like vs. a "suggestion" vs. a "nitpick") anchors the labels to observable characteristics. Use eval fixtures that include expected severity labels and fail when severity drift exceeds a threshold.

**Warning signs:**
- Eval corpus shows consistent severity upgrade from a previous prompt version (e.g., suggestions becoming bugs without code changing)
- In balanced mode, most findings are "bug" or "security" with very few "suggestion" or "nitpick"
- The same issue type (e.g., missing error handling) gets different severities in different findings in the same review

**Phase to address:**
Severity calibration phase. Add few-shot severity examples to the prompt and add severity distribution checks to the eval suite.

---

### Pitfall 6: Suppressing Low-Value Findings Creates Blind Spots

**What goes wrong:**
Low-value finding suppression — filtering out nitpicks, low-confidence findings, or "formatting issues" — improves average output quality but creates systematic blind spots. If the suppression criteria are too broad, real issues that superficially resemble noise get dropped. Users trust the output more (because it's cleaner) but miss things that were previously visible. The quality appears better by metrics (fewer findings) while actual coverage decreases.

**Why it happens:**
Suppression criteria are defined once and applied uniformly. Edge cases that don't fit the suppression heuristic but are still noise get through; edge cases that fit the heuristic but are actually important get dropped. Without per-case evaluation, this drift is invisible.

**How to avoid:**
Suppression should be done in the prompt layer ("do not report X"), not in a post-processing filter, because post-processing filters suppress without context. Prompt-level suppression gives the model information about why something shouldn't be reported and lets it make judgment calls. When adding suppression criteria, add a corresponding eval fixture that verifies the target of suppression is gone but adjacent real issues remain.

**Warning signs:**
- Suppressing "formatting issues" also suppresses a finding about a missing newline that causes a parse error
- Low-confidence suppression removes findings the eval corpus marks as known-true positives
- After adding suppression, finding count drops by 50%+ on previously-reviewed PRs without clear explanation

**Phase to address:**
Noise reduction phase. Every suppression criterion needs a counter-example in the eval corpus that it should NOT suppress.

---

### Pitfall 7: Intent-Awareness Adds Subjectivity

**What goes wrong:**
Making the review intent-aware — understanding what the PR is trying to accomplish and reviewing against that goal — sounds valuable but introduces a new failure mode: the model reviews whether the PR achieves its stated intent rather than whether the code is correct. A PR that correctly implements the wrong solution gets a "looks good, achieves stated goal" review. The intent-awareness substitutes PR-author judgment for independent reviewer judgment.

**Why it happens:**
When given a PR title, description, and goal, the model uses those as the review criteria. If the PR description says "add caching to improve performance," the model confirms that caching was added and finds performance-relevant issues — but may not flag that the caching strategy is architecturally wrong for the problem. The model is anchored to the author's framing.

**How to avoid:**
Use intent context to provide background (what changed and why), not as review criteria. The review criteria must remain independently-derived quality standards. In the prompt, frame intent information under "PR Context" and keep review criteria in a separate "Review Criteria" section. Explicitly instruct: "Use the PR description to understand what was changed and why, but review the code against independent correctness and quality standards, not against whether it achieves the stated intent."

**Warning signs:**
- Findings no longer appear for an architectural concern that contradicts the PR's stated approach
- Reviews on PRs with detailed descriptions produce fewer findings than reviews on PRs with sparse descriptions
- Claude explicitly references "the PR's goal" as justification for not flagging something

**Phase to address:**
Intent-aware review phase. Separate the "background context" role of PR metadata from the "review target" role.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Tuning prompts by feel on a few PRs | Fast iteration, quick wins | Silent regressions on other PR types; no way to detect quality drift | Never — always use eval fixtures |
| Suppressing categories of findings in post-processing | Cleaner output immediately | Suppresses without model context; creates blind spots; hard to audit | Never for content filtering; acceptable for formatting (line breaks, etc.) |
| Adding convention context as raw file excerpts | Easy to implement | Token budget explosion, diluted attention, unpredictable quality | Never — always summarize conventions before injecting |
| Using confidence threshold to hide findings without calibration | Appears to improve signal-to-noise | May suppress true positives; confidence is not calibrated without validation | Only after measuring false positive rate of low-confidence findings on eval corpus |
| Treating mode overlays as the only severity control | Already exists, no new code | Modes change what is reported, not how well it is categorized; severity inflation remains | Acceptable for MVP; not for calibration milestone |
| Prompt changes without version tagging | Simple to edit | Cannot correlate quality shifts with specific changes; rollback is difficult | Never in production prompts |

---

## Integration Gotchas

Common mistakes when connecting quality improvements to the existing pipeline.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Zod schema (schemas.ts) | Adding a required field that breaks when model omits it | Add new fields as `.optional()` first; only make required after verifying model reliably produces them |
| Prompt changes to buildPrompt/buildAgenticPrompt | Editing prompt text without updating FINDING_FORMAT_INSTRUCTIONS consistently | FINDING_FORMAT_INSTRUCTIONS and JSON_RESPONSE_INSTRUCTION are shared constants — changes affect both quick and deep modes simultaneously; verify both |
| Confidence score display (output.ts) | Showing confidence inline with every finding increases visual noise | Confidence should affect sort order (already implemented) and optionally appear only for low-confidence findings as a visual cue |
| Convention context injection | Injecting gathered context as a new top-level string concatenated to the prompt | Convention context must be placed in a specific prompt position for attention; build it into buildAgenticPrompt's XML structure, not appended |
| Eval suite (eval.ts) | Adding new quality features without adding new fixtures | Every new prompt behavior needs at least one fixture that validates it and one that validates it doesn't over-suppress |
| Diff truncation (MAX_DIFF_CHARS = 80KB) | Convention context + diff exceeds token budget without triggering truncation guard | The truncation guard only applies to the diff itself; total prompt size is not guarded separately; add prompt-level budget check |
| agentic mode turn budget (MAX_AGENTIC_TURNS = 75) | Pre-analysis convention detection consumes turns before the review starts | Either increase turn budget for agentic mode or instruct convention detection to complete in a fixed number of turns |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Convention detection reads all files in the repo | Agentic session runs for 10+ minutes before timing out | Scope convention detection to changed files' directories + top-level config files only; set a hard file read limit | Any repo with 100+ files |
| Gathering context for every file in changedFiles | Token budget exhausted on file context before diff is analyzed | Fetch related files selectively (callers, tests, types) not exhaustively; limit to top N most-changed files | PRs with 20+ changed files |
| Eval suite re-runs all Claude calls on every CI check | CI takes 30+ minutes; developers stop running it | Eval fixtures should have cached expected outputs; only re-run when prompts change (use hash-based invalidation) | Eval corpus of 20+ fixtures |

---

## Security Mistakes

Domain-specific security issues relevant to this quality improvement milestone.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Convention context includes file content with credentials or secrets | Secrets injected into Claude subprocess prompt; may appear in findings output or verbose logs | Convention detection must read only structural patterns (function signatures, import paths, type names) — never file content verbatim. Apply scrubSecrets() to any gathered context before including in prompt. |
| Scraped patterns from `.env.example` or config files | API keys, database URLs, or internal service names appear in injected context | Exclude known sensitive file patterns from convention detection scope: `.env*`, `*.key`, `*.pem`, credential config files |
| Convention context gathered from PR branch, not base branch | PR author can plant misleading "conventions" in their branch that manipulate the review | Convention detection for deep mode must read from base branch files (already cloned), not files added/modified by the PR. Treat changed files as untrusted for convention purposes. |
| Prompt contains severity criteria that mention specific internal project paths | Leaks internal architecture through review output if findings reference injected context verbatim | Convention context must be generic rules, not specific internal file paths or system names |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing confidence level on every finding | Visual noise; high-confidence findings are cluttered with redundant "high" labels | Show confidence only when it is NOT high — i.e., mark "medium confidence" or "low confidence" explicitly, let the absence of a label imply high confidence |
| Filtering out low-confidence findings entirely by default | Users don't know findings were suppressed; trust is misplaced | Either show all findings with confidence label, or show a summary count ("3 low-confidence findings hidden") that can be revealed with a flag |
| Severity calibration changes the count of findings dramatically | Users see "5 bugs, 3 suggestions" one day and "2 bugs, 1 suggestion" the next on similar PRs and lose trust in the tool | Calibration changes should be gradual and tested; communicate changes in release notes; use eval corpus to verify calibration doesn't produce wild count swings |
| Context-awareness makes deep mode take significantly longer | Users abandon deep reviews and fall back to quick mode, defeating the purpose | Set user expectations with a progress indicator; keep total agentic session time under 10 minutes even with context gathering |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Confidence scoring:** Often missing calibration validation — verify low-confidence findings have a higher false positive rate than high-confidence findings in the eval corpus before using confidence for suppression
- [ ] **Convention detection:** Often missing base-branch scoping — verify that the detected conventions come from base-branch files only, not PR-author-modified files
- [ ] **Severity calibration:** Often missing per-mode severity distribution tests — verify balanced mode does not produce >50% "bug" severity findings on typical PRs
- [ ] **Context injection:** Often missing total prompt size guard — verify the combined prompt (base + context + diff) stays within a safe total character budget
- [ ] **Low-value suppression:** Often missing counter-example fixtures — verify suppression criteria do not remove known-true findings from the eval corpus
- [ ] **Intent-aware context:** Often missing the separation between "background" and "review target" — verify reviews still flag issues that contradict the PR's stated approach
- [ ] **Agentic turn budget:** Often missing validation for convention-detection turn consumption — verify convention detection completes in a bounded number of turns before the review starts

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Prompt change causes silent quality regression | MEDIUM | Roll back prompt to previous version tag; add a fixture capturing the regression case; fix and re-deploy |
| Confidence suppression removes true positives | MEDIUM | Disable suppression threshold; audit what was hidden; raise threshold or remove suppression entirely; add fixture for each lost true positive |
| Convention detection reads PR branch content (security issue) | HIGH | Audit what was injected; verify no credentials or secrets appeared in findings; add file exclusion rules and base-branch scoping before re-enabling |
| Context overload causes diff analysis to miss issues | LOW-MEDIUM | Reduce injected context size; verify with eval fixtures; add prompt-level character budget check |
| Severity inflation collapses all findings to "bug" | MEDIUM | Add few-shot severity examples to prompt; run eval suite to verify severity distribution recovers; may require regenerating eval expected outputs |
| Agentic session times out during convention detection | LOW | Reduce scope of convention detection (fewer files); add explicit turn limit for pre-analysis phase; check MAX_AGENTIC_TURNS is sufficient for combined workload |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Detailed prompts cause over-rejection | Schema/confidence scoring phase — any phase adding output fields | Eval fixture pass rate after schema changes |
| Confidence scores reflect verbosity not accuracy | Confidence scoring phase | Measure false positive rate of low-confidence findings before enabling suppression |
| Context overload degrades diff focus | Context-aware review phase | Measure finding count on known-issue PRs before and after context injection |
| Pattern samples too small to be patterns | Context-aware/convention detection phase | Verify detected patterns appear in 5+ distinct files |
| Severity inflation | Severity calibration phase | Eval corpus severity distribution checks per mode |
| Suppression creates blind spots | Noise reduction/suppression phase | Counter-example fixtures for every suppression criterion |
| Intent-awareness adds subjectivity | Intent-aware review phase | Reviews on PRs with detailed vs. sparse descriptions produce equivalent finding counts |
| Convention context from PR branch (security) | Convention detection phase | Static analysis: convention reading must only target base-branch paths |

---

## Sources

- [Are LLMs Reliable Code Reviewers? Systematic Overcorrection in Requirement Conformance Judgement (arXiv 2603.00539)](https://arxiv.org/html/2603.00539) — PRIMARY: over-correction, false rejection rates, root cause taxonomy
- [Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution (arXiv 2508.06225)](https://arxiv.org/html/2508.06225v2) — confidence score miscalibration
- [State of AI Code Review Tools in 2025 — DevTools Academy](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/) — alert fatigue, noise, tool comparison
- [Effective Prompt Engineering for AI Code Reviews — Graphite](https://graphite.com/guides/effective-prompt-engineering-ai-code-reviews) — prompt pitfalls: vagueness, missing context, format issues
- [How to Improve Your AI Code Review Process (2025) — Propel](https://www.propelcode.ai/blog/improve-ai-code-review-process-2025) — eval infrastructure, prompt versioning, metrics
- [How Many False Positives Are Too Many in AI Code Review — CodeAnt](https://www.codeant.ai/blogs/ai-code-review-false-positives) — false positive costs, alert fatigue consequences
- [Codified Context: Infrastructure for AI Agents in a Complex Codebase (arXiv 2602.20478)](https://arxiv.org/html/2602.20478) — context gathering approaches and limitations
- [Writing AI Coding Agent Context Files — PackMind](https://packmind.com/evaluate-context-ai-coding-agent/) — convention detection pitfalls, staleness, vague instructions
- [Can LLMs Express Their Uncertainty? (OpenReview)](https://openreview.net/forum?id=gjeQKFxFpZ) — confidence elicitation failure modes
- Codebase analysis: `/Users/levanarabuli/development/codereview0/src/prompt.ts`, `schemas.ts`, `analyzer.ts` — integration-specific pitfalls derived from reading existing implementation

---

*Pitfalls research for: AI code review quality improvement (context-awareness, severity calibration, confidence scoring, noise reduction)*
*Researched: 2026-03-04*
