#!/usr/bin/env bash
# Sync every git repo under D:/work (except smart-dev/, Wallpapers/).
#   sync.sh prep  -> fetch, ff-only pull, stage all, report staged files + red flags
#   sync.sh push  -> push every repo that is ahead of its remote
# Commits are made in between (by Claude, per repo, with a written message).
set -u
ROOT=/d/work
SKIP='^\./(smart-dev|Wallpapers)(/|$)'   # snippets is synced: holds credentials, watch SENSITIVE flags
FLAG='(^|/)\.env($|\.)|\.pem$|\.key$|id_rsa|credential|secret'
BIG=5000000   # bytes; flag staged files above this

repos() { cd "$ROOT" && find . -maxdepth 4 -name node_modules -prune -o -name .git -print \
  | sed 's|/\.git$||' | grep -Ev "$SKIP" | grep -v '^\.$' | sed 's|^\./||' | sort; }

case "${1:-}" in
prep)
  for r in $(repos); do
    echo "=== $r"
    g() { git -C "$ROOT/$r" "$@"; }
    g fetch -q 2>&1
    s=$(g status -sb | head -1)
    case "$s" in *behind*)
      if ! g pull -q --ff-only 2>/dev/null; then echo "!! PULL FAILED (diverged or conflicts): $s -- skipped"; continue; fi
      echo "pulled";;
    esac
    g add -A 2>&1 | grep -v 'LF will be replaced'
    n=$(g diff --cached --name-only | wc -l)
    echo "$(g status -sb | head -1) | staged: $n"
    [ "$n" -eq 0 ] && continue
    g diff --cached --stat=120 | tail -40
    g diff --cached --name-only | grep -iE "$FLAG" | sed 's/^/!! SENSITIVE? /'
    g diff --cached --name-only -z | while IFS= read -r -d '' f; do
      [ -f "$ROOT/$r/$f" ] && [ "$(stat -c%s "$ROOT/$r/$f")" -gt $BIG ] && echo "!! BIG FILE: $f"
    done
  done ;;
push)
  for r in $(repos); do
    case "$(git -C "$ROOT/$r" status -sb | head -1)" in *ahead*)
      echo "=== $r"; git -C "$ROOT/$r" push 2>&1 | tail -1;;
    esac
  done
  echo "--- final"; for r in $(repos); do echo "$r: $(git -C "$ROOT/$r" status -sb | head -1)"; done ;;
*) echo "usage: sync.sh prep|push"; exit 1 ;;
esac
