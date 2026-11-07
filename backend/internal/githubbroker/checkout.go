package githubbroker

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Executor interface {
	Exec(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error)
}

type CheckoutConfig struct {
	UseChatAuthor bool
	// Host must resolve to the private TLS broker on port 443 from containers.
	// Stock gh uses this hostname to match repository remotes to API credentials.
	Host                    string
	CACert                  string
	AuthorName, AuthorEmail string
	Timeout                 time.Duration
}

type Access struct {
	broker *Broker
	engine Executor
	cfg    CheckoutConfig
	locks  sync.Map
}

// NewAccess wires the broker's repository helper. Call it before serving the
// broker; the same broker must handle the container's git and gh requests.
func NewAccess(broker *Broker, engine Executor, cfg CheckoutConfig) (*Access, error) {
	u, err := url.Parse("https://" + cfg.Host)
	if err != nil || u.Host != cfg.Host || u.Hostname() == "" || u.Port() != "" || u.User != nil || u.Path != "" || u.RawQuery != "" || strings.ContainsAny(cfg.Host, "\r\n\t '") || cfg.CACert == "" || broker == nil || engine == nil {
		return nil, errors.New("GitHub access requires a private TLS hostname on port 443, CA certificate and Docker executor")
	}
	if cfg.AuthorName == "" {
		cfg.AuthorName = "Flora"
	}
	if cfg.AuthorEmail == "" {
		cfg.AuthorEmail = "flora@rhizomato.us"
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 2 * time.Minute
	}
	a := &Access{broker: broker, engine: engine, cfg: cfg}
	broker.materialize = a.Materialize
	return a, nil
}

func (a *Access) Revoke(ctx context.Context, chatID string) error {
	return a.broker.Revoke(ctx, chatID)
}

