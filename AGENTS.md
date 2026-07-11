### SolidJS 2 Beta

- This project uses **SolidJS 2 beta**, not SolidJS 1.x.
- All SolidJS code must strictly follow [`doc/MIGRATION.md`](doc/MIGRATION.md).
- Before adding or changing SolidJS APIs, patterns, imports, JSX types, effects, lifecycle hooks, list rendering, stores, or reactive behavior, consult the migration guide and use the SolidJS 2 beta form.
- Do not introduce SolidJS 1.x-only APIs or patterns. In particular, `createEffect` must use the SolidJS 2 compute/apply signature described in the migration guide.

### Version Control

- Use `git` as the primary version control system for this repository.
- Prefer `git` commands and workflows for status checks, history inspection, branches, commits, and pushes.
- When asked to "separately push" multiple changes, treat that as separate commits pushed sequentially to `main` by default, not separate branches or pull requests, unless explicitly requested.

### Commit Messages

- All commit messages must follow Conventional Commits: `<type>(<scope>): <summary>`.
- Example: `chore(init): initial import`.
