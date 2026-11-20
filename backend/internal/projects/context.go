package projects

import (
	"context"
	"fmt"
)

// PullContext contains only PR text and revision fields used as message context. Tokens stay in HTTP headers.
type PullContext struct {
	Number    int    `json:"number"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	State     string `json:"state"`
	UpdatedAt string `json:"updated_at"`
	Head      struct {
		SHA string `json:"sha"`
	} `json:"head"`
	Base struct {
		SHA string `json:"sha"`
	} `json:"base"`
}

func (s *Service) ContextPulls(ctx context.Context, repo string, number int) ([]PullContext, error) {
	if _, err := repository(repo); err != nil {
		return nil, err
	}
	if number > 0 {
		var p PullContext
		err := s.githubGet(ctx, repo, fmt.Sprintf("/pulls/%d", number), false, &p)
		if err == nil && (p.Number != number || p.Head.SHA == "" || p.Base.SHA == "" || p.UpdatedAt == "") {
			err = invalid("GitHub returned an incomplete pull request. Try again.")
		}
		return []PullContext{p}, err
	}
	var pulls []PullContext
	err := s.githubGet(ctx, repo, "/pulls?state=all&sort=updated&direction=desc&per_page=30", false, &pulls)
	return pulls, err
}
