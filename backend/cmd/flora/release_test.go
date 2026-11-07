package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"testing"
)

func TestVersionDoesNotRequireRuntimeConfiguration(t *testing.T) {
	// The test executable registers the same flag as the shipped command. Flag
	// parsing must exit before storage, TLS or Docker initialization can run.
	cmd := exec.Command(os.Args[0], "-version")
	cmd.Dir = t.TempDir()
	cmd.Env = []string{"PATH=/nonexistent"}
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	var identity map[string]string
	if err := json.Unmarshal(out, &identity); err != nil {
		t.Fatal(err)
	}
	if identity["version"] != releaseVersion || identity["commit"] != releaseCommit || identity["agent_image"] != releaseImage || identity["harness_version"] != "1.2.27" {
		t.Fatalf("unexpected release identity: %v", identity)
	}
}
