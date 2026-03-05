import { useState } from 'react';
import { X } from 'lucide-react';

type Persona = 'engineer' | 'ciso' | 'vc';

type PersonaContent = Record<Persona, string>;

interface PipelineStep {
  id: string;
  name: string;
  description: string;
  role: PersonaContent;
  file: PersonaContent;
  p0Fix: PersonaContent;
  p2Roadmap: PersonaContent;
  actions: PersonaContent;
}

interface Module {
  name: string;
  lang: 'Go' | 'Rust' | 'TS' | 'YAML';
  file: string;
  loc: number;
  status: ('DONE' | 'P0-FIXED')[];
  detail: PersonaContent;
}

interface Commit {
  hash: string;
  message: string;
  date: string;
  sprint: 'S1' | 'S2';
  why: PersonaContent;
}

type DrawerContent =
  | { type: 'pipeline'; step: PipelineStep }
  | { type: 'module'; module: Module }
  | { type: 'commit'; commit: Commit };

// ── Static Data ──────────────────────────────────────────────

const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: '01', name: 'Authentication', description: 'JWT validation & mTLS handshake',
    role: { engineer: 'Validates JWT tokens via JWKS endpoint, enforces mTLS between services.', ciso: 'Ensures zero-trust identity verification at the gateway layer.', vc: 'Foundational security gate — required for SOC 2 / ISO 27001 compliance.' },
    file: { engineer: 'gateway/auth.go — validateJWT(), tlsHandshake()', ciso: 'Auth module audited Q1 2025, no CVEs.', vc: 'Single auth gateway reduces attack surface.' },
    p0Fix: { engineer: 'Fixed token expiry race condition in concurrent refresh flows.', ciso: 'Eliminated session fixation risk in multi-tenant JWT refresh.', vc: 'P0 fix removed a blocker for enterprise pilot.' },
    p2Roadmap: { engineer: 'Add PASETO support, hardware-bound tokens.', ciso: 'FIPS 140-3 compliant token format migration.', vc: 'Hardware token support unlocks government verticals.' },
    actions: { engineer: 'Rotate JWKS keys, update TLS certs.', ciso: 'Schedule quarterly key rotation audit.', vc: 'Key rotation is automated — low maintenance cost.' },
  },
  {
    id: '02', name: 'Rate Limiting', description: 'Token-bucket per tenant with burst',
    role: { engineer: 'Token-bucket algorithm per tenant, Redis-backed counters with burst allowance.', ciso: 'Prevents abuse and DDoS at the application layer.', vc: 'Usage-based billing foundation — meters every API call.' },
    file: { engineer: 'gateway/ratelimit.go — checkLimit(), slidingWindow()', ciso: 'Rate limiter logs feed into SIEM for anomaly detection.', vc: 'Rate limiting enables tiered pricing model.' },
    p0Fix: { engineer: 'Fixed counter reset drift in Redis cluster failover.', ciso: 'Resolved bypass where burst tokens survived rate window reset.', vc: 'Fix prevented revenue leakage from unlimited free-tier abuse.' },
    p2Roadmap: { engineer: 'Adaptive rate limits based on model latency.', ciso: 'Per-user behavioral baseline for anomaly scoring.', vc: 'Adaptive limits improve unit economics per request.' },
    actions: { engineer: 'Tune bucket sizes per tier, monitor Redis latency.', ciso: 'Review rate limit bypass attempts monthly.', vc: 'Tier configs map directly to pricing page.' },
  },
  {
    id: '03', name: 'Policy Engine', description: 'OPA/Rego rules evaluated per request',
    role: { engineer: 'Evaluates Rego policies via embedded OPA, caches compiled bundles.', ciso: 'Central policy enforcement — all decisions auditable and versioned.', vc: 'Policy-as-code is the core differentiator vs. competitors.' },
    file: { engineer: 'policy/engine.go — evaluate(), loadBundle()', ciso: 'All policy changes require PR review and are git-versioned.', vc: 'Policy engine is the IP moat — hard for competitors to replicate.' },
    p0Fix: { engineer: 'Fixed partial policy evaluation on bundle hot-reload.', ciso: 'Eliminated window where stale policies could permit unauthorized access.', vc: 'Fix was required before enterprise GA launch.' },
    p2Roadmap: { engineer: 'WASM policy plugins, custom built-in functions.', ciso: 'Customer-managed policy signing and verification.', vc: 'Plugin system enables partner ecosystem revenue.' },
    actions: { engineer: 'Write Rego tests, benchmark evaluation latency.', ciso: 'Audit policy change log quarterly.', vc: 'Each new policy rule is a potential upsell.' },
  },
  {
    id: '04', name: 'PII Detection', description: 'Regex + NER scanning on request/response',
    role: { engineer: 'Two-pass scanner: fast regex pre-filter, then Rust NER model for context.', ciso: 'Prevents PII leakage to LLM providers — critical for GDPR Article 28.', vc: 'PII scanning is the #1 feature request from enterprise prospects.' },
    file: { engineer: 'pii/scanner.rs — scan_payload(), ner_classify()', ciso: 'PII patterns updated monthly from threat intelligence feeds.', vc: 'Rust-based scanner handles 10K req/s — no performance tax.' },
    p0Fix: { engineer: 'Fixed false negatives on multi-line JSON payloads with nested PII.', ciso: 'Closed data leakage gap where nested objects bypassed scanning.', vc: 'Fix was a deal-breaker for two F500 prospects.' },
    p2Roadmap: { engineer: 'Add image/PDF PII scanning, custom entity types.', ciso: 'Support for PCI-DSS card number detection.', vc: 'Multi-modal PII scanning opens healthcare vertical.' },
    actions: { engineer: 'Update regex patterns, retrain NER model.', ciso: 'Run quarterly PII scan accuracy audit.', vc: 'Each new PII type detected = new compliance checkbox.' },
  },
  {
    id: '05', name: 'Prompt Injection Guard', description: 'Classifier + heuristic defense layer',
    role: { engineer: 'Ensemble of regex heuristics and fine-tuned classifier model.', ciso: 'Defends against OWASP LLM Top 10 #1 — Prompt Injection.', vc: 'Novel defense layer — strong patent potential.' },
    file: { engineer: 'guard/injection.go — classify(), heuristicCheck()', ciso: 'Updated weekly with new attack vector signatures.', vc: 'Guard IP is defensible — trained on proprietary dataset.' },
    p0Fix: { engineer: 'Fixed classifier timeout causing requests to bypass guard entirely.', ciso: 'Eliminated fail-open condition on classifier timeout.', vc: 'Fix removed the #1 objection in security reviews.' },
    p2Roadmap: { engineer: 'Multi-language injection detection, adversarial training.', ciso: 'Red team integration for continuous testing.', vc: 'Multi-language expands TAM to non-English markets.' },
    actions: { engineer: 'Retrain classifier monthly, add new heuristics.', ciso: 'Commission external red team assessment.', vc: 'Red team results become marketing collateral.' },
  },
  {
    id: '06', name: 'Model Router', description: 'Latency-aware LLM routing with fallback',
    role: { engineer: 'Routes to optimal LLM based on latency, cost, and capability matrix.', ciso: 'Enforces data sovereignty — routes stay within approved regions.', vc: 'Multi-model strategy eliminates vendor lock-in risk.' },
    file: { engineer: 'router/selector.go — selectModel(), healthCheck()', ciso: 'Routing decisions logged for compliance audit trail.', vc: 'Router enables best-price execution across LLM providers.' },
    p0Fix: { engineer: 'Fixed fallback loop when primary and secondary models both degraded.', ciso: 'Resolved infinite retry that exposed requests to unvetted endpoints.', vc: 'Fix improved uptime SLA from 99.5% to 99.95%.' },
    p2Roadmap: { engineer: 'Cost-optimized routing, A/B model testing framework.', ciso: 'Per-request routing policy based on data classification.', vc: 'A/B testing enables customers to optimize model spend.' },
    actions: { engineer: 'Update model health thresholds, add new providers.', ciso: 'Review routing logs for policy violations.', vc: 'Each new model provider increases switching cost for customers.' },
  },
  {
    id: '07', name: 'Audit Logger', description: 'Structured event stream to S3 + SIEM',
    role: { engineer: 'Async structured logging via NATS to S3 and SIEM webhook.', ciso: 'Immutable audit trail — meets SOC 2 CC7.2 and ISO 27001 A.12.4.', vc: 'Audit logs are table-stakes for enterprise — zero differentiation but required.' },
    file: { engineer: 'audit/logger.go — emit(), batchFlush()', ciso: 'Logs encrypted at rest (AES-256) and in transit (TLS 1.3).', vc: 'Log retention is a recurring storage revenue stream.' },
    p0Fix: { engineer: 'Fixed log ordering guarantee broken by async batch flush.', ciso: 'Restored causal ordering required for forensic investigation.', vc: 'Fix was audit requirement for SOC 2 Type II certification.' },
    p2Roadmap: { engineer: 'Real-time log analytics, custom retention policies.', ciso: 'Tamper-evident logging with Merkle tree verification.', vc: 'Log analytics becomes premium add-on feature.' },
    actions: { engineer: 'Monitor flush latency, verify S3 delivery.', ciso: 'Validate log integrity monthly.', vc: 'Storage costs scale with usage — good unit economics.' },
  },
  {
    id: '08', name: 'Response Filter', description: 'Post-LLM output sanitization & masking',
    role: { engineer: 'Scans LLM output for PII, hallucinated URLs, and policy violations.', ciso: 'Last line of defense before response reaches end user.', vc: 'Output filtering is unique — competitors only filter input.' },
    file: { engineer: 'filter/response.go — sanitize(), maskPII()', ciso: 'Filter rules versioned and auditable like input policies.', vc: 'Bidirectional filtering is a key differentiator in sales deck.' },
    p0Fix: { engineer: 'Fixed streaming response chunks bypassing filter buffer.', ciso: 'Closed gap where chunked transfer encoding evaded output scan.', vc: 'Fix enabled streaming support — required by 80% of prospects.' },
    p2Roadmap: { engineer: 'Custom filter plugins, content watermarking.', ciso: 'AI-generated content labeling for regulatory compliance.', vc: 'Watermarking enables content provenance — new product line.' },
    actions: { engineer: 'Tune filter sensitivity, add streaming buffer tests.', ciso: 'Review filter bypass attempts in incident log.', vc: 'Streaming support doubles addressable use cases.' },
  },
];

