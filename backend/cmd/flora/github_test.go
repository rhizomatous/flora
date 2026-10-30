package main

import (
	"context"
	"strings"
	"testing"
)

func TestGitHubListenerRequiresPrivateIPAndTLS(t *testing.T) {
	for _, addr := range []string{"0.0.0.0:443", "[::]:443", "8.8.8.8:443", "public.example:443", "invalid"} {
		if err := serveGitHub(context.Background(), nil, addr, "missing", "missing"); err == nil || !strings.Contains(err.Error(), "private") {
			t.Fatalf("listen %q: %v", addr, err)
		}
	}
	if err := serveGitHub(context.Background(), nil, "127.0.0.1:0", "missing", "missing"); err == nil || !strings.Contains(err.Error(), "TLS") {
		t.Fatalf("missing TLS accepted: %v", err)
	}
}
