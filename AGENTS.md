# SpareCash Codex working rules

## Usage efficiency

Minimize Codex usage while preserving correctness. Use the smallest amount of context, tooling, and verification needed to complete the requested change.

- Do not load or apply a skill unless the user explicitly names it or the task cannot be completed correctly without it. Keyword overlap or an optional quality improvement is not enough.
- In particular, do not load frontend or design skills for ordinary admin controls, copy changes, small layout fixes, or backend work. Preserve the existing design and make the smallest UI change required.
- Do not browse the web for stable repository facts. Use local code and documentation first. Browse only when the user asks, the information is time-sensitive, or authoritative external documentation is required.
- Do not spawn subagents unless the user explicitly requests delegation or parallel agents.
- Use targeted `rg` searches and narrow file excerpts. Do not print entire large files, skills, test logs, build logs, diffs, or API responses into model context.
- Cap tool output aggressively. Capture verbose command output to a temporary file and return only the summary or relevant failure lines.
- Reuse information already established in the thread. Do not repeat inspections, documentation reads, or live-service queries without a concrete reason.
- Make a focused implementation plan internally, then stop once the requested behavior and necessary verification are complete. Do not add adjacent features or redesigns.

## Scope control

- Implement only what the user requested or what is technically necessary for it to work.
- Do not redesign existing screens unless the user asks for a redesign.
- Do not add frontend work to a backend-only or data-only request. When a UI control is explicitly requested, use the existing components and styles without invoking a design workflow.
- Do not change external campaigns, bids, budgets, live delivery settings, or third-party accounts unless the user explicitly requests that action.

## Verification

- For small, low-risk changes, run type checking and the narrowest relevant test.
- Run the full test suite only for cross-cutting changes, destructive data operations, authentication, billing, shared infrastructure, or when the user asks for it.
- Run a production build only when bundling, frontend code, deployment behavior, or build configuration changed.
- Do not use browser automation or visual screenshots unless the user requests browser verification or the change materially affects layout or interaction.
- When a full test or build is justified, suppress routine output and surface only the pass/fail summary and actionable errors.

## Communication

- Keep progress updates and final reports concise.
- Report the outcome, files or behavior changed, verification performed, and any material limitation.
- Do not include command transcripts or long implementation narratives unless requested.
