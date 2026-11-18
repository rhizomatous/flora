package provisioning

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// ModelMetadata boots only OpenCode's server from the pinned image. It has no
// host mounts, checkout, setup command, GitHub credentials, or saved sessions.
// The process deadline and AutoRemove also bound its lifetime if Flora exits.
func (m *Manager) ModelMetadata(ctx context.Context, credentials storage.Credentials) (result json.RawMessage, err error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	keyName := map[string]string{"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "google": "GOOGLE_GENERATIVE_AI_API_KEY"}[credentials.Provider]
	if keyName == "" || credentials.ProviderKey == "" {
		return nil, errors.New("model provider is not configured")
	}
	image, err := m.resolveImage(ctx)
	if err != nil {
		return nil, err
	}
	password, err := docker.NewPassword()
	if err != nil {
		return nil, err
	}
	config, _ := json.Marshal(map[string]any{"model": credentials.Provider + "/" + credentials.Model, "small_model": credentials.Provider + "/" + credentials.Model, "enabled_providers": []string{credentials.Provider}})
	spec := docker.ContainerSpec{
		Name: "flora-models-" + rand.Text(), Image: image, NetworkID: m.cfg.NetworkID,
		Entrypoint: []string{"timeout", "-k", "5", "45", "opencode"}, Command: []string{"serve", "--hostname", "0.0.0.0", "--port", "4096"},
		User: "1000:1000", WorkingDir: "/tmp", AutoRemove: true,
		Env:    []string{"OPENCODE_SERVER_PASSWORD=" + password, keyName + "=" + credentials.ProviderKey, "OPENCODE_CONFIG_CONTENT=" + string(config)},
		Labels: map[string]string{"flora.model-discovery": "true"}, LoopbackPort: runtimePort, NanoCPUs: 1e9, MemoryBytes: 1 << 30, PidsLimit: 128,
	}
	id, err := m.engine.ContainerCreate(ctx, spec)
	if err != nil {
		return nil, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		removeErr := m.engine.ContainerRemove(cleanup, id, true)
		if removeErr != nil && !docker.IsNotFound(removeErr) {
			result = nil
			err = errors.New("model discovery cleanup failed")
		}
	}()
	if err = m.engine.ContainerStart(ctx, id); err != nil {
		return nil, err
	}
	client := &http.Client{Transport: &http.Transport{}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	for {
		info, inspectErr := m.engine.ContainerInspect(ctx, id)
		if inspectErr != nil || !info.State.Running {
			return nil, errors.New("model discovery runtime is unavailable")
		}
		if address := info.LoopbackAddress(runtimePort); address != "" && m.health(ctx, "http://"+address, password) {
			req, requestErr := http.NewRequestWithContext(ctx, "GET", "http://"+address+"/provider", nil)
			if requestErr != nil {
				return nil, requestErr
			}
			req.SetBasicAuth("opencode", password)
			response, callErr := client.Do(req)
			if callErr != nil {
				return nil, errors.New("model discovery response is unavailable")
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				return nil, errors.New("model discovery request failed")
			}
			raw, readErr := io.ReadAll(io.LimitReader(response.Body, (16<<20)+1))
			if readErr != nil || len(raw) > 16<<20 || !json.Valid(raw) {
				return nil, errors.New("model discovery response is incomplete")
			}
			return json.RawMessage(raw), nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(readyPollStep):
		}
	}
}
