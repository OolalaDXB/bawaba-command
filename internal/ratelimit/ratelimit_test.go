package ratelimit

import (
	"testing"
	"time"
)

func TestParseRateLimit(t *testing.T) {
	tests := []struct {
		input  string
		limit  int
		window time.Duration
		err    bool
	}{
		{"1000/hour", 1000, time.Hour, false},
		{"500/minute", 500, time.Minute, false},
		{"10/second", 10, time.Second, false},
		{"100/day", 100, 24 * time.Hour, false},
		{"invalid", 0, 0, true},
		{"abc/hour", 0, 0, true},
		{"100/unknown", 0, 0, true},
	}

	for _, tt := range tests {
		rl, err := ParseRateLimit(tt.input)
		if (err != nil) != tt.err {
			t.Errorf("ParseRateLimit(%q) error = %v, want error = %v", tt.input, err, tt.err)
			continue
		}
		if err == nil {
			if rl.Limit != tt.limit {
				t.Errorf("ParseRateLimit(%q) limit = %d, want %d", tt.input, rl.Limit, tt.limit)
			}
			if rl.Window != tt.window {
				t.Errorf("ParseRateLimit(%q) window = %v, want %v", tt.input, rl.Window, tt.window)
			}
		}
	}
}

func TestSlidingWindow(t *testing.T) {
	sw := NewSlidingWindow(3, 100*time.Millisecond)

	// First 3 should be allowed
	for i := 0; i < 3; i++ {
		if !sw.Allow() {
			t.Errorf("request %d should be allowed", i+1)
		}
	}

	// 4th should be denied
	if sw.Allow() {
		t.Error("4th request should be denied")
	}

	// Wait for window to expire
	time.Sleep(150 * time.Millisecond)

	// Should be allowed again
	if !sw.Allow() {
		t.Error("request after window expiry should be allowed")
	}
}

func TestLimiter(t *testing.T) {
	limiter := NewLimiter()
	limiter.Configure("agent-1", 2, time.Second)

	if !limiter.Allow("agent-1") {
		t.Error("first request should be allowed")
	}
	if !limiter.Allow("agent-1") {
		t.Error("second request should be allowed")
	}
	if limiter.Allow("agent-1") {
		t.Error("third request should be denied")
	}

	// Unconfigured agent should be allowed
	if !limiter.Allow("agent-unknown") {
		t.Error("unconfigured agent should be allowed")
	}
}

func TestAnomalyDetector(t *testing.T) {
	ad := NewAnomalyDetector(3, time.Second)

	// First 2 reads: no anomaly
	if ad.RecordRead("agent-1", "database", "table1") {
		t.Error("1st read should not trigger anomaly")
	}
	if ad.RecordRead("agent-1", "database", "table2") {
		t.Error("2nd read should not trigger anomaly")
	}

	// 3rd read: anomaly triggered
	if !ad.RecordRead("agent-1", "database", "table3") {
		t.Error("3rd read should trigger anomaly (threshold=3)")
	}
}
