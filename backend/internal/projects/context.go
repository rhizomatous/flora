package projects

import "context"

type PullContext struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
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
