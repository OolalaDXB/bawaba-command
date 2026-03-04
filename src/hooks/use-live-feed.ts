import { useState, useEffect, useCallback, useRef } from 'react';
import { generateEvent, generateInitialEvents, type MCPEvent } from '@/lib/mock-data';
import { isApiAvailable, streamEvents, fetchEvents, type ApiEvent } from '@/services/api';

const MAX_EVENTS = 100;

/** Map an API event (snake_case) to the MCPEvent shape used by the UI. */
function mapApiEvent(apiEvt: ApiEvent): MCPEvent {
  return {
    id: apiEvt.event_id,
    timestamp: new Date(apiEvt.timestamp),
    agent: apiEvt.agent_id,
    tool: apiEvt.tool,
    decision:
      apiEvt.policy_result === 'allow'
        ? 'allow'
        : apiEvt.policy_result === 'deny'
          ? 'deny'
          : 'rate-limited',
    piiTokens: apiEvt.entities_detected || 0,
    latency: apiEvt.latency_ms || 0,
    jurisdiction: apiEvt.jurisdiction,
    hash: apiEvt.event_hash || '',
    prevHash: apiEvt.prev_hash || '',
    details: {
      request_id: apiEvt.event_id,
      agent_id: apiEvt.agent_id,
      tool_name: apiEvt.tool,
      policy_matched: apiEvt.matched_rule,
      pii_entities: [],
      jurisdiction: apiEvt.jurisdiction,
      evaluation_time_ms: apiEvt.overhead_ms?.toFixed(2) ?? '0.00',
    },
  };
}

export function useLiveFeed(initialCount = 25) {
  const [events, setEvents] = useState<MCPEvent[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [apiReady, setApiReady] = useState<boolean | null>(null); // null = checking
  const cleanupRef = useRef<(() => void) | null>(null);

  // On mount, check API availability and seed initial events
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const available = await isApiAvailable();
      if (cancelled) return;
      setApiReady(available);

      if (available) {
        // Try to fetch initial events from the API
        try {
          const resp = await fetchEvents(1, initialCount);
          if (!cancelled) {
            const mapped = (resp.events || []).map(mapApiEvent).reverse();
            setEvents(mapped.length > 0 ? mapped : generateInitialEvents(initialCount));
          }
        } catch {
          // If fetch fails, fall back to mock
          if (!cancelled) {
            setEvents(generateInitialEvents(initialCount));
          }
        }
      } else {
        setEvents(generateInitialEvents(initialCount));
      }
    }

    init();
    return () => { cancelled = true; };
  }, [initialCount]);

  // Live streaming / mock generation
  useEffect(() => {
    if (!isLive || apiReady === null) return;

    if (apiReady) {
      // Connect to SSE stream
      const cleanup = streamEvents((apiEvt: ApiEvent) => {
        const mapped = mapApiEvent(apiEvt);
        setEvents(prev => [mapped, ...prev].slice(0, MAX_EVENTS));
      });
      cleanupRef.current = cleanup;
      return () => {
        cleanup();
        cleanupRef.current = null;
      };
    } else {
      // Fall back to mock event generation
      const interval = setInterval(() => {
        const newEvent = generateEvent();
        setEvents(prev => [newEvent, ...prev].slice(0, MAX_EVENTS));
      }, 2000 + Math.random() * 1500);

      return () => clearInterval(interval);
    }
  }, [isLive, apiReady]);

  const toggleLive = useCallback(() => setIsLive(prev => !prev), []);

  return { events, isLive, toggleLive };
}