func (a *Access) lockChat(ctx context.Context, id string) (func(), error) {
	value, _ := a.locks.LoadOrStore(id, make(chan struct{}, 1))
	lock := value.(chan struct{})
	select {
	case lock <- struct{}{}:
		return func() { <-lock }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }

type tailBuffer struct{ data []byte }

func (b *tailBuffer) Write(p []byte) (int, error) {
	n := len(p)
	b.data = append(b.data, p...)
	if len(b.data) > 8192 {
		b.data = b.data[len(b.data)-8192:]
	}
	return n, nil
}

// Checkout configures ordinary git/gh, resolves all core repositories in
// the container, saves their immutable bases, then allows setup to start. Existing
// repositories are never reset on retry, even if the remote branch has moved.
func (a *Access) Checkout(ctx context.Context, chat storage.Chat, paths storage.Paths, containerID string) (err error) {
	ctx, cancel := context.WithTimeout(ctx, a.cfg.Timeout)
	defer cancel()
	unlock, err := a.lockChat(ctx, chat.ID)
	if err != nil {
		return err
	}
	defer unlock()
	for _, r := range chat.Configuration.Repositories {
		if err := checkoutRepository(r); err != nil {
			return err
		}
	}
	credential := rand.Text() + rand.Text()
	if err := a.broker.store.ReplaceGitHubCapability(ctx, chat.ID, credential, time.Now().Add(7*24*time.Hour)); err != nil {
		return err
	}
	var diagnostics tailBuffer
	defer func() {
		if err == nil {
			return
		}
		clean := context.WithoutCancel(ctx)
		_ = a.Revoke(clean, chat.ID)
		tail := strings.ReplaceAll(string(diagnostics.data), credential, "[redacted]")
		_ = os.WriteFile(filepath.Join(paths.Logs, "checkout.log"), []byte(tail), 0600)
		payload, _ := json.Marshal(map[string]string{"error": err.Error(), "output_tail": tail, "log": "checkout.log"})
		_ = a.broker.store.AppendActivity(clean, chat.ID, "checkout-"+rand.Text(), "checkout", payload)
	}()
	// Only the revocable credential enters the container. GitHub's token is
	// retrieved by the host proxy, never included in scripts, env or config.
	authorName, authorEmail := a.cfg.AuthorName, a.cfg.AuthorEmail
	if a.cfg.UseChatAuthor {
		r := chat.Configuration.RuntimeDefaults()
		authorName, authorEmail = r.AuthorName, r.AuthorEmail
	}
	config := "set -eu\numask 077\nmkdir -p /home/flora/.config/gh\n" +
		"printf '%s\\n' " + quote(a.cfg.CACert) + " > /home/flora/.flora-github-ca.pem\n" +
		"if [ -r /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt >> /home/flora/.flora-github-ca.pem; fi\n" +
		"printf '%s\\n' " + quote("export GH_HOST="+quote(a.cfg.Host)+"\nexport SSL_CERT_FILE=/home/flora/.flora-github-ca.pem\nexport GH_PROMPT_DISABLED=1\nexport GIT_TERMINAL_PROMPT=0") + " > /home/flora/.flora-github.env\n" +
		"printf '%s\\n' " + quote(a.cfg.Host+":\n    user: flora\n    oauth_token: "+credential+"\n    git_protocol: https") + " > /home/flora/.config/gh/hosts.yml\n" +
		"git config --global user.name " + quote(authorName) + "\n" +
		"git config --global user.email " + quote(authorEmail) + "\n" +
		"git config --global " + quote("url.https://"+a.cfg.Host+"/.insteadOf") + " https://github.com/\n" +
		"git config --global " + quote("http.https://"+a.cfg.Host+"/.sslCAInfo") + " /home/flora/.flora-github-ca.pem\n" +
		"git config --global " + quote("credential.https://"+a.cfg.Host+".helper") + " '!gh auth git-credential'\n"
	type entry struct {
		storage.Repository
		Path string `json:"path"`
	}
	manifest := []entry{}
	for _, r := range chat.Configuration.Repositories {
		manifest = append(manifest, entry{r, storage.RepositoryPath(chat.Configuration, r)})
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	helper := "#!/bin/sh\nset -eu\n. /home/flora/.flora-github.env\ntest \"$#\" = 1 || { printf 'Usage: flora-repository OWNER/REPO\\n' >&2; exit 2; }\nexec gh api --hostname " + quote(a.cfg.Host) + " /flora/repositories -f repository=\"$1\"\n"
	config += "mkdir -p /home/flora/bin\nprintf '%s\\n' " + quote(string(data)) + " > /home/flora/.flora-repositories.json\n" +
		"printf '%s' " + quote(helper) + " > /home/flora/bin/flora-repository\nchmod 700 /home/flora/bin/flora-repository\n"
	var output tailBuffer
	run := func(user, script string) error {
		output.data = nil
		exit, execErr := a.engine.Exec(ctx, containerID, user, []string{"sh", "-s"}, strings.NewReader(script), &output, &diagnostics)
		if execErr != nil {
			return errors.New("checkout command could not finish; check Docker and host network, then retry")
		}
		if exit != 0 {
			return fmt.Errorf("checkout command failed (exit %d); check repository, base branch and token permissions; diagnostics saved in checkout.log", exit)
		}
		return nil
	}
	// The entrypoint may still be mapping the flora user. Use the numeric host
	// owner for exec so checkout never races that identity change.
	info, statErr := os.Stat(paths.Workspace)
	if statErr != nil {
		return statErr
	}
	user, ownerErr := workspaceUser(info)
	if ownerErr != nil {
		return ownerErr
	}
	if err := run(user, config); err != nil {
		return err
	}
	for _, r := range chat.Configuration.Repositories {
		if r.Role != "core" {
			continue
		}
		if err := a.checkoutOne(ctx, chat, r, func(script string) (string, error) {
			err := run(user, script)
			return strings.TrimSpace(string(output.data)), err
		}); err != nil {
			return err
		}
	}
	return run("0", "set -eu\ntouch /var/lib/flora-checkout.ready\n")
}

func checkoutRepository(r storage.Repository) error {
	u, err := url.Parse(r.URL)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || !gitPath.MatchString(u.Path+"/info/refs") || u.Path != "/"+r.Name+".git" {
		return errors.New("checkout requires a canonical GitHub HTTPS repository URL and identity")
	}
	for _, part := range strings.Split(r.Name, "/") {
		if part == "." || part == ".." {
			return errors.New("invalid repository identity")
		}
	}
	return nil
}

// checkoutOne never changes a materialized checkout. Its marker lets a retry
// recover the original base after cloning succeeded but saving to SQLite failed.
// The marker belongs to the agent's writable checkout, so it is a retry aid,
// not trusted evidence against an agent deliberately changing its own base.
func (a *Access) checkoutOne(ctx context.Context, chat storage.Chat, r storage.Repository, run func(string) (string, error)) error {
	if err := checkoutRepository(r); err != nil {
		return err
	}
	url := "https://" + a.cfg.Host + "/" + r.Name + ".git"
	path := storage.RepositoryPath(chat.Configuration, r)
	script := "set -eu\n. /home/flora/.flora-github.env\n"
	if path != "/workspace" && chat.StartingCommits[r.Name] == "" {
		script += "if [ ! -e " + quote(path) + " ]; then\n" +
			"tmp=$(mktemp -d /workspace/.flora-clone.XXXXXXXX)\ntrap 'rm -rf -- \"$tmp\"' EXIT\n" +
			"git -c http.followRedirects=false clone --single-branch --branch " + quote(r.BaseBranch) + " " + quote(url) + " \"$tmp\" >&2\n" +
			"git -C \"$tmp\" checkout -b " + quote("flora/"+chat.ID) + " >&2\n" +
			"git -C \"$tmp\" rev-parse HEAD > \"$tmp/.git/flora-starting-commit\"\n" +
			"mkdir -p " + quote(filepath.Dir(path)) + "\nmv -- \"$tmp\" " + quote(path) + "\ntrap - EXIT\nfi\n"
	}
	script += "cd " + quote(path) + "\n"
	if path != "/workspace" {
		script += "test -f .git/flora-starting-commit\n"
	}
	if sha := chat.StartingCommits[r.Name]; sha != "" {
		script += "git cat-file -e " + quote(sha+"^{commit}") + "\nprintf '%s\\n' " + quote(sha) + "\n"
	} else {
		script += "if [ ! -f .git/flora-starting-commit ]; then\n" +
			"git check-ref-format " + quote("refs/heads/"+r.BaseBranch) + "\n" +
			"if [ ! -d .git ]; then git -c http.followRedirects=false clone --no-checkout --single-branch --branch " + quote(r.BaseBranch) + " " + quote(url) + " . >&2; fi\n" +
			"git -c http.followRedirects=false fetch --no-tags origin " + quote("+refs/heads/"+r.BaseBranch+":refs/remotes/origin/"+r.BaseBranch) + " >&2\n" +
			"sha=$(git rev-parse --verify 'FETCH_HEAD^{commit}')\n" +
			"git checkout -B " + quote("flora/"+chat.ID) + " \"$sha\" >&2\n" +
			"printf '%s\\n' \"$sha\" > .git/flora-starting-commit.tmp\nmv .git/flora-starting-commit.tmp .git/flora-starting-commit\nfi\n" +
			"sha=$(cat .git/flora-starting-commit)\ngit cat-file -e \"$sha^{commit}\"\nprintf '%s\\n' \"$sha\"\n"
	}
	sha, err := run(script)
	if err != nil {
		return err
	}
	if err := a.broker.store.RecordStartingCommit(ctx, chat.ID, r.Name, sha); err != nil {
		return fmt.Errorf("save resolved checkout commit: %w", err)
	}
	return nil
}

// Materialize fetches a configured repository using the chat's frozen settings.
// This helper records review bases; ordinary git/gh access remains token-wide.
func (a *Access) Materialize(ctx context.Context, chatID, name string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, a.cfg.Timeout)
	defer cancel()
	unlock, err := a.lockChat(ctx, chatID)
	if err != nil {
		return "", err
	}
	defer unlock()
	chat, err := a.broker.store.Chat(ctx, chatID)
	if err != nil {
		return "", err
	}
	paths, err := a.broker.store.Paths(ctx, chatID)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(paths.Workspace)
	if err != nil {
		return "", err
	}
	user, err := workspaceUser(info)
	if err != nil {
		return "", err
	}
	for _, r := range chat.Configuration.Repositories {
		if !strings.EqualFold(r.Name, name) {
			continue
		}
		err := a.checkoutOne(ctx, chat, r, func(script string) (string, error) {
			var out tailBuffer
			code, err := a.engine.Exec(ctx, chat.ContainerID, user, []string{"sh", "-s"}, strings.NewReader(script), &out, io.Discard)
			if err != nil || code != 0 {
				return "", errors.New("repository fetch failed; check repository, branch, Docker and token permissions, then retry")
			}
			return strings.TrimSpace(string(out.data)), nil
		})
		return storage.RepositoryPath(chat.Configuration, r), err
	}
	return "", &MaterializeValidationError{"repository is not in this chat's configuration; use ordinary git/gh for other token-authorized repositories"}
}

type MaterializeValidationError struct{ Message string }

func (e *MaterializeValidationError) Error() string { return e.Message }

func workspaceUser(info os.FileInfo) (string, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid == 0 {
		return "", errors.New("checkout workspace must be owned by a non-root service user")
	}
	gid := stat.Gid
	if gid == 0 {
		gid = stat.Uid
	}
	return fmt.Sprintf("%d:%d", stat.Uid, gid), nil
}
