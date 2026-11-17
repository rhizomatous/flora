package chat

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type attachmentCatalogTransport struct {
	body   string
	status int
	calls  int
}

func (c *attachmentCatalogTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c.calls++
	if r.URL.String() != "https://models.dev/api.json" {
		return nil, fmt.Errorf("unexpected catalog URL")
	}
	return &http.Response{StatusCode: c.status, Body: io.NopCloser(strings.NewReader(c.body)), Header: make(http.Header)}, nil
}

func TestAttachmentCapabilityPreflightAndRuntimeDelivery(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	screen, err := s.Store.PutAttachment(ctx, project.ID, "screenshot-attachment-1", "screen.png", data.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := s.Store.PutAttachment(ctx, project.ID, "document-attachment-1", "spec.pdf", []byte("%PDF-1.7\n"))
	if err != nil {
		t.Fatal(err)
	}
	document, err := s.Store.PutAttachment(ctx, project.ID, "text-attachment-00001", "spec.md", []byte("do this"))
	if err != nil {
		t.Fatal(err)
	}
	catalog := &attachmentCatalogTransport{status: 503}
	s.ModelCatalogClient = &http.Client{Transport: catalog}
	if err := s.checkAttachments(ctx, project.ID, []string{document.ID}); err != nil || catalog.calls != 0 {
		t.Fatalf("text requires no capability lookup: %v", err)
	}
	if _, err := s.Create(ctx, project.ID, "Unsupported", "unsupported", "", screen.ID); err == nil {
		t.Fatal("accepted unverified image capability")
	}
	chats, _ := s.Store.Chats(ctx)
	if len(chats) != 0 {
		t.Fatal("unsupported input created a chat")
	}
	catalog.status = 200
	catalog.body = `{"anthropic":{"models":{"model":{"modalities":{"input":["text","image","pdf"]}}}}}`
	if err := s.checkAttachments(ctx, project.ID, []string{screen.ID, pdf.ID, document.ID}); err != nil {
		t.Fatal(err)
	}
	c, err := s.Store.CreateChat(ctx, project.ID, "Attachments", testImage, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Store.AcceptMessage(ctx, c.ID, "first", "Look", screen.ID, pdf.ID, document.ID)
	if err != nil {
		t.Fatal(err)
	}
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"all":[{"id":"anthropic","models":{"model":{"capabilities":{"input":{"image":true,"pdf":true}}}}}]}`)
	}))
	defer runtime.Close()
	credentials, _ := s.Store.Credentials(ctx)
	parts, err := s.runtimeParts(ctx, newRuntime(provisioning.Endpoint{URL: runtime.URL}), accepted.Message, credentials)
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 4 || parts[0]["text"] != "Look" || parts[1]["url"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(data.Bytes()) || parts[2]["mime"] != "application/pdf" || parts[3]["text"] != "Attached document: spec.md\n\ndo this" {
		t.Fatalf("incorrect runtime content: %+v", parts)
	}
	// An accepted retry succeeds even if the catalog becomes unavailable.
	catalog.status = 503
	s.attachmentCapabilities.expires = s.attachmentCapabilities.expires.AddDate(-1, 0, 0)
	duplicate, err := s.Submit(ctx, c.ID, "first", "Look", screen.ID, pdf.ID, document.ID)
	if err != nil || !duplicate.Duplicate {
		t.Fatalf("accepted retry failed: %v", err)
	}
	unsupported := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"all":[]}`) }))
	defer unsupported.Close()
	if _, err := s.runtimeParts(ctx, newRuntime(provisioning.Endpoint{URL: unsupported.URL}), accepted.Message, credentials); err == nil {
		t.Fatal("delivered binary to unsupported runtime")
	}
}

func TestTextAttachmentTurnMatchesRuntimeHistory(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	file, err := s.Store.PutAttachment(ctx, project.ID, "text-attachment-00001", "spec.md", []byte("implement this"))
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.Create(ctx, project.ID, "Document", "first", "", file.ID)
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	messages, err := s.Store.Messages(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].RuntimeMessageID == "" || !json.Valid(messages[0].Payload) {
		t.Fatalf("document turn was not linked: %+v", messages)
	}
	duplicate, err := s.Create(ctx, project.ID, "Document", "first", "", file.ID)
	if err != nil || duplicate.ID != c.ID || f.prompts.Load() != 1 {
		t.Fatalf("duplicate delivery: %v", err)
	}
}
