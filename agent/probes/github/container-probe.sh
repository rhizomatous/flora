#!/bin/sh
# In-container probe for issue #3. Runs as the unprivileged "agent" user.
# Environment (injected by run-probe.sh at container start, container-side
# capability only):
#   BROKER_HOST   broker address reachable from the container (flora-broker:8443)
#   CAPABILITY    per-chat, repo-scoped, revocable capability token
#   REPO          authorized repository, owner/name
#   OTHER_REPO    a repository the capability must NOT reach
set -eu

fail() { echo "PROBE FAIL: $*" >&2; exit 1; }
step() { echo "== $*"; }

export GH_HOST="$BROKER_HOST"
export GH_ENTERPRISE_TOKEN="$CAPABILITY"
REMOTE="https://$CAPABILITY@$BROKER_HOST/$REPO.git"

step "environment boundary"
# The only credential-shaped variables allowed in this container are the
# broker endpoint and the capability. Anything else (for example a real
# GH_TOKEN or GITHUB_TOKEN) fails the run.
BAD=$(env | grep -E '^(GH_|GITHUB_)' \
	| grep -vE '^(GH_HOST|GH_ENTERPRISE_TOKEN|GH_PROMPT_DISABLED)=' || true)
if [ -n "$BAD" ]; then
	fail "unexpected credential material in container environment: $(echo "$BAD" | cut -d= -f1)"
fi
id | grep -q 'agent' || fail "not running as the unprivileged agent user"

step "git clone/fetch/push through broker"
git clone "$REMOTE" work
cd work
echo "probe $(date -u +%s)" > probe.txt
git add probe.txt
git -c user.name='Flora Probe' -c user.email='probe@rhizomato.us' commit -m 'probe: container change'
BRANCH="probe/$(date +%s)"
git push origin "HEAD:$BRANCH"
git fetch origin
# Persisted git config may hold the container-side capability but must
# match exactly the remote we injected, nothing more.
[ "$(git config --get remote.origin.url)" = "$REMOTE" ] || fail "unexpected remote URL persisted"
cd ..

step "gh draft PR create/view through broker"
PR_URL=$(GH_HOST="$BROKER_HOST" gh pr create --draft \
	--repo "$REPO" --base main --head "$BRANCH" \
	--title "Flora probe draft PR" --body "Issue #3 broker probe.")
echo "created: $PR_URL"
GH_HOST="$BROKER_HOST" gh pr view "$PR_URL" --repo "$REPO" --json number,isDraft,url

step "cross-repository denial"
if GH_HOST="$BROKER_HOST" gh api "repos/$OTHER_REPO" >/dev/null 2>&1; then
	fail "capability reached an unauthorized repository (API)"
fi
if git ls-remote "https://$CAPABILITY@$BROKER_HOST/$OTHER_REPO.git" >/dev/null 2>&1; then
	fail "capability reached an unauthorized repository (git)"
fi

echo "PROBE OK"
