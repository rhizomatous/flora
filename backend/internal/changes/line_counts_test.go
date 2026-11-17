package changes

import "testing"

func TestLineCounts(t *testing.T) {
	patch := "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1,2 @@\n---old\n+++new\n+extra\n\\ No newline at end of file\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -5 +5 @@\n context\n"
	additions, deletions := lineCounts(patch)
	if additions != 2 || deletions != 1 {
		t.Fatalf("counts = +%d -%d", additions, deletions)
	}
}
