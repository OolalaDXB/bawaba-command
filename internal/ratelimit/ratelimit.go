package ratelimit

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RateLimitConfig parsed from "1000/hour" format.
type RateLimitConfig struct {
	Limit    int
	Window   time.Duration
}

// ParseRateLimit parses "1000/hour", "500/minute", etc.
func ParseRateLimit(s string) (RateLimitConfig, error) {
	if s == "" {
		return RateLimitConfig{Limit: 10000, Window: time.Hour}, nil
	}
	parts := strings.SplitN(s, "/", 2)
	if len(parts) != 2 {
		return RateLimitConfig{}, fmt.Errorf("ratelimit: invalid format %q (expected N/unit)", s)
	}
	limit, err := strconv.Atoi(parts[0])
	if err != nil {
		return RateLimitConfig{}, fmt.Errorf("ratelimit: invalid limit %q: %w", parts[0], err)
	}
	var window time.Duration
	switch strings.ToLower(parts[1]) {
	case "second", "sec", "s":
		window = time.Second
	case "minute", "min", "m":
		window = time.Minute
	case "hour", "hr", "h":
		window = time.Hour
	case "day", "d":
		window = 24 * time.Hour
	default:
		return RateLimitConfig{}, fmt.Errorf("ratelimit: unknown unit %q", parts[1])
	}
	return RateLimitConfig{Limit: limit, Window: window}, nil
}

// SlidingWindow implements a sliding window rate limiter.
type SlidingWindow struct {
	mu         sync.Mutex
	timestamps []time.Time
	limit      int
	window     time.Duration
}

// NewSlidingWindow creates a new sliding window rate limiter.
func NewSlidingWindow(limit int, window time.Duration) *SlidingWindow {
	return &SlidingWindow{
		timestamps: make([]time.Time, 0, limit),
		limit:      limit,
		window:     window,
	}
}

// Allow checks if a request is allowed under the rate limit.
func (sw *SlidingWindow) Allow() bool {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-sw.window)

	// Remove expired timestamps
	valid := sw.timestamps[:0]
	for _, ts := range sw.timestamps {
		if ts.After(cutoff) {
			valid = append(valid, ts)
		}
	}
	sw.timestamps = valid

	if len(sw.timestamps) >= sw.limit {
		return false
	}

	sw.timestamps = append(sw.timestamps, now)
	return true
}

// Limiter manages per-agent rate limits.
type Limiter struct {
	mu      sync.RWMutex
	windows map[string]*SlidingWindow // key: "agent_id" or "agent_id:tool"
}

// NewLimiter creates a new rate limiter.
func NewLimiter() *Limiter {
	return &Limiter{
		windows: make(map[string]*SlidingWindow),
	}
}

// Configure sets the rate limit for an agent.
func (l *Limiter) Configure(agentID string, limit int, window time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.windows[agentID] = NewSlidingWindow(limit, window)
}

// Allow checks if a request from the given agent is allowed.
func (l *Limiter) Allow(agentID string) bool {
	l.mu.RLock()
	sw, ok := l.windows[agentID]
	l.mu.RUnlock()

	if !ok {
		// No rate limit configured — default allow
		return true
	}

	return sw.Allow()
}

// AnomalyDetector detects suspicious sequential read patterns.
type AnomalyDetector struct {
	mu                      sync.Mutex
	sequentialReadThreshold int
	windowDuration          time.Duration
	reads                   map[string][]readEvent // key: "agent_id:resource_type"
}

type readEvent struct {
	timestamp time.Time
	resource  string
}

// NewAnomalyDetector creates a new anomaly detector.
func NewAnomalyDetector(threshold int, window time.Duration) *AnomalyDetector {
	return &AnomalyDetector{
		sequentialReadThreshold: threshold,
		windowDuration:          window,
		reads:                   make(map[string][]readEvent),
	}
}

// RecordRead records a read event and returns true if anomaly detected.
func (ad *AnomalyDetector) RecordRead(agentID, resourceType, resource string) bool {
	ad.mu.Lock()
	defer ad.mu.Unlock()

	key := agentID + ":" + resourceType
	now := time.Now()
	cutoff := now.Add(-ad.windowDuration)

	// Clean old events
	events := ad.reads[key]
	valid := events[:0]
	for _, ev := range events {
		if ev.timestamp.After(cutoff) {
			valid = append(valid, ev)
		}
	}

	valid = append(valid, readEvent{timestamp: now, resource: resource})
	ad.reads[key] = valid

	return len(valid) >= ad.sequentialReadThreshold
}
