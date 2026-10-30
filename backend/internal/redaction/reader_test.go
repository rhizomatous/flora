package redaction

import (
	"encoding/base64"
	"io"
	"strings"
	"testing"
)

type byteReader struct{ io.Reader }

func (r byteReader) Read(p []byte) (int, error) { return r.Reader.Read(p[:min(1, len(p))]) }

func TestReaderRedactsAcrossEveryReadBoundary(t *testing.T) {
	secret := "sk-secret-123456789"
	input := strings.Repeat("x", 32760) + secret + "\n" + base64.StdEncoding.EncodeToString([]byte("opencode:"+secret)) + "\nend"
	got, err := io.ReadAll(Reader(byteReader{strings.NewReader(input)}, secret))
	if err != nil {
		t.Fatal(err)
	}
	want := strings.Repeat("x", 32760) + "[redacted]\n[redacted]\nend"
	if string(got) != want {
		t.Fatal("credential split across chunks was not removed")
	}
}
