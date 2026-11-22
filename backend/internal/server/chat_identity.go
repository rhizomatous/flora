package server

import (
	"net/http"
	"strings"
)

// Resolve public references at the HTTP boundary so storage paths, foreign keys,
// runtime locks, and request identities continue to use the original chat key.
func (a *api) chatReferences(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resolve := func(reference string) (string, bool) {
			if !strings.HasPrefix(reference, "FLORA-") {
				return reference, true
			}
			c, err := a.settings.Store.Chat(r.Context(), reference)
			if err != nil {
				chatError(w, err)
				return "", false
			}
			return c.ID, true
		}
		if strings.HasPrefix(r.URL.Path, "/api/chats/") {
			parts := strings.Split(r.URL.Path, "/")
			key, ok := resolve(parts[3])
			if !ok {
				return
			}
			parts[3] = key
			r.URL.Path = strings.Join(parts, "/")
			r.URL.RawPath = ""
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Query().Has("chat") {
			query := r.URL.Query()
			key, ok := resolve(query.Get("chat"))
			if !ok {
				return
			}
			query.Set("chat", key)
			r.URL.RawQuery = query.Encode()
		}
		next.ServeHTTP(w, r)
	})
}
