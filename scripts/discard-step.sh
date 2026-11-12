#!/usr/bin/env bash
# Verwirft alle nicht committeten Änderungen eines Schritts.
# Aufruf: discard-step.sh <slug>
source "$(dirname "$0")/lib/common.sh"
require_cmd git
require_site "${1:-}"

git_site reset -q
git_site checkout -q -- .
git_site clean -fdq
log "Nicht übernommene Änderungen in $SLUG verworfen"
emit status discarded slug "$SLUG" head "$(git_site rev-parse HEAD)"
