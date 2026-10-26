#!/bin/sh
# In-container offline integration checks for issue #3. Runs as the
# unprivileged "agent" user against the host-side broker, which fronts a
# fake token-demanding upstream. No real GitHub credentials are involved.
# Environment (injected by run-local.sh):
#   BROKER_HOST   broker address (flora-broker:PORT)
#   CAPABILITY    per-chat, repo-scoped capability token
#   REPO          authorized repository, owner/name
#   OTHER_REPO    a repository the capability must NOT reach
set -eu

fail() { echo "LOCAL PROBE FAIL: $*" >&2; exit 1; }
step() { echo "== $*"; }

export GH_HOST="$BROKER_HOST"
export GH_ENTERPRISE_TOKEN="$CAPABILITY"
REMOTE="https://$CAPABILITY@$BROKER_HOST/$REPO.git"

step "environment boundary"
id | grep -q 'agent' || fail "not running as the unprivileged agent user"
# The only credential material in this environment may be the capability.
if env | grep -E 'TOKEN|token' | grep -v GH_ENTERPRISE_TOKEN | grep -q .; then
	fail "unexpected credential material in container environment"
fi
[ -S /var/run/docker.sock ] && fail "host Docker socket is mounted"
touch /etc/x 2>/dev/null && fail "container has unexpected privilege" || true

step "git clone/fetch/push through broker"
git clone "$REMOTE" work
cd work
[ -f README.md ] || fail "clone missing seeded README.md"
echo "probe $(date -u +%s)" > probe.txt
git add probe.txt
git -c user.name='Flora Probe' -c user.email='probe@rhizomato.us' commit -q -m 'probe: container change'
git push origin HEAD:probe/change
git fetch origin
[ "$(git config --get remote.origin.url)" = "$REMOTE" ] || fail "unexpected remote URL persisted"
cd ..

step "gh REST through broker"
gh api "repos/$REPO" | grep -q '"full_name":"'"$REPO"'"' || fail "repository view failed"
gh api -X POST "repos/$REPO/pulls" -f title='Flora probe draft PR' -F draft=true \
	| grep -q '"draft":true' || fail "draft PR create failed"
gh api "repos/$REPO/pulls/1" | grep -q '"number":1' || fail "PR view failed"

step "cross-repository denial"
if gh api "repos/$OTHER_REPO" >/dev/null 2>&1; then
	fail "capability reached an unauthorized repository (API)"
fi
if git ls-remote "https://$CAPABILITY@$BROKER_HOST/$OTHER_REPO.git" >/dev/null 2>&1; then
	fail "capability reached an unauthorized repository (git)"
fi

step "administrator token is not usable as a container credential"
if gh api "repos/$REPO" --hostname "$BROKER_HOST" 2>/dev/null | grep -q full_name; then :; fi
if curl -sk -u "local-test-admin-token:" \
	"https://$BROKER_HOST/$REPO.git/info/refs?service=git-upload-pack" \
	-o /dev/null -w '%{http_code}' | grep -q 200; then
	fail "broker accepted the upstream token as a container credential"
fi

echo "LOCAL PROBE OK"