const MODULES: Module[] = [
  { name: 'gateway', lang: 'Go', file: 'gateway/', loc: 2400, status: ['DONE', 'P0-FIXED'], detail: { engineer: 'HTTP/gRPC ingress, TLS termination, request routing. Handles 50K req/s on 4 cores.', ciso: 'Single entry point — all traffic inspected before reaching internal services.', vc: 'Gateway is the billing meter — every request counted.' } },
  { name: 'policy-engine', lang: 'Go', file: 'policy/', loc: 1800, status: ['DONE', 'P0-FIXED'], detail: { engineer: 'Embedded OPA with hot-reload, Rego compilation cache, decision logging.', ciso: 'All access decisions centralized and auditable. Git-versioned policies.', vc: 'Core IP — policy engine is the product moat.' } },
  { name: 'pii-scanner', lang: 'Rust', file: 'pii/', loc: 3200, status: ['DONE', 'P0-FIXED'], detail: { engineer: 'SIMD-accelerated regex + ONNX NER model. Sub-millisecond per scan.', ciso: 'Detects 47 PII entity types across 12 languages.', vc: 'Rust performance means no latency tax — key selling point.' } },
  { name: 'guard', lang: 'Go', file: 'guard/', loc: 1200, status: ['DONE', 'P0-FIXED'], detail: { engineer: 'Ensemble injection classifier with heuristic pre-filter. 99.7% precision.', ciso: 'Addresses OWASP LLM Top 10 #1 with defense-in-depth approach.', vc: 'Guard model trained on proprietary dataset — defensible IP.' } },
  { name: 'router', lang: 'Go', file: 'router/', loc: 900, status: ['DONE', 'P0-FIXED'], detail: { engineer: 'Weighted routing with health checks, circuit breakers, and fallback chains.', ciso: 'Enforces geo-fencing and data sovereignty routing constraints.', vc: 'Multi-model routing eliminates single-vendor dependency.' } },
  { name: 'audit', lang: 'Go', file: 'audit/', loc: 600, status: ['DONE'], detail: { engineer: 'NATS-based async event emitter with batched S3 delivery.', ciso: 'Immutable, encrypted audit trail with causal ordering guarantee.', vc: 'Audit compliance is checkbox — required but not differentiated.' } },
  { name: 'filter', lang: 'Go', file: 'filter/', loc: 800, status: ['DONE', 'P0-FIXED'], detail: { engineer: 'Response sanitizer with streaming buffer and PII masking.', ciso: 'Output-side defense — unique in market, covers exfiltration risk.', vc: 'Bidirectional filtering doubles the value proposition.' } },
  { name: 'dashboard', lang: 'TS', file: 'src/', loc: 4100, status: ['DONE'], detail: { engineer: 'React + Tailwind SPA with real-time WebSocket updates.', ciso: 'Single-pane-of-glass visibility for security operations.', vc: 'Dashboard is the demo — first thing prospects see.' } },
  { name: 'infra', lang: 'YAML', file: 'deploy/', loc: 1500, status: ['DONE'], detail: { engineer: 'Helm charts + Terraform modules for multi-cloud deployment.', ciso: 'Infrastructure-as-code — auditable and reproducible deployments.', vc: 'Multi-cloud support expands addressable market.' } },
  { name: 'sdk', lang: 'TS', file: 'sdk/', loc: 700, status: ['DONE'], detail: { engineer: 'TypeScript client SDK with retry logic and type-safe API bindings.', ciso: 'SDK enforces secure defaults — TLS, auth, and timeout policies.', vc: 'SDK reduces integration time from days to hours.' } },
];

