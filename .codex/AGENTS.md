# ExecPlans
 
When writing complex features or significant refactors, use an ExecPlan (as described in .codex/PLANS.md) from design to implementation.


# Agent Guidelines

## Purpose
This repository uses this `AGENTS.md` to provide a single, comprehensive reference for how agents should contribute changes. The instructions below apply to all work unless a more specific `AGENTS.md` is found deeper in the directory tree.

## General Expectations
- Strive for clear, maintainable, and well-documented code.
- Prefer small, focused commits that are easy to review.
- Keep changes minimal and explain the motivation in commit messages and PR summaries.
- Update or add documentation whenever behaviour, APIs, or workflows change.
- Follow existing naming conventions and file structures when extending the codebase.

## Communication & Documentation
- Write meaningful commit messages summarizing the change.
- When adding or updating functionality, include comments or README updates if helpful for future contributors.
- Document environment variables, configuration steps, or other operational details impacted by the change.

## Testing & Quality
- Run all relevant automated tests before opening a PR. If new functionality is added, create corresponding tests whenever possible.
- Clearly report the commands executed and their outcomes in the final response.
- Do not introduce lint or test regressions.

## Backend Guidelines
- Maintain consistent coding style with the surrounding backend code (primarily Node.js/Express).
- Validate inputs, handle errors gracefully, and avoid introducing blocking operations in request handlers.
- Keep controllers lean by delegating business logic to services or utilities when appropriate.
- Update database models, migrations, or seed data together to ensure schema consistency.

## Frontend Guidelines
- Follow React component structure and styling conventions already present in the `client` directory.
- Ensure components remain accessible (ARIA attributes, keyboard navigation) when modifying UI elements.
- Keep state management predictable; prefer lifting state thoughtfully instead of creating deeply nested prop chains.
- When adding visual features, include tests or snapshots if the project already uses them, and consider responsive behaviour across screen sizes.

## Pull Request Instructions
- Summarize the change, why it was necessary, and highlight any follow-up work.
- List the tests or checks performed, including commands run and their results.
- Note any known issues or limitations that reviewers should be aware of.
- Reference relevant tickets or issues when applicable.

## Review Process
- Keep PRs focused; split unrelated changes into separate PRs when feasible.
- Address review feedback promptly and clearly, noting what changed in follow-up commits.
- Re-run affected tests after addressing review comments.

