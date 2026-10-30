package redaction

import (
	"bufio"
	"io"
	"strings"
)

// Reader removes known credential representations across arbitrary read boundaries
// and hides unfinished credential prefixes at EOF. Lookahead is bounded by the
// longest credential, not log size.
// The caller owns and closes the source.
func Reader(source io.Reader, secrets ...string) io.Reader {
	forms := credentialForms(secrets)
	window := 1
	for _, form := range forms {
		window = max(window, len(form))
	}
	return &reader{source: bufio.NewReaderSize(source, max(32768, window)), forms: forms, window: window}
}

type reader struct {
	source      *bufio.Reader
	forms       []string
	window      int
	pending     string
	done        bool
	terminalErr error
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
		if r.done {
			if n > 0 {
				return n, nil
			}
			return 0, r.terminalErr
		}
		peek, err := r.source.Peek(r.window)
		if err != nil {
			r.pending = maskEdges(replaceForms(string(peek), r.forms), r.forms, false, true)
			_, _ = r.source.Discard(len(peek))
			r.done, r.terminalErr = true, err
			continue
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
