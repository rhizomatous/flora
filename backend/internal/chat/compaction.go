package chat

import (
	"context"
	"errors"
	"strings"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Compaction struct {
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Threshold *int64 `json:"threshold"`
	Default   *int64 `json:"default"`
	Maximum   *int64 `json:"maximum"`
	Reason    string `json:"reason"`
}

// OpenCode 1.2.27 subtracts reserved only from an explicit input limit.
// Without one, its threshold is context minus capped output and reserved is ignored.
func compactionBounds(m ModelOption) Compaction {
	result := Compaction{Provider: m.Provider, Model: m.ID}
	if m.ContextLimit <= 0 || m.ContextLimit > 1e12 {
		result.Reason = "This model does not report a context limit. Its compaction threshold is unknown."
		return result
	}
	output := min(m.OutputLimit, int64(32000))
	if output <= 0 {
		output = 32000
	}
	reserved := min(int64(20000), output)
	threshold := m.ContextLimit - output
	if m.InputLimit > 0 {
		threshold = m.InputLimit - reserved
	}
	if threshold > 0 {
		result.Default = &threshold
	}
	if m.InputLimit <= 0 {
		result.Reason = "This model has no explicit input limit. OpenCode 1.2.27 ignores custom compaction reserves for it."
	} else if m.InputLimit > m.ContextLimit || threshold <= 0 {
		result.Reason = "This model reports incompatible input and context limits. Custom compaction is unavailable."
	} else {
		result.Maximum = &threshold
	}
	return result
}

func (s *Service) Compaction(ctx context.Context, id string) (Compaction, error) {
	c, err := s.Store.Chat(ctx, id)
	if err != nil {
		return Compaction{}, err
	}
	e := c.Execution
	options := s.Models(ctx, id)
	if e.Model == "" {
		e = options.Default
	}
	result := Compaction{Provider: e.Provider, Model: e.Model, Reason: options.Error}
	if strings.TrimPrefix(c.HarnessVersion, "opencode/") != "1.2.27" {
		result.Reason = "Custom compaction is not verified for this chat's runtime version."
	} else if options.Error == "" {
		for _, m := range options.Models {
			if m.Provider == e.Provider && m.ID == e.Model {
				result = compactionBounds(m)
				break
			}
		}
		if result.Default == nil && result.Reason == "" {
			result.Reason = "This model's compaction limits are unavailable. Retry model discovery."
		}
	}
	result.Threshold, err = s.Store.CompactionThreshold(ctx, id, e)
	return result, err
}

func (s *Service) SetCompaction(ctx context.Context, id string, e storage.Execution, threshold *int64) (Compaction, error) {
	unlock := s.lockOperation(id)
	defer unlock()
	options, err := s.Compaction(ctx, id)
	if err != nil {
		return options, err
	}
	if e.Provider != options.Provider || e.Model != options.Model {
		return options, storage.ErrStale
	}
	if threshold != nil && (options.Maximum == nil || *threshold < 1 || *threshold > *options.Maximum) {
		reason := options.Reason
		if reason == "" {
			reason = "Choose a positive token threshold no later than the runtime default."
		}
		return options, &ControlError{Reason: reason}
	}
	if err = s.Store.SetCompactionThreshold(ctx, id, e, threshold); err != nil {
		return options, err
	}
	options.Threshold = threshold
	return options, nil
}

// Apply the model-specific choice captured at acceptance while the session is idle.
// Child sessions share this runtime reserve, including when they use another model.
// Global config belongs to this chat's isolated runtime and survives process restart.
// Re-read actual model limits so metadata changes cannot silently weaken the reserve.
func (s *Service) applyCompaction(ctx context.Context, rt *runtime, c storage.Chat, e storage.Execution, threshold *int64) error {
	var err error
	var config struct {
		Compaction struct {
			Reserved *int64 `json:"reserved"`
			Auto     *bool  `json:"auto"`
		} `json:"compaction"`
	}
	if err = rt.call(ctx, "GET", "/config", nil, &config); err != nil {
		return err
	}
	// Untouched runtimes retain their native defaults without a configuration write.
	if threshold == nil && config.Compaction.Reserved == nil {
		return nil
	}
	if strings.TrimPrefix(c.HarnessVersion, "opencode/") != "1.2.27" {
		return errors.New("compaction runtime version is unsupported")
	}
	var providers runtimeProviders
	if err = rt.call(ctx, "GET", "/provider", nil, &providers); err != nil {
		return err
	}
	for _, p := range providers.All {
		if p.ID != e.Provider {
			continue
		}
		m, ok := p.Models[e.Model]
		if !ok {
			break
		}
		option := ModelOption{Provider: e.Provider, ID: e.Model, ContextLimit: m.Limit.Context, InputLimit: m.Limit.Input, OutputLimit: m.Limit.Output}
		bounds := compactionBounds(option)
		output := min(m.Limit.Output, int64(32000))
		if output <= 0 {
			output = 32000
		}
		reserved := min(int64(20000), output)
		if threshold != nil {
			if bounds.Maximum == nil || *threshold < 1 || *threshold > *bounds.Maximum || config.Compaction.Auto != nil && !*config.Compaction.Auto {
				return errors.New("saved compaction threshold is unavailable for this model")
			}
			reserved = m.Limit.Input - *threshold
		}
		if config.Compaction.Reserved != nil && *config.Compaction.Reserved == reserved {
			return nil
		}
		if err = rt.call(ctx, "PATCH", "/global/config", map[string]any{"compaction": map[string]int64{"reserved": reserved}}, nil); err != nil {
			return err
		}
		// Global updates dispose instances asynchronously; wait for disposal before confirming the read.
		if err = rt.call(ctx, "POST", "/instance/dispose", nil, nil); err != nil {
			return err
		}
		if err = rt.call(ctx, "GET", "/config", nil, &config); err != nil {
			return err
		}
		if config.Compaction.Reserved == nil || *config.Compaction.Reserved != reserved {
			return errors.New("runtime did not apply compaction reserve")
		}
		return nil
	}
	return errors.New("compaction model metadata is unavailable")
}
