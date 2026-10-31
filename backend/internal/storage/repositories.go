package storage

// RepositoryPath preserves the root checkout for single-core-repository chats.
// Multiple repositories use their full GitHub identity, so equal basenames
// from different owners never share a directory.
func RepositoryPath(c Configuration, r Repository) string {
	if len(c.Repositories) == 1 && r.Role == "core" {
		return "/workspace"
	}
	return "/workspace/repos/" + r.Name
}
