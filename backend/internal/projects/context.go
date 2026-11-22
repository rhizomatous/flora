package projects

import "context"

type PullContext struct {
	Number   int     `json:"number"`
	Title    string  `json:"title"`
	State    string  `json:"state"`
	Draft    bool    `json:"draft"`
	MergedAt *string `json:"merged_at"`
}

// ContextPulls discovers PR identities for the picker. The agent reads their current content through gh.
func (s *Service) ContextPulls(ctx context.Context, repo string) ([]PullContext, error) {
	if _, err := repository(repo); err != nil {
		return nil, err
	}
	var pulls []PullContext
	err := s.githubGet(ctx, repo, "/pulls?state=all&sort=updated&direction=desc&per_page=30", false, &pulls)
	return pulls, err
}

func (p PullContext) Status() string {
	if p.MergedAt != nil && *p.MergedAt != "" {
		return "merged"
	}
	if p.State == "closed" {
		return "closed"
	}
	if p.State == "open" {
		if p.Draft {
			return "draft"
		}
		return "open"
	}
	return "unknown"
}
