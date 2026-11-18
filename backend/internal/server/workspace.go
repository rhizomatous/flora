package server

import (
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/workspace"
)

func workspaceError(w http.ResponseWriter, err error) {
	if errors.Is(err, fs.ErrNotExist) {
		failure(w, 404, "File or directory is missing. Refresh the folder.")
		return
	}
	if errors.Is(err, fs.ErrInvalid) {
		failure(w, 400, "Invalid workspace path.")
		return
	}
	failure(w, 409, "Cannot read this path. It may have changed, be unsupported, or point outside this repository.")
}

func (a *api) workspaceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/chats/{id}/workspace", func(w http.ResponseWriter, r *http.Request) {
		c, err := a.settings.Store.Chat(r.Context(), r.PathValue("id"))
		if err != nil {
			chatError(w, err)
			return
		}
		// Repository identity and checkout location always come from the saved chat.
		// The request can choose a repository, never a host or container root.
		if !r.URL.Query().Has("repository") {
			jsonResponse(w, 200, map[string]any{"repositories": c.Configuration.Repositories})
			return
		}
		var selected *storage.Repository
		for _, repo := range c.Configuration.Repositories {
			if repo.Name == r.URL.Query().Get("repository") {
				selected = &repo
				break
			}
		}
		if selected == nil {
			failure(w, 404, "Repository is not part of this chat.")
			return
		}
		paths, err := a.settings.Store.SavedPaths(r.Context(), c.ID)
		if err != nil {
			chatError(w, err)
			return
		}
		root, err := os.OpenRoot(paths.Workspace)
		if err != nil {
			workspaceError(w, err)
			return
		}
		defer root.Close()
		relative := strings.TrimPrefix(storage.RepositoryPath(c.Configuration, *selected), "/workspace")
		if relative != "" {
			repo, err := root.OpenRoot(strings.TrimPrefix(relative, "/"))
			if err != nil {
				workspaceError(w, err)
				return
			}
			defer repo.Close()
			root = repo
		}
		name := r.URL.Query().Get("path")
		if name == "" {
			name = "."
		}
		if !workspace.ValidPath(name) {
			workspaceError(w, fs.ErrInvalid)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		switch r.URL.Query().Get("action") {
		case "search":
			query := r.URL.Query().Get("query")
			if len(query) > 200 || !utf8.ValidString(query) {
				failure(w, 400, "Search must be valid text within 200 bytes.")
				return
			}
			results, err := workspace.Search(r.Context(), root, query)
			if err != nil {
				workspaceError(w, err)
				return
			}
			jsonResponse(w, 200, results)
		case "preview", "download":
			download := r.URL.Query().Get("action") == "download"
			expected := r.URL.Query().Get("version")
			if download && expected == "" {
				failure(w, 400, "Open a preview before downloading.")
				return
			}
			preview, b, err := workspace.Read(root, name, expected, download)
			if err != nil {
				// Only fixed read diagnostics may be returned, never host paths.
				if errors.Is(err, workspace.ErrChanged) || errors.Is(err, workspace.ErrChanging) || errors.Is(err, workspace.ErrTooLarge) || errors.Is(err, workspace.ErrGrowing) {
					failure(w, 409, err.Error())
				} else {
					workspaceError(w, err)
				}
				return
			}
			if !download {
				jsonResponse(w, 200, preview)
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(name)}))
			w.WriteHeader(200)
			_, _ = w.Write(b)
		default:
			offset := 0
			if raw := r.URL.Query().Get("offset"); raw != "" {
				offset, err = strconv.Atoi(raw)
				if err != nil || offset < 0 {
					failure(w, 400, "Invalid folder page.")
					return
				}
			}
			listing, err := workspace.List(r.Context(), root, name, offset)
			if err != nil {
				workspaceError(w, err)
				return
			}
			jsonResponse(w, 200, listing)
		}
	})
}
