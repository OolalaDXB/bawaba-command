package siem

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// WebhookForwarder sends audit events as JSON POST requests to a webhook endpoint.
// Calls are fire-and-forget (non-blocking) with up to 3 retries on failure.
type WebhookForwarder struct {
	endpoint string
	token    string
	client   *http.Client

	mu      sync.Mutex
	healthy bool
	lastErr error
}

// NewWebhookForwarder creates a new webhook-based SIEM forwarder.
func NewWebhookForwarder(endpoint, token string) *WebhookForwarder {
	return &WebhookForwarder{
		endpoint: endpoint,
		token:    token,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		healthy: true,
	}
}

// Forward sends the event in a non-blocking goroutine.
func (w *WebhookForwarder) Forward(event AuditEvent) {
	go w.send(event)
}

// Health returns nil if the last send attempt was successful.
func (w *WebhookForwarder) Health() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.healthy {
		return w.lastErr
	}
	return nil
}

// Close is a no-op for the webhook forwarder (the HTTP client does not need closing).
func (w *WebhookForwarder) Close() error {
	return nil
}

// send performs the POST with exponential backoff retry (1s, 2s, 4s).
func (w *WebhookForwarder) send(event AuditEvent) {
	body, err := json.Marshal(event)
	if err != nil {
		w.setError(fmt.Errorf("siem: marshal error: %w", err))
		return
	}

	backoff := 1 * time.Second
	maxRetries := 3

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
		}

		req, err := http.NewRequest(http.MethodPost, w.endpoint, bytes.NewReader(body))
		if err != nil {
			w.setError(fmt.Errorf("siem: request error: %w", err))
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		if w.token != "" {
			req.Header.Set("Authorization", "Bearer "+w.token)
		}

		resp, err := w.client.Do(req)
		if err != nil {
			w.setError(fmt.Errorf("siem: send error: %w", err))
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			w.setHealthy()
			return
		}

		// Retry on server errors (5xx)
		if resp.StatusCode >= 500 {
			w.setError(fmt.Errorf("siem: server error %d", resp.StatusCode))
			continue
		}

		// Non-retryable client error (4xx)
		w.setError(fmt.Errorf("siem: client error %d", resp.StatusCode))
		return
	}
}

func (w *WebhookForwarder) setError(err error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.healthy = false
	w.lastErr = err
}

func (w *WebhookForwarder) setHealthy() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.healthy = true
	w.lastErr = nil
}
