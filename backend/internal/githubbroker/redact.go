package githubbroker

import (
	"bufio"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
)

type noTrailerBody struct {
	io.ReadCloser
	response *http.Response
}

func (b *noTrailerBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if err != nil {
		b.response.Trailer = nil
	}
	return n, err
}

// redactedBody hides exact upstream credential representations across stream
// chunk boundaries without buffering an entire Git pack or API response.
type redactedBody struct {
	reader  *bufio.Reader
	closer  io.Closer
	secrets []string
	pending string
	window  int
}

func credentialForms(token string) []string {
	if token == "" {
		return nil
	}
	return []string{token, base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))}
}

func redact(text string, secrets []string) string {
	for _, secret := range secrets {
		text = strings.ReplaceAll(text, secret, "[redacted]")
	}
	return text
}

func newRedactedBody(body io.ReadCloser, secrets []string) io.ReadCloser {
	window := 1
	for _, secret := range secrets {
		if len(secret) > window {
			window = len(secret)
		}
	}
	return &redactedBody{reader: bufio.NewReaderSize(body, max(32768, window)), closer: body, secrets: secrets, window: window}
}

func (r *redactedBody) Close() error { return r.closer.Close() }
func (r *redactedBody) Read(p []byte) (int, error) {
	n := 0
	for n < len(p) {
		if r.pending != "" {
			count := copy(p[n:], r.pending)
			n += count
			r.pending = r.pending[count:]
			continue
		}
		peek, err := r.reader.Peek(r.window)
		if len(peek) == 0 {
			if n > 0 {
				return n, nil
			}
			return 0, err
		}
		matched := false
		for _, secret := range r.secrets {
			if strings.HasPrefix(string(peek), secret) {
				_, _ = r.reader.Discard(len(secret))
				r.pending, matched = "[redacted]", true
				break
			}
		}
		if !matched {
			p[n], _ = r.reader.ReadByte()
			n++
		}
	}
	return n, nil
}
