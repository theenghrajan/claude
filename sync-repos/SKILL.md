---
name: sync-repos
description: Pull, stage, commit and push every git repo under D:\work in one go (skips smart-dev/, Wallpapers/). Use when the user runs /sync-repos or says "sync all repos", "pull/commit/push everything", "push all work repos". Invoking it IS the go-ahead to commit and push.
---

# Sync repos

Script: `D:/work/claude/sync-repos/sync.sh` (Git Bash). Repos are discovered automatically (any `.git` up to 4 levels under `D:/work`), so new repos are picked up without editing anything.

## Steps

1. `bash D:/work/claude/sync-repos/sync.sh prep` — fetches, pulls (`--ff-only`), stages everything (`git add -A`), and prints each repo's staged files plus `!!` warnings.
2. For each repo with staged files, handle the warnings first:
   - `!! PULL FAILED` → repo diverged; leave it alone and report it. Never rebase, merge or force.
   - `!! SENSITIVE?` → unstage that file (`git restore --staged`) unless the name is clearly harmless (e.g. a Shopify `password.liquid` template). Never commit `.env`, keys or credentials.
   - `!! BIG FILE` or obvious local-only backups (`*.orig.*`, full theme copies newly added) → unstage, and add to that repo's `.gitignore` if it'll keep coming back. Mention it in the report.
3. Commit each repo once, with a short message describing what changed (domains, task IDs, what kind of change — read `git diff --cached --stat` and the file names), ending with the Co-Authored-By line from the system reminder.
4. `bash D:/work/claude/sync-repos/sync.sh push` — pushes every repo that's ahead, then prints a final status line per repo.
5. Report a table: repo | pulled? | commit hash + message | pushed. List anything skipped or unstaged and why.

## Rules

- `smart-dev/` is never touched. `snippets/` IS synced to its own origin only, but it holds credentials: unstage anything `!! SENSITIVE?` or that looks like a key/password/.env, and never upload its content anywhere else. To change the skip list, edit `SKIP` in `sync.sh`.
- Pushes go to whatever branch each repo is on. If a repo isn't on `main`/`master`, say so in the report.
- No force-push, no `--no-verify`. If a push is rejected, report it and stop for that repo.
