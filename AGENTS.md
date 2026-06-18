# Agent Team & Workflow — Auto Lobby

This repo uses a five-agent Claude Code team (`.claude/agents/`) to take a roadmap item from plan to merged PR. Every agent reads `CLAUDE.md` and `docs/Platform-Roadmap.md` first. No agent merges — humans do.

## The agents

| Agent | Role | Writes code? | Can block? |
|-------|------|--------------|-----------|
| **architect** | Turns a roadmap item into a plan + ordered task list | No (read-only) | — |
| **implementer** | Builds the approved plan on a feature branch | Yes | — |
| **tester** | Writes + runs unit/integration tests; enforces "happy path + one edge case" | Yes (tests) | — |
| **qa-reviewer** | Fresh-eyes review; runs lint/typecheck/test; checks provenance + UI | No | flags, defers |
| **security-compliance** | Guards the seven non-negotiables | No | **Yes** |

## The workflow

```
roadmap item
   │
   ▼
architect plans  ──►  ⛔ HUMAN APPROVES SCOPE
   │
   ▼
implementer builds on a feature branch (never main)
   │
   ▼
tester + qa-reviewer + security-compliance run
   │                                    │
   │                         security-compliance can BLOCK
   ▼
⛔ HUMAN REVIEWS THE PR AND MERGES
```

1. **Roadmap item → architect plans.** The architect reads the roadmap, maps the surface area, decomposes into ~2–4h tasks, names schema/migration impact, and flags which non-negotiables are in play. Output is a plan only.
2. **Human approves scope.** No code is written until a human signs off on the architect's plan.
3. **Implementer builds on a branch.** Always a feature branch (`feat/…`, `fix/…`), never `main`. Follows existing conventions, persists provenance, scopes every query by `tenantId`. Commits per logical unit; does not open the PR.
4. **Tester + qa-reviewer + security-compliance run** (in parallel after the build):
   - **tester** adds happy-path + edge-case tests and runs `pnpm test`.
   - **qa-reviewer** runs `pnpm lint && pnpm typecheck && pnpm test`, checks the Definition of Done, reports issues by severity.
   - **security-compliance** audits the diff against the seven non-negotiables and issues APPROVE / APPROVE WITH CONDITIONS / BLOCK.
5. **Human reviews the PR and merges.** Agents never merge. The human reads the PR, the qa-reviewer issues, and the security-compliance verdict, then merges.

## Human approval gates (explicit)

Work **stops for human sign-off** at these points — agents may not proceed past them on their own:

- **Scope approval** — before any code is written, the human approves the architect's plan.
- **PR merge** — the human reviews and merges every PR. No agent merges.
- **Certification logic** — any change to how/whether a filing is CEO-certified before submission.
- **Credential handling** — anything touching GCKey/LRS credentials, the supervised Playwright session, or `headless` mode.
- **Data residency** — any new region, storage location, data egress, or third-party data flow.
- **A real LRS submission** — running an actual submission against lobbycanada.gc.ca (vs. mocked tests) always requires a human in the loop.

A **BLOCK** from security-compliance halts the workflow until the human resolves it.

## Definition of Done (a feature ships when)

1. Types strict, Zod validates inputs.
2. Unit tests cover happy path + at least one edge case.
3. Auto-decisions log provenance.
4. UI shows provenance where a user might reasonably ask "why?".
5. `pnpm lint && pnpm typecheck && pnpm test` all pass.

## Invoking the team

Use the Claude Code Agent tool with `subagent_type` set to the agent name (`architect`, `implementer`, `tester`, `qa-reviewer`, `security-compliance`), or let Claude route by description. Run a typical cycle as: architect → (human) → implementer → tester + qa-reviewer + security-compliance → (human) PR + merge.
