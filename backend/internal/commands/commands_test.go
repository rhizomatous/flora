package commands

import (
	"strings"
	"testing"
)

func TestResolve(t *testing.T) {
	for _, text := range []string{"Explain /review", "/workspace/main.go", "https://example.com/review", " /review", "/", "/日本語"} {
		invocation, prompt, err := Resolve(text, "1.2.27")
		if err != nil || invocation != nil || prompt != text {
			t.Fatalf("literal %q: %v %q %v", text, invocation, prompt, err)
		}
	}
	for _, name := range []string{"review", "init"} {
		invocation, prompt, err := Resolve("/"+name+"  main\nextra", "1.2.27")
		if err != nil || invocation == nil || invocation.Name != name || invocation.Arguments != "main\nextra" || invocation.Version != 1 || !strings.Contains(prompt, "main\nextra") {
			t.Fatal(invocation, prompt, err)
		}
		if _, _, err := Resolve("/"+name, "other"); err == nil {
			t.Fatal("accepted unavailable command")
		}
	}
	for _, text := range []string{"/missing", "/compact", "/Review"} {
		if _, _, err := Resolve(text, "1.2.27"); err == nil {
			t.Fatalf("accepted %q", text)
		}
	}
	invocation, prompt, err := Resolve("//review", "other")
	if err != nil || invocation != nil || prompt != "/review" {
		t.Fatal(invocation, prompt, err)
	}
}
