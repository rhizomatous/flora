package server

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rhizomatous/flora/backend/internal/chat"
)

func (a *api) shellRoutes(mux *http.ServeMux) {
	// Bound concurrent streams globally, including disconnected or slow clients.
	slots := make(chan struct{}, 32)
	for _, pattern := range []string{"GET /api/chats/{id}/shells", "POST /api/chats/{id}/shells", "DELETE /api/chats/{id}/shells/{shell}", "PUT /api/chats/{id}/shells/{shell}"} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if a.chats == nil {
				failure(w, 503, "Chat runtime is not configured.")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), chat.ShellRequestTimeout)
			defer cancel()
			id := r.PathValue("id")
			switch r.Method {
			case "GET":
				shells, err := a.chats.Shells(ctx, id)
				if err != nil {
					chatError(w, err)
					return
				}
				jsonResponse(w, 200, map[string]any{"shells": shells, "count": len(shells)})
			case "POST":
				var in struct{}
				if !decode(w, r, &in) {
					return
				}
				shell, err := a.chats.CreateShell(ctx, id)
				if err != nil {
					chatError(w, err)
					return
				}
				jsonResponse(w, 201, shell)
			case "PUT":
				var in struct {
					Rows int `json:"rows"`
					Cols int `json:"cols"`
				}
				if !decode(w, r, &in) {
					return
				}
				if err := a.chats.ResizeShell(ctx, id, r.PathValue("shell"), in.Rows, in.Cols); err != nil {
					chatError(w, err)
					return
				}
				jsonResponse(w, 200, map[string]bool{"ok": true})
			case "DELETE":
				if err := a.chats.CloseShell(ctx, id, r.PathValue("shell")); err != nil {
					chatError(w, err)
					return
				}
				jsonResponse(w, 200, map[string]bool{"ok": true})
			}
		})
	}
	mux.HandleFunc("GET /api/chats/{id}/shells/{shell}/connect", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != a.origin {
			failure(w, 403, "Open terminals from Flora's configured address.")
			return
		}
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			failure(w, 429, "Too many terminal connections. Close another terminal and reconnect.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), chat.ShellRequestTimeout)
		shell, ep, err := a.chats.ShellEndpoint(ctx, r.PathValue("id"), r.PathValue("shell"))
		cancel()
		if err != nil {
			chatError(w, err)
			return
		}
		upstreamURL, _ := url.Parse(ep.URL)
		upstreamURL.Scheme = "ws"
		upstreamURL.Path = "/pty/" + shell.RuntimeID + "/connect"
		upstreamURL.RawQuery = "directory=%2Fworkspace"
		headers := http.Header{"Authorization": []string{"Basic " + base64.StdEncoding.EncodeToString([]byte(ep.Username+":"+ep.Password))}}
		upstream, resp, err := (&websocket.Dialer{HandshakeTimeout: 10 * time.Second}).DialContext(r.Context(), upstreamURL.String(), headers)
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		if err != nil {
			failure(w, 503, "Could not reconnect this shell. Refresh its machine state.")
			return
		}
		defer upstream.Close()
		browser, err := (&websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == a.origin }}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer browser.Close()
		browser.SetReadLimit(16 << 10)
		upstream.SetReadLimit(256 << 10)
		deadline := time.Now().Add(15 * time.Minute)
		browser.SetReadDeadline(deadline)
		upstream.SetReadDeadline(deadline)
		done := make(chan struct{})
		var once sync.Once
		finish := func() { once.Do(func() { close(done); browser.Close(); upstream.Close() }) }
		defer finish()
		go func() {
			defer finish()
			inputBytes := 0
			for {
				kind, b, err := browser.ReadMessage()
				if err != nil {
					return
				}
				if kind != websocket.TextMessage {
					return
				}
				inputBytes += len(b)
				if inputBytes > 1<<20 {
					return
				}
				upstream.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if upstream.WriteMessage(kind, b) != nil {
					return
				}
			}
		}()
		// Recheck account authorization while a connection is open. A logged-out
		// browser cannot keep an already upgraded socket indefinitely.
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
					valid, err := a.auth.Valid(ctx, token(r))
					cancel()
					if err != nil || !valid {
						finish()
						return
					}
				}
			}
		}()
		total := 0
		for {
			kind, b, err := upstream.ReadMessage()
			if err != nil {
				return
			}
			total += len(b)
			if total > 16<<20 {
				return
			}
			browser.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if browser.WriteMessage(kind, b) != nil {
				return
			}
		}
	})
}
