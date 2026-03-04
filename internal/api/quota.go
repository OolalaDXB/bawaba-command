package api

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/OolalaDXB/bawaba-command/internal/config"
)

// quotaCounter tracks call count for one agent within the current period.
type quotaCounter struct {
	Count int
	Limit int
}

// QuotaManager enforces per-agent call quotas with in-memory counters.
type QuotaManager struct {
	mu           sync.RWMutex
	counters     map[string]*quotaCounter
	defaultLimit int
	overrides    map[string]int
	period       time.Duration
	resetAt      time.Time
	stopCh       chan struct{}
}

// NewQuotaManager creates a QuotaManager from config. Call Start() to begin the reset timer.
func NewQuotaManager(cfg config.QuotaConfig) (*QuotaManager, error) {
	period, err := time.ParseDuration(cfg.Period)
	if err != nil {
		return nil, fmt.Errorf("quota: invalid period %q: %w", cfg.Period, err)
	}

	overrides := cfg.Overrides
	if overrides == nil {
		overrides = map[string]int{}
	}

	now := time.Now().UTC()
	return &QuotaManager{
		counters:     make(map[string]*quotaCounter),
		defaultLimit: cfg.DefaultLimit,
		overrides:    overrides,
		period:       period,
		resetAt:      now.Add(period),
		stopCh:       make(chan struct{}),
	}, nil
}

// Start launches the background goroutine that resets counters each period.
func (qm *QuotaManager) Start() {
	go qm.resetLoop()
}

// Stop signals the reset goroutine to exit.
func (qm *QuotaManager) Stop() {
	close(qm.stopCh)
}

func (qm *QuotaManager) resetLoop() {
	for {
		qm.mu.RLock()
		sleepDur := time.Until(qm.resetAt)
		qm.mu.RUnlock()

		if sleepDur <= 0 {
			sleepDur = qm.period
		}

		timer := time.NewTimer(sleepDur)
		select {
		case <-qm.stopCh:
			timer.Stop()
			return
		case <-timer.C:
			qm.reset()
		}
	}
}

func (qm *QuotaManager) reset() {
	qm.mu.Lock()
	defer qm.mu.Unlock()
	qm.counters = make(map[string]*quotaCounter)
	qm.resetAt = time.Now().UTC().Add(qm.period)
}

// limitFor returns the quota limit for the given agent.
func (qm *QuotaManager) limitFor(agent string) int {
	if limit, ok := qm.overrides[agent]; ok {
		return limit
	}
	return qm.defaultLimit
}

// getOrCreate returns the counter for an agent, creating it if needed.
// Caller must hold qm.mu write lock.
func (qm *QuotaManager) getOrCreate(agent string) *quotaCounter {
	c, ok := qm.counters[agent]
	if !ok {
		c = &quotaCounter{Limit: qm.limitFor(agent)}
		qm.counters[agent] = c
	}
	return c
}

// Allow checks if the agent is under quota. If yes, increments counter and returns true.
// If no, returns false.
func (qm *QuotaManager) Allow(agent string) bool {
	qm.mu.Lock()
	defer qm.mu.Unlock()
	c := qm.getOrCreate(agent)
	if c.Count >= c.Limit {
		return false
	}
	c.Count++
	return true
}

// QuotaUsage holds the current quota usage for an agent.
type QuotaUsage struct {
	Limit     int       `json:"limit"`
	Period    string    `json:"period"`
	Used      int       `json:"used"`
	Remaining int       `json:"remaining"`
	ResetAt   time.Time `json:"-"`
}

// GetUsage returns current usage for the given agent.
func (qm *QuotaManager) GetUsage(agent string) QuotaUsage {
	qm.mu.RLock()
	defer qm.mu.RUnlock()

	limit := qm.limitFor(agent)
	used := 0
	if c, ok := qm.counters[agent]; ok {
		used = c.Count
	}
	remaining := limit - used
	if remaining < 0 {
		remaining = 0
	}

	return QuotaUsage{
		Limit:     limit,
		Period:    qm.period.String(),
		Used:      used,
		Remaining: remaining,
		ResetAt:   qm.resetAt,
	}
}

// SecondsUntilReset returns the number of seconds until the next quota reset.
func (qm *QuotaManager) SecondsUntilReset() int {
	qm.mu.RLock()
	defer qm.mu.RUnlock()
	secs := int(time.Until(qm.resetAt).Seconds())
	if secs < 0 {
		return 0
	}
	return secs
}

// Middleware returns an HTTP middleware that enforces per-agent quotas.
// It reads the agent from the X-Bawaba-Agent header.
func (qm *QuotaManager) Middleware() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			agent := r.Header.Get("X-Bawaba-Agent")
			if agent == "" {
				// No agent header — pass through (dashboard / health checks)
				next.ServeHTTP(w, r)
				return
			}

			if !qm.Allow(agent) {
				retryAfter := qm.SecondsUntilReset()
				w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
				writeError(w, http.StatusTooManyRequests, "quota exceeded")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
