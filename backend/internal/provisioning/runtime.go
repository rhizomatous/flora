package provisioning

import (
	"context"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
)

type RuntimeUsage = docker.RuntimeUsage
type RuntimeState struct {
	State           string        `json:"state"`
	ObservedAt      time.Time     `json:"observedAt"`
	CPU             *float64      `json:"cpuLimit"`
	Memory          *int64        `json:"memoryLimit"`
	Usage           *RuntimeUsage `json:"usage"`
	CollectionError string        `json:"collectionError"`
	KeepAwakeUntil  *time.Time    `json:"keepAwakeUntil"`
}

// Runtime reads Docker state independently of saved conversation state. Failed
// inspection leaves state unknown and never supplies guessed resource values.
func (m *Manager) Runtime(ctx context.Context, id string) (RuntimeState, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	r := RuntimeState{State: "unknown", ObservedAt: time.Now().UTC()}
	c, err := m.store.Chat(ctx, id)
	if err != nil {
		return r, err
	}
	lookup := c.ContainerID
	if lookup == "" {
		lookup = containerName(id)
	}
	info, err := m.engine.ContainerInspect(ctx, lookup)
	if docker.IsNotFound(err) {
		r.State = "missing"
		return r, nil
	}
	if err != nil {
		r.CollectionError = "Could not inspect Docker. Retry to refresh machine state."
		return r, nil
	}
	paths, err := m.store.Paths(ctx, id)
	if err != nil {
		return r, err
	}
	image, err := m.engine.ImageInspect(ctx, m.cfg.ImageRef)
	if err != nil {
		r.CollectionError = "Could not verify the configured image."
		return r, nil
	}
	if m.cfg.ImageID != "" && image.ID != m.cfg.ImageID {
		r.CollectionError = "Configured image identity changed."
		return r, nil
	}
	if err := m.validateOwned(info, c, paths, image.ID); err != nil {
		r.CollectionError = "Container identity could not be verified."
		return r, nil
	}
	switch info.State.Status {
	case "created", "restarting":
		r.State = "starting"
	case "running":
		r.State = "running"
	case "exited", "dead":
		r.State = "stopped"
		if info.State.OOMKilled || (info.State.ExitCode != 0 && info.State.ExitCode != 137 && info.State.ExitCode != 143) {
			r.State = "failed"
		}
	}
	cpu := float64(info.HostConfig.NanoCPUs) / 1e9
	r.CPU = &cpu
	r.Memory = &info.HostConfig.Memory
	if r.State == "running" {
		if p, ok := m.engine.(interface {
			ContainerUsage(context.Context, string) (RuntimeUsage, error)
		}); ok {
			u, err := p.ContainerUsage(ctx, info.ID)
			if err == nil {
				r.Usage = &u
			} else {
				r.CollectionError = "Could not collect measured usage. Machine state is from Docker inspection."
			}
		} else {
			r.CollectionError = "Measured usage is unavailable from this runtime."
		}
	}
	return r, nil
}
