// ---------------------------------------------------------------------------
// Bawaba Command -- API client for the Go backend on :8081
// ---------------------------------------------------------------------------

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8081';

// ---------------------------------------------------------------------------
// Shared envelope the backend wraps every response in
// ---------------------------------------------------------------------------

interface ApiEnvelope<T> {
  data: T;
  meta: {
    page?: number;
    limit?: number;
    total?: number;
    timestamp: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Exported domain types
// ---------------------------------------------------------------------------

export interface ApiEvent {
  event_id: string;
  timestamp: string;
  event_type: string;
  agent_id: string;
  tenant_id: string;
  jurisdiction: string;
  mcp_server: string;
  tool: string;
  params_hash: string;
  resource_path: string;
  policy_result: string;
  policy_version: string;
  matched_rule: string;
  pii_mode: string;
  entities_detected: number;
  tokens_generated: number;
  response_status: string;
  result_count: number;
  latency_ms: number;
  overhead_ms: number;
  routing_proof: string;
  event_hash: string;
  prev_hash: string;
  merkle_root: string;
  signature: string;
}

export interface HealthResponse {
  status: string;
  uptime_seconds: number;
  version: string;
  modules_status: Record<string, string>;
}

export interface EventsResponse {
  events: ApiEvent[];
  total: number;
  page: number;
}

export interface StatsResponse {
  total_events: number;
  calls_last_minute: number;
  deny_rate: number;
  avg_latency_ms: number;
  events_by_type: Record<string, number>;
}

export interface PiiStatEntry {
  date: string;
  pii_mode: string;
  entities_detected: number;
  tokens_generated: number;
  event_count: number;
}

export interface AgentInfo {
  id: string;
  auth: string;
  allowed_tools: string[];
  denied_tools: string[];
  pii_mode: string;
  rate_limit: string;
  max_results: number;
}

export interface AgentActivityEntry {
  event_id: string;
  timestamp: string;
  event_type: string;
  tool: string;
  policy_result: string;
  latency_ms: number;
}

export interface ChainVerification {
  valid: boolean;
  events: number;
  verified_at: string;
  error?: string;
}

export interface PolicyEntry {
  agent_id: string;
  allowed_tools: string[];
  denied_tools: string[];
  pii_mode: string;
  rate_limit: string;
}

export interface JurisdictionEntry {
  code: string;
  backend: string;
  compliance: string[];
  event_count: number;
}

export interface EventFilters {
  agent?: string;
  action?: string;
  jurisdiction?: string;
}

// ---------------------------------------------------------------------------
// Typed error for API failures
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  public readonly status: number;
  public readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Perform a fetch request and unwrap the envelope, returning only `data`.
 */
async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      url,
    );
  }

  const envelope: ApiEnvelope<T> = await response.json();
  return envelope.data;
}

/**
 * Build a query string from an object, omitting undefined values.
 */
function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/health
 */
export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/v1/health');
}

/**
 * GET /api/v1/events?page=X&limit=Y&agent=Z&action=W&jurisdiction=J
 */
export async function fetchEvents(
  page: number = 1,
  limit: number = 50,
  filters?: EventFilters,
): Promise<EventsResponse> {
  const query = qs({
    page,
    limit,
    agent: filters?.agent,
    action: filters?.action,
    jurisdiction: filters?.jurisdiction,
  });
  const url = `${BASE_URL}/api/v1/events${query}`;
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!response.ok) {
    throw new ApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      url,
    );
  }
  const envelope: ApiEnvelope<ApiEvent[]> = await response.json();
  return {
    events: envelope.data || [],
    total: envelope.meta?.total ?? envelope.data?.length ?? 0,
    page: envelope.meta?.page ?? page,
  };
}

/**
 * SSE stream on /api/v1/events/stream
 *
 * Calls `callback` for every event received. Returns a cleanup function that
 * closes the underlying EventSource.
 */