const COMMITS: Commit[] = [
  { hash: 'a1b2c3d', message: 'fix(auth): token expiry race in concurrent refresh', date: '2025-03-12', sprint: 'S1', why: { engineer: 'Concurrent token refresh could return expired tokens due to missing mutex on cache write.', ciso: 'Race condition allowed brief window of unauthenticated access during token rotation.', vc: 'Blocker for enterprise pilot — auth failures in load testing.' } },
  { hash: 'e4f5g6h', message: 'fix(pii): nested JSON payload false negatives', date: '2025-03-14', sprint: 'S1', why: { engineer: 'Scanner only checked top-level fields — nested objects with PII were missed.', ciso: 'PII leakage to LLM providers in deeply nested request bodies.', vc: 'Two F500 prospects flagged this in security review.' } },
  { hash: 'i7j8k9l', message: 'fix(guard): classifier timeout fail-open', date: '2025-03-15', sprint: 'S1', why: { engineer: 'Timeout in classifier HTTP call returned default-allow instead of default-deny.', ciso: 'Fail-open on timeout = prompt injection bypass under load.', vc: '#1 objection in every security-focused sales call.' } },
  { hash: 'm0n1o2p', message: 'fix(ratelimit): counter drift on Redis failover', date: '2025-03-18', sprint: 'S1', why: { engineer: 'Redis Cluster failover reset counters, granting fresh burst allowance.', ciso: 'Rate limit bypass during infrastructure events — DDoS window.', vc: 'Free-tier abuse during outages = direct revenue impact.' } },
  { hash: 'q3r4s5t', message: 'fix(router): infinite fallback loop on dual degradation', date: '2025-03-20', sprint: 'S1', why: { engineer: 'Fallback chain looped when both primary and secondary models returned 503.', ciso: 'Infinite retry exposed requests to unvetted model endpoints.', vc: 'Improved uptime SLA from 99.5% to 99.95% — enterprise requirement.' } },
  { hash: 'u6v7w8x', message: 'fix(policy): stale bundle on hot-reload', date: '2025-03-22', sprint: 'S1', why: { engineer: 'Hot-reload replaced bundle pointer before compilation completed.', ciso: 'Window where old (potentially permissive) policies served requests.', vc: 'Required for enterprise GA — policy consistency guarantee.' } },
  { hash: 'y9z0a1b', message: 'fix(audit): log ordering broken by async flush', date: '2025-04-01', sprint: 'S2', why: { engineer: 'Batched async flush broke causal ordering — events arrived out of sequence.', ciso: 'Unordered logs fail forensic investigation requirements.', vc: 'SOC 2 Type II auditor flagged this as finding.' } },
  { hash: 'c2d3e4f', message: 'fix(filter): streaming chunks bypass buffer', date: '2025-04-03', sprint: 'S2', why: { engineer: 'Chunked transfer encoding sent partial responses before filter buffer filled.', ciso: 'PII in LLM output could reach client before being scanned.', vc: 'Streaming support required by 80% of pipeline.' } },
  { hash: 'g5h6i7j', message: 'fix(gateway): TLS cert reload without restart', date: '2025-04-05', sprint: 'S2', why: { engineer: 'Certificate rotation required full gateway restart — caused 2s downtime.', ciso: 'Zero-downtime cert rotation eliminates exposure window during renewal.', vc: 'Reduces operational burden — sells well to platform teams.' } },
  { hash: 'k8l9m0n', message: 'fix(pii): IBAN/SWIFT detection for EU banks', date: '2025-04-08', sprint: 'S2', why: { engineer: 'Added regex patterns and NER training data for EU financial identifiers.', ciso: 'IBAN/SWIFT are PII under GDPR for financial services clients.', vc: 'Unlocks EU banking vertical — 3 prospects waiting on this.' } },
];

