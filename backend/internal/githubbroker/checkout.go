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
	"syscall"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Executor interface {
	Exec(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error)
}

type CheckoutConfig struct {
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
}

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
	return &Access{broker, engine, cfg}, nil
}

func (a *Access) Revoke(ctx context.Context, chatID string) error {
	return a.broker.Revoke(ctx, chatID)
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

// Checkout configures ordinary git/gh, resolves the initial core repository in
// the container, saves its immutable base, then allows setup to start. Existing
// repositories are never reset on retry, even if the remote branch has moved.
func (a *Access) Checkout(ctx context.Context, chat storage.Chat, paths storage.Paths, containerID string) (err error) {
	ctx, cancel := context.WithTimeout(ctx, a.cfg.Timeout)
	defer cancel()
	var core []storage.Repository
	for _, r := range chat.Configuration.Repositories {
		if r.Role == "core" {
			core = append(core, r)
		}
	}
	if len(core) != 1 {
		return errors.New("checkout requires exactly one initial core repository")
	}
	r := core[0]
	u, parseErr := url.Parse(r.URL)
	if parseErr != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !gitPath.MatchString(strings.TrimSuffix(u.Path, ".git")+".git/info/refs") || u.RawPath != "" {
		return errors.New("checkout requires a canonical GitHub HTTPS repository URL")
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
	config := "set -eu\numask 077\nmkdir -p /home/flora/.config/gh\n" +
		"printf '%s\\n' " + quote(a.cfg.CACert) + " > /home/flora/.flora-github-ca.pem\n" +
		"if [ -r /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt >> /home/flora/.flora-github-ca.pem; fi\n" +
		"printf '%s\\n' " + quote("export GH_HOST="+quote(a.cfg.Host)+"\nexport SSL_CERT_FILE=/home/flora/.flora-github-ca.pem\nexport GH_PROMPT_DISABLED=1\nexport GIT_TERMINAL_PROMPT=0") + " > /home/flora/.flora-github.env\n" +
		"printf '%s\\n' " + quote(a.cfg.Host+":\n    user: flora\n    oauth_token: "+credential+"\n    git_protocol: https") + " > /home/flora/.config/gh/hosts.yml\n" +
		"git config --global user.name " + quote(a.cfg.AuthorName) + "\n" +
		"git config --global user.email " + quote(a.cfg.AuthorEmail) + "\n" +
		"git config --global " + quote("url.https://"+a.cfg.Host+"/.insteadOf") + " https://github.com/\n" +
		"git config --global " + quote("http.https://"+a.cfg.Host+"/.sslCAInfo") + " /home/flora/.flora-github-ca.pem\n" +
		"git config --global " + quote("credential.https://"+a.cfg.Host+".helper") + " '!gh auth git-credential'\n"
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
	url := "https://" + a.cfg.Host + strings.TrimSuffix(u.Path, ".git") + ".git"
	script := "set -eu\n. /home/flora/.flora-github.env\ncd /workspace\n"
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
			"sha=$(cat .git/flora-starting-commit)\ngit cat-file -e \"$sha^{commit}\"\ntest \"$(git rev-parse HEAD)\" = \"$sha\"\nprintf '%s\\n' \"$sha\"\n"
	}
	if err := run(user, script); err != nil {
		return err
	}
	sha := strings.TrimSpace(string(output.data))
	if err := a.broker.store.RecordStartingCommit(ctx, chat.ID, r.Name, sha); err != nil {
		return fmt.Errorf("save resolved checkout commit: %w", err)
	}
	return run("0", "set -eu\ntouch /var/lib/flora-checkout.ready\n")
}

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
