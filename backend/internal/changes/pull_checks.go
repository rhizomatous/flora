package changes

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// PullChecks retains only a complete response for one immutable PR head.
// Error and AttemptedAt describe the latest attempt, while CheckedAt belongs
// to the retained items. Callers must compare SHA with the PR's current head.
type PullChecks struct {
	SHA         string      `json:"sha,omitempty"`
	Items       []PullCheck `json:"items"`
	CheckedAt   string      `json:"checkedAt,omitempty"`
	AttemptedAt string      `json:"attemptedAt,omitempty"`
	Error       string      `json:"error,omitempty"`
}
type PullCheck struct {
	Key   string `json:"key,omitempty"`
	Name  string `json:"name"`
	State string `json:"state"`
	URL   string `json:"url,omitempty"`
}

func checkURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	return u.String()
}

func checkState(status, conclusion string) string {
	if status != "completed" {
		return "pending"
	}
	switch conclusion {
	case "success":
		return "success"
	case "skipped", "neutral":
		return "neutral"
	case "failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale":
		return "failure"
	default:
		return "unavailable"
	}
}

// Both GitHub check runs and legacy commit statuses are collected by SHA.
// Pagination uses fixed host-side paths and shares the discovery request budget.
// Incomplete pages or either unavailable API leave the previous snapshot intact.
func collectPullChecks(p Pull, get func(string, any) int, stamp string) *PullChecks {
	saved := PullChecks{Items: []PullCheck{}}
	if p.Checks != nil {
		saved = *p.Checks
	}
	saved.AttemptedAt = stamp
	saved.Error = "Checks could not be refreshed. Saved results are retained."
	read := func(path string, target any) bool {
		status := get(path, target)
		switch status {
		case 200:
			return true
		case 401:
			saved.Error = "GitHub authentication failed. Saved checks are retained."
		case 403:
			saved.Error = "GitHub denied access or rate limited this request. Check read permissions or retry later. Saved checks are retained."
		case 429:
			saved.Error = "GitHub rate limit reached. Saved checks are retained."
		case 404:
			saved.Error = "Checks could not be accessed on GitHub. Saved results are retained."
		default:
			if status >= 500 {
				saved.Error = "GitHub is unavailable. Saved checks are retained."
			}
		}
		return false
	}
	items := []PullCheck{}
	seen := map[string]bool{}
	base := "/repos/" + p.Repository + "/commits/" + p.HeadSHA
	complete := false
	received := 0
	for page := 1; page <= 10; page++ {
		var result struct {
			Total *int `json:"total_count"`
			Runs  []struct {
				Name       string `json:"name"`
				SHA        string `json:"head_sha"`
				Status     string `json:"status"`
				Conclusion string `json:"conclusion"`
				URL        string `json:"html_url"`
				App        struct {
					ID int `json:"id"`
				} `json:"app"`
			} `json:"check_runs"`
		}
		if !read(fmt.Sprintf("%s/check-runs?filter=latest&per_page=100&page=%d", base, page), &result) || result.Total == nil {
			return &saved
		}
		received += len(result.Runs)
		for _, run := range result.Runs {
			if run.SHA != p.HeadSHA {
				return &saved
			}
			key := fmt.Sprintf("%d/%s", run.App.ID, run.Name)
			if seen[key] {
				continue
			}
			seen[key] = true
			items = append(items, PullCheck{Key: key, Name: run.Name, State: checkState(run.Status, run.Conclusion), URL: checkURL(run.URL)})
		}
		if received >= *result.Total {
			complete = true
			break
		}
	}
	if !complete {
		return &saved
	}
	complete = false
	received = 0
	// Combined status returns the latest status for each context, including an
	// explicit SHA and total, so empty results and malformed responses differ.
	for page := 1; page <= 10; page++ {
		var result struct {
			SHA      string `json:"sha"`
			Total    *int   `json:"total_count"`
			Statuses []struct {
				Name  string `json:"context"`
				State string `json:"state"`
				URL   string `json:"target_url"`
			} `json:"statuses"`
		}
		if !read(fmt.Sprintf("%s/status?per_page=100&page=%d", base, page), &result) || result.SHA != p.HeadSHA || result.Total == nil {
			return &saved
		}
		received += len(result.Statuses)
		for _, status := range result.Statuses {
			key := "status/" + status.Name
			if seen[key] {
				continue
			}
			seen[key] = true
			state := status.State
			switch state {
			case "success", "pending", "failure":
			case "error":
				state = "failure"
			default:
				state = "unavailable"
			}
			items = append(items, PullCheck{Key: key, Name: status.Name, State: state, URL: checkURL(status.URL)})
		}
		if received >= *result.Total {
			complete = true
			break
		}
	}
	if !complete {
		return &saved
	}
	// A push during collection must not label an earlier head's results current.
	var latest remotePull
	if get(fmt.Sprintf("/repos/%s/pulls/%d", p.Repository, p.Number), &latest) != 200 || latest.Head.SHA != p.HeadSHA {
		saved.Error = "PR head changed or could not be verified during refresh. Saved checks may be out of date."
		return &saved
	}
	sort.Slice(items, func(i, j int) bool { return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name) })
	return &PullChecks{SHA: p.HeadSHA, Items: items, CheckedAt: stamp, AttemptedAt: stamp}
}
