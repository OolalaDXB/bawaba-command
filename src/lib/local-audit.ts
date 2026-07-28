import { useSyncExternalStore } from 'react';
import { type MCPEvent } from './mock-data';

/**
 * Local, in-memory audit store for demo-only events that originate in the UI
 * (agent registration, human-in-the-loop review decisions).
 *
 * It is append-only by design: events are only ever prepended, never mutated
 * or removed. Review decisions reference the original event by id and are
 * chained onto the previous local event — the original event is never touched.
 * No server persistence; state lives for the SPA session.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let injected: MCPEvent[] = []; // newest first
const reviewStatus: Record<string, 'reviewed' | 'escalated'> = {};
let version = 0;
let lastHash = 'local-genesis';
let seq = 0;

function bump() {
  version++;
  listeners.forEach(l => l());
}

function randomHash(n = 12): string {
  const chars = 'abcdef0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export interface InjectedInput {
  eventType: 'agent_registered' | 'review_decision';
  agent: string;
  tool: string;
  decision: MCPEvent['decision'];
  jurisdiction?: string;
  reviewer?: string;
  refEventId?: string;
  reviewLabel?: 'acknowledge' | 'escalate';
  piiTokens?: number;
  details?: Record<string, unknown>;
}

/** Append a new local event, chained onto the previous local event's hash. */
export function pushInjectedEvent(input: InjectedInput): MCPEvent {
  seq += 1;
  const prevHash = lastHash;
  const hash = randomHash();
  lastHash = hash;

  const evt: MCPEvent = {
    id: `loc-${seq}-${randomHash(6)}`,
    timestamp: new Date(),
    agent: input.agent,
    tool: input.tool,
    decision: input.decision,
    piiTokens: input.piiTokens ?? 0,
    latency: 0,
    jurisdiction: input.jurisdiction ?? 'default',
    hash,
    prevHash,
    eventType: input.eventType,
    reviewer: input.reviewer,
    refEventId: input.refEventId,
    reviewLabel: input.reviewLabel,
    details: {
      event_type: input.eventType,
      ...(input.reviewer ? { reviewer: input.reviewer } : {}),
      ...(input.refEventId ? { ref_event_id: input.refEventId } : {}),
      ...(input.reviewLabel ? { review_decision: input.reviewLabel } : {}),
      signature: `ed25519:${randomHash(16)}`,
      ...(input.details ?? {}),
    },
  };

  injected = [evt, ...injected];
  bump();
  return evt;
}

/** Record the review outcome badge for an original event (never mutates it). */
export function setReviewStatus(eventId: string, status: 'reviewed' | 'escalated') {
  reviewStatus[eventId] = status;
  bump();
}

export function getInjectedEvents(): MCPEvent[] {
  return injected;
}
export function getReviewStatus(): Record<string, 'reviewed' | 'escalated'> {
  return reviewStatus;
}
function getVersion(): number {
  return version;
}
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook: re-renders whenever the local audit store changes. */
export function useLocalAudit() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return { injected: getInjectedEvents(), reviewStatus: getReviewStatus() };
}
