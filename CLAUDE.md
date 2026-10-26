# CLAUDE.md

## Branches

Never commit to `main`. At the start of any work that will change the repo, including in cloud sessions, create a branch named for the change before the first commit:

- Format: `<type>/<short-kebab-description>`, matching existing branches such as `feat/device-login`.
- Types: `feat` (new behaviour or UI), `fix` (bug fix), `docs` (documentation only), `chore` (tooling, config, dependencies), `refactor` (no behaviour change).
- Describe the change, not the session: `feat/cosmetics-shop`, `fix/leaderboard-sort`. Avoid generic or generated names such as `claude/session-abc123`, `update`, or `wip`.
- Keep it short: 2 to 5 words after the slash, lower case, hyphen-separated.

If a session starts on a branch whose name doesn't describe the work, create a properly named branch from it before committing.
