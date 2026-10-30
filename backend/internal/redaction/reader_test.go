package redaction

import (
	"encoding/base64"
	"errors"
	"io"
	"strings"
	"testing"
	"testing/iotest"
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

func TestReaderRetainsTerminalReadErrorsWhileMaskingFragments(t *testing.T) {
	secret := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabc"
	failure := errors.New("source unavailable")
	source := io.MultiReader(strings.NewReader("ordinary output\n"+secret[:20]), iotest.ErrReader(failure))
	got, err := io.ReadAll(Reader(source, secret))
	if !errors.Is(err, failure) || string(got) != "ordinary output\n[redacted]" {
		t.Fatal("terminal error or boundary redaction was lost")
	}
}

func TestReaderMasksUnfinishedPrefixesAtEOF(t *testing.T) {
	secret := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabc"
	for _, form := range []string{secret, base64.StdEncoding.EncodeToString([]byte("opencode:" + secret))} {
		for n := 1; n < len(form); n++ {
			paddingSizes := []int{0}
			if n == 8 || n == 20 || n == len(form)-1 {
				paddingSizes = append(paddingSizes, 32760, 32768, 65535)
			}
			for _, padding := range paddingSizes {
				input := strings.Repeat("x", padding) + form[:n]
				for _, chunked := range []bool{false, true} {
					var source io.Reader = strings.NewReader(input)
					if chunked {
						source = byteReader{source}
					}
					got, err := io.ReadAll(Reader(source, secret))
					if err != nil {
						t.Fatal(err)
					}
					want := input
					if n >= 8 {
						want = strings.Repeat("x", padding) + fragmentMarker(n)
					}
					if string(got) != want {
						t.Fatalf("EOF fragment leaked or ordinary text lost at prefix length %d", n)
					}
				}
			}
		}
	}
}

func TestReaderDoesNotReadWholeGrowingLogIntoMemory(t *testing.T) {
	secret := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabc"
	source := &countReader{Reader: io.LimitReader(repeatedByte{}, 64<<20)}
	reader := Reader(source, secret)
	buf := make([]byte, 11)
	if n, err := reader.Read(buf); err != nil || n != len(buf) {
		t.Fatal("stream did not return bounded output")
	}
	if source.read > 32768 {
		t.Fatal("reader buffered the log instead of bounded lookahead")
	}
}

type countReader struct {
	io.Reader
	read int
}

func (r *countReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.read += n
	return n, err
}

type repeatedByte struct{}

func (repeatedByte) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	return len(p), nil
}
