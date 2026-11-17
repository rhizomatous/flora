package changes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestPullChecksHeadRefreshAndRetention(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, t.Name())
	linkMessage(t, s, c, "https://github.com/example/core/pull/7")
	head := strings.Repeat("a", 40)
	checkStatus := 200
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/pulls/7"):
			sha := head
			return reply(200, fmt.Sprintf(`{"number":7,"state":"open","html_url":"https://github.com/example/core/pull/7","head":{"sha":%q}}`, sha)), nil
		case strings.HasSuffix(r.URL.Path, "/check-runs"):
			if !strings.Contains(r.URL.Path, head) {
				t.Fatal("checks not requested by exact SHA")
			}
			return reply(checkStatus, fmt.Sprintf(`{"total_count":3,"check_runs":[{"name":"Build","head_sha":%q,"status":"completed","conclusion":"success","html_url":"https://github.com/example/core/actions/runs/1"},{"name":"Test","head_sha":%q,"status":"in_progress"},{"name":"Optional","head_sha":%q,"status":"completed","conclusion":"skipped"}]}`, head, head, head)), nil
		case strings.HasSuffix(r.URL.Path, "/status"):
			return reply(200, fmt.Sprintf(`{"sha":%q,"total_count":1,"statuses":[{"context":"Deploy","state":"failure","target_url":"javascript:alert(1)"}]}`, head)), nil

		default:
			t.Fatalf("unexpected path %s", r.URL)
			return nil, nil
		}
	})}
	s.verifyPulls(ctx, c, client)
	pull := s.ReadPulls(ctx, c.ID).Items[0]
	if pull.HeadSHA != head || pull.Checks == nil || len(pull.Checks.Items) != 4 || pull.Checks.Error != "" {
		t.Fatalf("checks missing: %+v", pull)
	}
	for _, item := range pull.Checks.Items {
		if item.Name == "Deploy" && (item.State != "failure" || item.URL != "") {
			t.Fatalf("unsafe status: %+v", item)
		}
	}
	saved := pull.Checks.CheckedAt
	// A new head with unavailable checks retains the old revision, never relabels it.
	head = strings.Repeat("b", 40)
	checkStatus = 503
	expirePulls(t, s, c)
	s.verifyPulls(ctx, c, client)
	pull = s.ReadPulls(ctx, c.ID).Items[0]
	if pull.HeadSHA != head || pull.Checks.SHA == head || pull.Checks.CheckedAt != saved || len(pull.Checks.Items) != 4 || pull.Checks.Error == "" {
		t.Fatalf("old checks relabeled or erased: %+v", pull)
	}
	// An inaccessible PR retains its head and checks with an explicit verification error.
	client.Transport = transport(func(*http.Request) (*http.Response, error) { return reply(404, `{}`), nil })
	expirePulls(t, s, c)
	s.verifyPulls(ctx, c, client)
	pull = s.ReadPulls(ctx, c.ID).Items[0]
	if pull.HeadSHA != head || pull.Checks.CheckedAt != saved || !strings.Contains(pull.Checks.Error, "head could not be verified") {
		t.Fatalf("verification failure lost data: %+v", pull)
	}
}

func TestCollectChecksCompletenessAndHeadRace(t *testing.T) {
	p := Pull{Repository: "example/core", Number: 7, HeadSHA: strings.Repeat("a", 40), Checks: &PullChecks{SHA: "old", CheckedAt: "saved", Items: []PullCheck{{Name: "Old", State: "success"}}}}
	for _, mode := range []string{"race", "permission", "rate-limit", "wrong-sha", "pagination", "empty"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			get := func(path string, target any) int {
				calls++
				body := ""
				switch {
				case strings.Contains(path, "check-runs"):
					if mode == "permission" {
						return 403
					}
					if mode == "rate-limit" {
						return 429
					}
					if mode == "pagination" && strings.Contains(path, "page=2") {
						return 503
					}
					body = `{"total_count":0,"check_runs":[]}`
					if mode == "pagination" {
						body = fmt.Sprintf(`{"total_count":101,"check_runs":[{"name":"Build","head_sha":%q,"status":"completed","conclusion":"success"}]}`, p.HeadSHA)
					}
				case strings.Contains(path, "/status"):
					sha := p.HeadSHA
					if mode == "wrong-sha" {
						sha = "wrong"
					}
					body = fmt.Sprintf(`{"sha":%q,"total_count":0,"statuses":[]}`, sha)
				default:
					sha := p.HeadSHA
					if mode == "race" {
						sha = strings.Repeat("b", 40)
					}
					body = fmt.Sprintf(`{"head":{"sha":%q}}`, sha)
				}
				if err := json.Unmarshal([]byte(body), target); err != nil {
					t.Fatal(err)
				}
				return 200
			}
			got := collectPullChecks(p, get, "now")
			if mode == "empty" {
				if got.Error != "" || got.SHA != p.HeadSHA || len(got.Items) != 0 {
					t.Fatalf("empty checks mislabeled: %+v", got)
				}
			} else if got.CheckedAt != "saved" || got.SHA != "old" || got.Error == "" || len(got.Items) != 1 {
				t.Fatalf("partial results replaced snapshot: %+v, calls=%d", got, calls)
			}
		})
	}
}

func TestSlowChecksLeaveSavedChatReadsAvailable(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, t.Name())
	linkMessage(t, s, c, "https://github.com/example/core/pull/7")
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	sha := strings.Repeat("a", 40)
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/check-runs") {
			close(started)
			<-release
			return reply(503, `{}`), nil
		}
		return reply(200, fmt.Sprintf(`{"number":7,"state":"open","html_url":"https://github.com/example/core/pull/7","head":{"sha":%q}}`, sha)), nil
	})}
	go func() { defer close(finished); s.verifyPulls(ctx, c, client) }()
	defer func() { close(release); <-finished }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("check request never started")
	}
	promptly(t, func() {
		if _, err := s.Read(ctx, c.ID, true); err != nil {
			t.Error(err)
		}
		s.ReadPulls(ctx, c.ID)
	})
}

func TestCollectChecksPaginatesBothAPIs(t *testing.T) {
	p := Pull{Repository: "example/core", Number: 7, HeadSHA: strings.Repeat("a", 40)}
	calls := 0
	get := func(path string, target any) int {
		calls++
		if !strings.Contains(path, "/commits/") {
			_ = json.Unmarshal([]byte(fmt.Sprintf(`{"head":{"sha":%q}}`, p.HeadSHA)), target)
			return 200
		}
		start, end := 0, 100
		if strings.Contains(path, "page=2") {
			start, end = 100, 101
		}
		entries := []string{}
		for i := start; i < end; i++ {
			if strings.Contains(path, "check-runs") {
				entries = append(entries, fmt.Sprintf(`{"name":"Run %d","head_sha":%q,"status":"completed","conclusion":"success"}`, i, p.HeadSHA))
			} else {
				entries = append(entries, fmt.Sprintf(`{"context":"Status %d","state":"pending"}`, i))
			}
		}
		key := "statuses"
		if strings.Contains(path, "check-runs") {
			key = "check_runs"
		}
		if err := json.Unmarshal([]byte(fmt.Sprintf(`{"sha":%q,"total_count":101,%q:[%s]}`, p.HeadSHA, key, strings.Join(entries, ","))), target); err != nil {
			t.Fatal(err)
		}
		return 200
	}
	got := collectPullChecks(p, get, "now")
	if calls != 5 || got.Error != "" || len(got.Items) != 202 {
		t.Fatalf("incomplete paginated checks: calls=%d %+v", calls, got)
	}
}
