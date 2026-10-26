#!/bin/sh
# In-container offline integration checks for issue #3. Runs as the
# unprivileged "agent" user against the host-side broker, which fronts a
# fake token-demanding upstream. No real GitHub credentials are involved.
# Environment (injected by run-local.sh):
#   BROKER_HOST   broker address (flora-broker:PORT)
#   CAPABILITY    per-chat, revocable capability token
#   REPO          authorized repository, owner/name
#   OTHER_REPO    another repository permitted by the upstream token
#   DENIED_REPO   a repository denied by the fake upstream
set -eu

fail() { echo "LOCAL PROBE FAIL: $*" >&2; exit 1; }
step() { echo "== $*"; }

export GH_HOST="$BROKER_HOST"
export GH_ENTERPRISE_TOKEN="$CAPABILITY"
REMOTE="https://$CAPABILITY@$BROKER_HOST/$REPO.git"

step "environment boundary"
id | grep -q 'agent' || fail "not running as the unprivileged agent user"
# The only credential-shaped variables allowed in this container are the
# broker endpoint and the capability.
BAD=$(env | grep -E '^(GH_|GITHUB_)' \
	| grep -vE '^(GH_HOST|GH_ENTERPRISE_TOKEN|GH_PROMPT_DISABLED)=' || true)
if [ -n "$BAD" ]; then
	fail "unexpected credential material in container environment: $(echo "$BAD" | cut -d= -f1)"
fi
[ -S /var/run/docker.sock ] && fail "host Docker socket is mounted"
touch /etc/x 2>/dev/null && fail "container has unexpected privilege" || true

step "git clone/fetch/push through broker"
git clone "$REMOTE" work
cd work
[ -f README.md ] || fail "clone missing seeded README.md"
git checkout -q -b probe/change
echo "probe $(date -u +%s)" > probe.txt
git add probe.txt
git -c user.name='Flora Probe' -c user.email='probe@rhizomato.us' commit -q -m 'probe: container change'
git push -u origin probe/change
git fetch origin
[ "$(git config --get remote.origin.url)" = "$REMOTE" ] || fail "unexpected remote URL persisted"

step "gh REST read through broker"
gh api "repos/$REPO" | grep -q '"full_name":"'"$REPO"'"' || fail "repository view failed"

step "stock gh pr create --draft and gh pr view through broker"
gh --version
PR_URL=$(gh pr create --draft --title 'Flora probe draft PR' \
	--body 'Issue #3 offline container probe.' --base main --head probe/change)
echo "created: $PR_URL"
echo "$PR_URL" | grep -q '/pull/' || fail "gh pr create returned no PR URL"
gh pr view 1 --repo "$REPO" --json number,isDraft,url,title,state
gh pr view 1 --repo "$REPO" --json isDraft | grep -q '"isDraft":true' \
	|| fail "gh pr view did not confirm the draft PR"
cd ..

step "multiple repositories allowed by upstream"
gh api "repos/$OTHER_REPO" >/dev/null || fail "second repository API failed"
git ls-remote "https://$CAPABILITY@$BROKER_HOST/$OTHER_REPO.git" >/dev/null || fail "second repository git failed"

step "upstream permission denial"
if gh api "repos/$DENIED_REPO" >/dev/null 2>&1; then
	fail "upstream denial lost (API)"
fi
if git ls-remote "https://$CAPABILITY@$BROKER_HOST/$DENIED_REPO.git" >/dev/null 2>&1; then
	fail "upstream denial lost (git)"
fi

step "administrator token is not usable as a container credential"
if curl -sk -u "local-test-admin-token:" \
	"https://$BROKER_HOST/$REPO.git/info/refs?service=git-upload-pack" \
	-o /dev/null -w '%{http_code}' | grep -q 200; then
	fail "broker accepted the upstream token as a container credential"
fi

echo "LOCAL PROBE OK"
