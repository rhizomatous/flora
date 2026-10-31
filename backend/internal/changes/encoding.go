package changes

import (
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

const snapshotLimit = 256 << 20

var errReviewLimit = errors.New("Changes exceed the review storage limit. The last successful review and its full downloads are retained.")

type budgetWriter struct {
	w         io.Writer
	remaining int
}

func (w *budgetWriter) Write(p []byte) (int, error) {
	if len(p) > w.remaining {
		return 0, errReviewLimit
	}
	n, err := w.w.Write(p)
	w.remaining -= n
	return n, err
}

type jsonStream struct {
	w   io.Writer
	err error
}

func (s *jsonStream) raw(text string) {
	if s.err == nil {
		_, s.err = io.WriteString(s.w, text)
	}
}
func (s *jsonStream) value(v any) {
	if s.err != nil {
		return
	}
	b, err := json.Marshal(v)
	if err != nil {
		s.err = err
		return
	}
	_, s.err = s.w.Write(b)
}

// Escape bounded chunks at UTF-8 boundaries. Encoding one giant diff with
// json.Marshal would allocate its entire escaped form before checking a budget.
func (s *jsonStream) text(text string) {
	s.raw(`"`)
	for len(text) > 0 && s.err == nil {
		end := 0
		for end < len(text) && end < 4096 {
			_, n := utf8.DecodeRuneInString(text[end:])
			end += n
		}
		b, err := json.Marshal(text[:end])
		if err != nil {
			s.err = err
			return
		}
		_, s.err = s.w.Write(b[1 : len(b)-1])
		text = text[end:]
	}
	s.raw(`"`)
}

func encodeFiles(w io.Writer, files []File) error {
	s := jsonStream{w: w}
	s.raw("[")
	for i, f := range files {
		if s.err != nil {
			return s.err
		}
		if i > 0 {
			s.raw(",")
		}
		s.raw(`{"path":`)
		s.text(f.Path)
		s.raw(`,"previous":`)
		s.text(f.Previous)
		s.raw(`,"status":`)
		s.text(f.Status)
		s.raw(`,"binary":`)
		s.value(f.Binary)
		s.raw(`,"undisplayable":`)
		s.value(f.Undisplayable)
		s.raw(`,"bytes":`)
		s.value(f.Bytes)
		s.raw(`,"truncated":`)
		s.value(f.Truncated)
		s.raw(`,"diff":`)
		s.text(f.Diff)
		s.raw("}")
	}
	s.raw("]")
	return s.err
}

func encodeJSON(w io.Writer, v any) error {
	if snapshot, ok := v.(*Snapshot); ok {
		s := jsonStream{w: w}
		s.raw(`{"id":`)
		s.text(snapshot.ID)
		s.raw(`,"capturedAt":`)
		s.text(snapshot.CapturedAt)
		s.raw(`,"base":`)
		s.text(snapshot.Base)
		s.raw(`,"files":`)
		if s.err == nil {
			s.err = encodeFiles(w, snapshot.Files)
		}
		s.raw("}")
		return s.err
	}
	return json.NewEncoder(w).Encode(v)
}