export function streamEvents(callback: (event: ApiEvent) => void): () => void {
  const url = `${BASE_URL}/api/v1/events/stream`;
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const RECONNECT_DELAY_MS = 3_000;

  function handleMessage(msg: MessageEvent) {
    try {
      const parsed: ApiEvent = JSON.parse(msg.data);
      callback(parsed);
    } catch {
      // Silently skip malformed messages
    }
  }

  function handleError() {
    eventSource?.close();
    eventSource = null;

    if (!disposed) {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }

  function connect() {
    if (disposed) return;

    eventSource = new EventSource(url);
    eventSource.onmessage = handleMessage;
    eventSource.onerror = handleError;
  }

  // Open the initial connection
  connect();

  // Cleanup function
  return () => {
    disposed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

/**
 * GET /api/v1/stats
 */
export async function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>('/api/v1/stats');
}

/**
 * GET /api/v1/stats/pii
 */
export async function fetchPiiStats(): Promise<PiiStatEntry[]> {
  return request<PiiStatEntry[]>('/api/v1/stats/pii');
}

/**
 * GET /api/v1/agents
 */
export async function fetchAgents(): Promise<AgentInfo[]> {
  return request<AgentInfo[]>('/api/v1/agents');
}

/**
 * GET /api/v1/agents/:id/activity
 */
export async function fetchAgentActivity(id: string): Promise<AgentActivityEntry[]> {
  return request<AgentActivityEntry[]>(`/api/v1/agents/${encodeURIComponent(id)}/activity`);
}

/**
 * POST /api/v1/events/verify
 */
export async function verifyChain(): Promise<ChainVerification> {
  return request<ChainVerification>('/api/v1/events/verify', { method: 'POST' });
}

/**
 * POST /api/v1/events/review
 *
 * Records a human-in-the-loop review decision as a real, chained, signed audit
 * event that references the original event id. Returns the persisted event.
 */
export async function postEventReview(
  eventId: string,
  decision: 'acknowledge' | 'escalate',
  reviewer: string,
): Promise<ApiEvent> {
  return request<ApiEvent>('/api/v1/events/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, decision, reviewer }),
  });
}

/**
 * POST /api/v1/events/export?format=json|csv
 *
 * For CSV the raw text body is returned.
 * For JSON the `data` array from the envelope is returned.
 */
export async function exportEvents(
  format: 'json' | 'csv',
  filters?: EventFilters,
): Promise<string | ApiEvent[]> {
  const query = qs({
    format,
    agent: filters?.agent,
    action: filters?.action,
    jurisdiction: filters?.jurisdiction,
  });

  const url = `${BASE_URL}/api/v1/events/export${query}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new ApiError(
      `Export request failed: ${response.status} ${response.statusText}`,
      response.status,
      url,
    );
  }

  if (format === 'csv') {
    return response.text();
  }

  const envelope: ApiEnvelope<ApiEvent[]> = await response.json();
  return envelope.data;
}

/**
 * GET /api/v1/policies
 */
export async function fetchPolicies(): Promise<PolicyEntry[]> {
  return request<PolicyEntry[]>('/api/v1/policies');
}

/**
 * GET /api/v1/jurisdictions
 */

/**
 * PATCH /api/v1/policies/:agentId — the ONE P0 mutation: edit an EXISTING
 * policy's tool lists (Guided Demo step 6). BAWABA validates, applies to the
 * live engine and records a signed policy_change audit event.
 */
export async function patchPolicy(
  agentId: string,
  allowedTools: string[],
  deniedTools: string[],
): Promise<PolicyEntry> {
  return request<PolicyEntry>(`/api/v1/policies/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ allowed_tools: allowedTools, denied_tools: deniedTools }),
  });
}