// ── Helpers ───────────────────────────────────────────────────

const LANG_COLORS: Record<Module['lang'], string> = {
  Go: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  Rust: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  TS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  YAML: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

const PERSONA_LABELS: Record<Persona, string> = {
  engineer: 'Engineer',
  ciso: 'CISO',
  vc: 'VC',
};

// ── Component ────────────────────────────────────────────────

export default function ArchitectureExplorer() {
  const [persona, setPersona] = useState<Persona>('engineer');
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);

  const s1Commits = COMMITS.filter(c => c.sprint === 'S1');
  const s2Commits = COMMITS.filter(c => c.sprint === 'S2');

  return (
    <div className="space-y-6">
      {/* Persona switch */}
      <div className="flex items-center gap-2">
        {(['engineer', 'ciso', 'vc'] as Persona[]).map(p => (
          <button
            key={p}
            onClick={() => setPersona(p)}
            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${
              persona === p
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {PERSONA_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Pipeline steps */}
      <section>
        <div className="table-header mb-3">Pipeline — 8 Steps</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {PIPELINE_STEPS.map(step => (
            <button
              key={step.id}
              onClick={() => setDrawer({ type: 'pipeline', step })}
              className="card-surface shadow-card p-4 text-left hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-muted-foreground">{step.id}</span>
                <span className="text-sm font-heading font-medium text-foreground">{step.name}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Module grid */}
      <section>
        <div className="table-header mb-3">Modules</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {MODULES.map(mod => (
            <button
              key={mod.name}
              onClick={() => setDrawer({ type: 'module', module: mod })}
              className="card-surface shadow-card p-4 text-left hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-heading font-medium text-foreground">{mod.name}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${LANG_COLORS[mod.lang]}`}>
                  {mod.lang}
                </span>
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mb-2">{mod.file}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground">{mod.loc.toLocaleString()} LOC</span>
                {mod.status.map(s => (
                  <span
                    key={s}
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${
                      s === 'DONE'
                        ? 'bg-safe-bg text-safe border border-safe/10'
                        : 'bg-warn-bg text-warn border border-warn/10'
                    }`}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Commit timeline */}
      <section>
        <div className="table-header mb-3">P0 Commits</div>
        <div className="space-y-4">
          {[
            { label: 'Sprint 1 — 6 fixes', commits: s1Commits },
            { label: 'Sprint 2 — 4 fixes', commits: s2Commits },
          ].map(group => (
            <div key={group.label}>
              <div className="text-xs font-medium text-muted-foreground mb-2">{group.label}</div>
              <div className="space-y-1">
                {group.commits.map(commit => (
                  <button
                    key={commit.hash}
                    onClick={() => setDrawer({ type: 'commit', commit })}
                    className="card-surface shadow-card w-full p-3 text-left hover:bg-secondary/30 transition-colors flex items-center gap-4"
                  >
                    <span className="text-xs font-mono text-primary shrink-0">{commit.hash}</span>
                    <span className="text-xs text-foreground flex-1 truncate">{commit.message}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{commit.date}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Detail drawer */}
      {drawer && (
        <>
          <div className="fixed inset-0 bg-foreground/5 z-40" onClick={() => setDrawer(null)} />
          <div className="fixed inset-y-0 right-0 w-[480px] bg-card border-l border-border z-50 overflow-y-auto shadow-card">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <div className="text-lg font-heading text-foreground">
                  {drawer.type === 'pipeline' && `${drawer.step.id} — ${drawer.step.name}`}
                  {drawer.type === 'module' && drawer.module.name}
                  {drawer.type === 'commit' && drawer.commit.hash}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {drawer.type === 'pipeline' && 'Pipeline Step'}
                  {drawer.type === 'module' && drawer.module.file}
                  {drawer.type === 'commit' && drawer.commit.date}
                </div>
              </div>
              <button onClick={() => setDrawer(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Persona indicator */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Viewing as</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary text-primary-foreground">
                  {PERSONA_LABELS[persona]}
                </span>
              </div>

              {drawer.type === 'pipeline' && (
                <>
                  <DrawerSection title="Role" content={drawer.step.role[persona]} />
                  <DrawerSection title="Key File" content={drawer.step.file[persona]} mono />
                  <DrawerSection title="P0 Fix" content={drawer.step.p0Fix[persona]} />
                  <DrawerSection title="P2 Roadmap" content={drawer.step.p2Roadmap[persona]} />
                  <DrawerSection title="Actions" content={drawer.step.actions[persona]} />
                </>
              )}

              {drawer.type === 'module' && (
                <>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-mono px-2 py-1 rounded ${LANG_COLORS[drawer.module.lang]}`}>
                      {drawer.module.lang}
                    </span>
                    <span className="text-xs text-muted-foreground">{drawer.module.loc.toLocaleString()} LOC</span>
                    {drawer.module.status.map(s => (
                      <span
                        key={s}
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${
                          s === 'DONE'
                            ? 'bg-safe-bg text-safe border border-safe/10'
                            : 'bg-warn-bg text-warn border border-warn/10'
                        }`}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <DrawerSection title="Detail" content={drawer.module.detail[persona]} />
                </>
              )}

              {drawer.type === 'commit' && (
                <>
                  <div className="text-sm text-foreground">{drawer.commit.message}</div>
                  <DrawerSection title="Why P0?" content={drawer.commit.why[persona]} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DrawerSection({ title, content, mono }: { title: string; content: string; mono?: boolean }) {
  return (
    <div>
      <div className="table-header mb-1.5">{title}</div>
      <p className={`text-sm leading-relaxed text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{content}</p>
    </div>
  );
}
