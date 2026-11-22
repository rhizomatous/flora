package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/workspace"
)

type contextSource = storage.ContextReference

func (a *api) contextConfiguration(ctx context.Context, project, chat string) (storage.Configuration, error) {
	if chat != "" {
		c, err := a.settings.Store.Chat(ctx, chat)
		if err != nil {
			return storage.Configuration{}, err
		}
		if c.ProjectID != project {
			return storage.Configuration{}, storage.ErrInvalid
		}
		return c.Configuration, nil
	}
	p, err := a.settings.Store.Project(ctx, project)
	return p.Configuration, err
}
func (a *api) contextRoot(ctx context.Context, chat string, config storage.Configuration, name string) (*os.Root, error) {
	if chat == "" {
		return nil, storage.ErrInvalid
	}
	var selected *storage.Repository
	for _, r := range config.Repositories {
		if r.Name == name {
			selected = &r
			break
		}
	}
	if selected == nil {
		return nil, storage.ErrInvalid
	}
	paths, err := a.settings.Store.SavedPaths(ctx, chat)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(paths.Workspace)
	if err != nil {
		return nil, err
	}
	rel := strings.TrimPrefix(storage.RepositoryPath(config, *selected), "/workspace")
	if rel != "" {
		defer root.Close()
		return root.OpenRoot(strings.TrimPrefix(rel, "/"))
	}
	return root, nil
}
func (a *api) referenceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/projects/{id}/context", func(w http.ResponseWriter, r *http.Request) {
		project, chat := r.PathValue("id"), r.URL.Query().Get("chat")
		config, err := a.contextConfiguration(r.Context(), project, chat)
		if err != nil {
			chatError(w, err)
			return
		}
		repositories := []string{}
		repos := config.Repositories
		for _, repo := range repos {
			repositories = append(repositories, repo.Name)
		}
		if selected := r.URL.Query().Get("repository"); selected != "" {
			repos = nil
			for _, repo := range config.Repositories {
				if repo.Name == selected {
					repos = append(repos, repo)
				}
			}
			if len(repos) == 0 {
				failure(w, 400, "Choose a repository in this chat or project.")
				return
			}
		}
		query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))
		if len(query) > 200 || !utf8.ValidString(query) {
			failure(w, 400, "Search must be within 200 UTF-8 bytes.")
			return
		}
		kind := r.URL.Query().Get("kind")
		items := []contextSource{}
		note := ""
		switch kind {
		case "chat":
			chats, err := a.settings.Store.Chats(r.Context())
			if err != nil {
				chatError(w, err)
				return
			}
			for _, c := range chats {
				if c.ID != chat && strings.Contains(strings.ToLower(c.Title), query) {
					items = append(items, contextSource{Kind: kind, ChatID: c.ID, Label: c.Title})
					if len(items) == 30 {
						break
					}
				}
			}

		case "file":
			if len(repos) > 10 {
				note = "Showing the first 10 repositories. Choose a repository to see more."
			}
			if chat == "" {
				note = "Workspace files are available after the chat checkout is created. Upload a file to start a new chat."
				break
			}
			for _, repo := range repos[:min(len(repos), 10)] {
				root, err := a.contextRoot(r.Context(), chat, config, repo.Name)
				if err != nil {
					note = "Some workspace files are missing or inaccessible."
					continue
				}
				names := []string{}
				if query == "" {
					listing, e := workspace.List(r.Context(), root, ".", 0)
					err = e
					for _, f := range listing.Entries {
						if f.Kind == "file" {
							names = append(names, f.Name)
						}
					}
				} else {
					result, e := workspace.Search(r.Context(), root, query)
					err = e
					names = result.Paths
					if result.Truncated {
						note = "Showing the first matches. Refine your search."
					}
				}
				root.Close()
				if err != nil {
					note = "Some workspace files are missing or inaccessible."
					continue
				}
				for _, name := range names {
					if storage.ContextPathAllowed(name) {
						items = append(items, contextSource{Kind: kind, Repository: repo.Name, Path: name, Label: path.Base(name)})
						if len(items) >= 50 {
							break
						}
					}
				}
				if len(items) >= 50 {
					note = "Showing the first 50 files. Refine your search."
					break
				}
			}
		case "pr":
			for _, repo := range repos[:min(len(repos), 5)] {
				pulls, err := a.projects.ContextPulls(r.Context(), repo.Name)
				if err != nil {
					projectError(w, err)
					return
				}
				for _, p := range pulls {
					label := fmt.Sprintf("#%d %s", p.Number, p.Title)
					if strings.Contains(strings.ToLower(label+" "+repo.Name), query) {
						items = append(items, contextSource{Kind: kind, Repository: repo.Name, Number: p.Number, Label: label, Status: p.Status()})
					}
				}
			}

			if len(repos) > 5 {
				note = "Showing recent PRs from the first 5 repositories. Choose a repository to see more."
			}
		default:
			failure(w, 400, "Choose files, chats, or pull requests.")
			return
		}
		jsonResponse(w, 200, map[string]any{"items": items, "note": note, "repositories": repositories})
	})
	mux.HandleFunc("POST /api/projects/{id}/context", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ChatID string        `json:"chatID"`
			Source contextSource `json:"source"`
		}
		if !decodeLimit(w, r, &in, 4096) {
			return
		}
		project := r.PathValue("id")
		config, err := a.contextConfiguration(r.Context(), project, in.ChatID)
		if err != nil {
			chatError(w, err)
			return
		}
		source := in.Source
		ref := source
		switch source.Kind {
		case "file":
			if !storage.ContextPathAllowed(source.Path) {
				failure(w, 400, "Credential and private configuration files cannot be referenced.")
				return
			}
			root, err := a.contextRoot(r.Context(), in.ChatID, config, source.Repository)
			if err != nil {
				failure(w, 409, "Workspace file is missing or inaccessible. New chats need a checkout before selecting files.")
				return
			}
			defer root.Close()
			parts := strings.Split(source.Path, "/")
			for i := range parts {
				info, err := root.Lstat(strings.Join(parts[:i+1], "/"))
				if err != nil {
					workspaceError(w, err)
					return
				}
				if info.Mode()&os.ModeSymlink != 0 || (i == len(parts)-1 && !info.Mode().IsRegular()) {
					failure(w, 400, "Select a regular workspace file rather than a symlink.")
					return
				}
			}
			ref = storage.ContextReference{Kind: "file", Label: path.Base(source.Path), Repository: source.Repository, Path: source.Path}
		case "chat":
			c, err := a.settings.Store.Chat(r.Context(), source.ChatID)
			if err != nil {
				chatError(w, err)
				return
			}
			if c.ID == in.ChatID {
				failure(w, 400, "Choose another chat.")
				return
			}
			ref = storage.ContextReference{Kind: "chat", Label: c.Title, ChatID: c.ID}
		case "pr":
			known := false
			for _, repo := range config.Repositories {
				if repo.Name == source.Repository {
					known = true
				}
			}
			if !known || source.Number < 1 || len(source.Label) > 500 {
				failure(w, 400, "Choose a pull request in this project's repositories.")
				return
			}
			ref = storage.ContextReference{Kind: "pr", Label: source.Label, Repository: source.Repository, Number: source.Number, Status: source.Status}
		default:
			failure(w, 400, "Choose a supported context source.")
			return
		}
		secrets := redaction.Values(r.Context(), a.settings.Store, in.ChatID)
		ref.Label = redaction.Text(ref.Label, secrets...)
		jsonResponse(w, 200, ref)
	})
}