/**
 * POST a REAL MCP tools/call to the gateway (:8080). Returns the raw JSON-RPC
 * response. The decision, signature and audit event happen server-side; the
 * Guided Demo then reads the REAL event back from /api/v1/events.
 */
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080';
export async function runMcpToolCall(
  agentKey: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bawaba-Key': agentKey },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `demo-${tool}-${Date.now()}`,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  // A policy DENY (403), rate limit (429) or auth refusal (401) is an
  // EXPECTED JSON-RPC outcome carrying the engine's real answer — not a
  // transport failure. Only a non-JSON body (gateway down, proxy error)
  // is thrown.
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(`gateway request failed: ${response.status}`, response.status, `${GATEWAY_URL}/mcp`);
  }
}


// ── P1 control plane ───────────────────────────────────────────────────────
export interface ConditionalRule {
  tool: string;
  effect: 'allow' | 'deny';
  amount_lte?: number;
  currencies?: string[];
  jurisdictions?: string[];
}

export interface PolicyVersionEntry {
  version: string;
  allowed_tools: string[];
  denied_tools: string[];
  conditional_rules: unknown;
  actor: string;
  changed_at: string;
}

export async function createAgent(body: {
  agent_id: string;
  allowed_tools: string[];
  denied_tools: string[];
  conditional_rules?: ConditionalRule[];
  pii_mode?: string;
  rate_limit?: string;
  jurisdiction?: string;
}): Promise<{ agent_id: string; api_key: string; policy_version: string }> {
  return request(`/api/v1/agents`, { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteAgent(agentId: string): Promise<{ agent_id: string; deleted: boolean }> {
  return request(`/api/v1/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
}

export async function fetchPolicyVersions(agentId: string): Promise<PolicyVersionEntry[]> {
  return request(`/api/v1/policies/${encodeURIComponent(agentId)}/versions`);
}



// ── P2 Demo Workspace ──────────────────────────────────────────────────────
export interface WorkspaceAgent { agent_id: string; template: string; api_key: string }
export interface DemoWorkspace { session_id: string; agents: WorkspaceAgent[]; expires_at: string }

export async function createDemoWorkspace(): Promise<DemoWorkspace> {
  return request(`/api/v1/demo/session`, { method: 'POST' });
}

export async function getDemoWorkspace(id: string): Promise<{ session_id: string; expired: boolean; expires_at: string }> {
  return request(`/api/v1/demo/session/${encodeURIComponent(id)}`);
}

export async function addJurisdiction(body: {
  jurisdiction: string;
  backend: string;
  compliance: string[];
}): Promise<{ jurisdiction: string; backend: string; compliance: string[] }> {
  return request(`/api/v1/jurisdictions`, { method: 'POST', body: JSON.stringify(body) });
}

export async function fetchJurisdictions(): Promise<JurisdictionEntry[]> {
  return request<JurisdictionEntry[]>('/api/v1/jurisdictions');
}

// ── P3 Souffleur ─────────────────────────────────────────────────────────────
// Translation-only: the server loads the REAL audit event and asks the
// configured LLM to explain its fields — nothing else. 503 when no provider
// is configured (the Souffleur never invents).
export interface SouffleurStatus { configured: boolean; provider?: string; model?: string; note?: string }
export interface SouffleurExplanation {
  event_id: string;
  explanation: string;
  source: Record<string, unknown>;
  provider: string;
  model: string;
}

export async function fetchSouffleurStatus(): Promise<SouffleurStatus> {
  return request(`/api/v1/souffleur/status`);
}

export async function souffleurExplain(eventId: string, question?: string): Promise<SouffleurExplanation> {
  return request(`/api/v1/souffleur/explain`, {
    method: 'POST',
    body: JSON.stringify({ event_id: eventId, question: question || undefined }),
  });
}

// ---------------------------------------------------------------------------
// Utility: check whether the backend is reachable
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the Go backend responds to the health endpoint.
 * Pages can use this to decide between live API data and mock fallbacks.
 */
export async function isApiAvailable(): Promise<boolean> {
  try {
    await fetchHealth();
    return true;
  } catch {
    return false;
  }
}
