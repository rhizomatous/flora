package redaction

import (
	"bufio"
	"encoding/base64"
	"io"
	"strings"
)

// Reader removes complete known credential representations across arbitrary read
// boundaries. Its lookahead is bounded by the longest credential, not log size.
// The caller owns and closes the source.
func Reader(source io.Reader, secrets ...string) io.Reader {
	var forms []string
	window := 1
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		forms = append(forms, secret)
		for _, prefix := range []string{"opencode:", "x-access-token:", "flora:"} {
			forms = append(forms, base64.StdEncoding.EncodeToString([]byte(prefix+secret)))
		}
	}
	for _, form := range forms {
		window = max(window, len(form))
	}
	return &reader{source: bufio.NewReaderSize(source, max(32768, window)), forms: forms, window: window}
}

type reader struct {
	source  *bufio.Reader
	forms   []string
	window  int
	pending string
}

func (r *reader) Read(p []byte) (int, error) {
	n := 0
	for n < len(p) {
		if r.pending != "" {
			count := copy(p[n:], r.pending)
			r.pending = r.pending[count:]
			n += count
			continue
		}
		peek, err := r.source.Peek(r.window)
		if len(peek) == 0 {
			if n > 0 {
				return n, nil
			}
			return 0, err
		}
		matched := false
		for _, form := range r.forms {
			if strings.HasPrefix(string(peek), form) {
				_, _ = r.source.Discard(len(form))
				r.pending = "[redacted]"
				matched = true
				break
			}
		}
		if !matched {
			p[n], _ = r.source.ReadByte()
			n++
		}
	}
	return n, nil
}
