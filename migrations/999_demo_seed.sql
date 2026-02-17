-- Bawaba Demo Seed Data
-- Multi-jurisdiction: Morocco (MA), Saudi Arabia (SA), UAE (AE), France (FR)
-- Realistic banking/fintech agents and tools

-- ============================================================
-- AGENTS
-- ============================================================
INSERT INTO agents (agent_id, tenant_id, auth_method, active) VALUES
  ('kyc-agent-casa',      'attijari-wafa',   'api_key', true),
  ('aml-scanner-casa',    'attijari-wafa',   'api_key', true),
  ('credit-scoring-casa', 'attijari-wafa',   'api_key', true),
  ('kyc-agent-riyadh',    'snb-capital',     'api_key', true),
  ('payment-agent-riyadh','snb-capital',     'api_key', true),
  ('fraud-detect-riyadh', 'snb-capital',     'api_key', true),
  ('kyc-agent-difc',      'mashreq-difc',    'api_key', true),
  ('trade-agent-difc',    'mashreq-difc',    'api_key', true),
  ('compliance-agent-adgm','adgm-fintech',   'api_key', true),
  ('kyc-agent-paris',     'bnp-cib',         'api_key', true),
  ('risk-agent-paris',    'bnp-cib',         'mtls',    true),
  ('swift-agent-paris',   'bnp-cib',         'api_key', true),
  ('cursor-dev-intern',   'attijari-wafa',   'api_key', true),
  ('claude-code-ops',     'snb-capital',     'api_key', true)
ON CONFLICT (agent_id) DO NOTHING;

-- ============================================================
-- AUDIT EVENTS — Morocco (Attijari Wafa Bank, Casablanca)
-- ============================================================

-- Normal KYC lookups — allowed
INSERT INTO audit_events (event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction, mcp_server, tool, params_hash, policy_result, policy_version, matched_rule, pii_mode, entities_detected, tokens_generated, response_status, result_count, latency_ms, overhead_ms, event_hash, prev_hash, merkle_root, signature) VALUES
('evt_ma_001', NOW() - INTERVAL '6 hours 23 minutes', 'tool_call', 'kyc-agent-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'kyc-lookup', 'a1b2c3d4', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 3, 3, '200', 1, 4.2, 1.8, 'ma001hash', 'genesis', '', 'ma001sig'),
('evt_ma_002', NOW() - INTERVAL '6 hours 18 minutes', 'tool_call', 'kyc-agent-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'kyc-lookup', 'e5f6g7h8', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 2, 2, '200', 1, 3.8, 1.5, 'ma002hash', 'ma001hash', '', 'ma002sig'),
('evt_ma_003', NOW() - INTERVAL '5 hours 55 minutes', 'tool_call', 'kyc-agent-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'kyc-lookup', 'i9j0k1l2', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 4, 4, '200', 1, 5.1, 2.1, 'ma003hash', 'ma002hash', '', 'ma003sig'),

-- AML scan — allowed, high entity count
('evt_ma_004', NOW() - INTERVAL '5 hours 30 minutes', 'tool_call', 'aml-scanner-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'aml-screening', 'm3n4o5p6', 'allow', 'v1.2.0', 'allowed_tools.aml-screening', 'tokenize', 8, 8, '200', 3, 12.4, 3.2, 'ma004hash', 'ma003hash', '', 'ma004sig'),
('evt_ma_005', NOW() - INTERVAL '5 hours 12 minutes', 'tool_call', 'aml-scanner-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'aml-screening', 'q7r8s9t0', 'allow', 'v1.2.0', 'allowed_tools.aml-screening', 'tokenize', 6, 6, '200', 2, 11.8, 2.9, 'ma005hash', 'ma004hash', '', 'ma005sig'),

-- Credit scoring denied — agent not authorized for this tool
('evt_ma_006', NOW() - INTERVAL '4 hours 45 minutes', 'policy_deny', 'credit-scoring-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'customer-database-export', 'u1v2w3x4', 'deny', 'v1.2.0', 'default_deny', 'none', 0, 0, '403', 0, 1.2, 1.2, 'ma006hash', 'ma005hash', '', 'ma006sig'),

-- Intern with Cursor tried to access production — denied
('evt_ma_007', NOW() - INTERVAL '4 hours 30 minutes', 'policy_deny', 'cursor-dev-intern', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'database-write', 'y5z6a7b8', 'deny', 'v1.2.0', 'denied_tools.database-write', 'none', 0, 0, '403', 0, 0.8, 0.8, 'ma007hash', 'ma006hash', '', 'ma007sig'),

-- More KYC activity
('evt_ma_008', NOW() - INTERVAL '3 hours 50 minutes', 'tool_call', 'kyc-agent-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'kyc-lookup', 'c9d0e1f2', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 3, 3, '200', 1, 4.0, 1.7, 'ma008hash', 'ma007hash', '', 'ma008sig'),
('evt_ma_009', NOW() - INTERVAL '3 hours 22 minutes', 'tool_call', 'kyc-agent-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'id-verification', 'g3h4i5j6', 'allow', 'v1.2.0', 'allowed_tools.id-verification', 'tokenize', 2, 2, '200', 1, 6.3, 2.4, 'ma009hash', 'ma008hash', '', 'ma009sig'),

-- Anomaly: bulk sequential reads detected
('evt_ma_010', NOW() - INTERVAL '2 hours 15 minutes', 'anomaly', 'kyc-agent-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'kyc-lookup', '', 'alert', 'v1.2.0', 'sequential_bulk_read', 'tokenize', 0, 0, '', 0, 0, 0, 'ma010hash', 'ma009hash', '', 'ma010sig'),

-- Auth failure — unknown key
('evt_ma_011', NOW() - INTERVAL '1 hour 45 minutes', 'auth', 'unknown', 'unknown', 'ma', '', 'tools/call', '', 'deny', '', 'auth_failure', 'none', 0, 0, '401', 0, 0.3, 0.3, 'ma011hash', 'ma010hash', '', 'ma011sig'),

-- Rate limit hit
('evt_ma_012', NOW() - INTERVAL '45 minutes', 'rate_limit', 'aml-scanner-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'aml-screening', '', 'deny', '', 'rate_limit_exceeded', 'none', 0, 0, '429', 0, 0.2, 0.2, 'ma012hash', 'ma011hash', '', 'ma012sig'),

-- Recent activity
('evt_ma_013', NOW() - INTERVAL '22 minutes', 'tool_call', 'kyc-agent-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'kyc-lookup', 'k7l8m9n0', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 2, 2, '200', 1, 3.9, 1.6, 'ma013hash', 'ma012hash', '', 'ma013sig'),
('evt_ma_014', NOW() - INTERVAL '8 minutes', 'tool_call', 'aml-scanner-casa', 'attijari-wafa', 'ma', 'inwi-dc-casa', 'sanctions-check', 'o1p2q3r4', 'allow', 'v1.2.0', 'allowed_tools.sanctions-check', 'tokenize', 1, 1, '200', 1, 8.7, 2.1, 'ma014hash', 'ma013hash', '', 'ma014sig');

-- ============================================================
-- AUDIT EVENTS — Saudi Arabia (SNB Capital, Riyadh)
-- ============================================================

INSERT INTO audit_events (event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction, mcp_server, tool, params_hash, policy_result, policy_version, matched_rule, pii_mode, entities_detected, tokens_generated, response_status, result_count, latency_ms, overhead_ms, event_hash, prev_hash, merkle_root, signature) VALUES
('evt_sa_001', NOW() - INTERVAL '5 hours 50 minutes', 'tool_call', 'kyc-agent-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'kyc-lookup', 'sa_a1b2', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 4, 4, '200', 1, 5.3, 2.1, 'sa001hash', 'genesis', '', 'sa001sig'),
('evt_sa_002', NOW() - INTERVAL '5 hours 35 minutes', 'tool_call', 'kyc-agent-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'nid-verification', 'sa_c3d4', 'allow', 'v1.2.0', 'allowed_tools.nid-verification', 'tokenize', 2, 2, '200', 1, 7.1, 2.8, 'sa002hash', 'sa001hash', '', 'sa002sig'),
('evt_sa_003', NOW() - INTERVAL '5 hours 10 minutes', 'tool_call', 'payment-agent-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'payment-initiate', 'sa_e5f6', 'allow', 'v1.2.0', 'allowed_tools.payment-initiate', 'tokenize', 5, 5, '200', 1, 9.4, 3.5, 'sa003hash', 'sa002hash', '', 'sa003sig'),

-- Fraud detection flagged
('evt_sa_004', NOW() - INTERVAL '4 hours 40 minutes', 'tool_call', 'fraud-detect-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'transaction-analysis', 'sa_g7h8', 'allow', 'v1.2.0', 'allowed_tools.transaction-analysis', 'tokenize', 7, 7, '200', 5, 15.2, 4.1, 'sa004hash', 'sa003hash', '', 'sa004sig'),

-- Claude Code ops tried to push code — denied
('evt_sa_005', NOW() - INTERVAL '4 hours 15 minutes', 'policy_deny', 'claude-code-ops', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'git-push', 'sa_i9j0', 'deny', 'v1.2.0', 'denied_tools.git-push', 'none', 0, 0, '403', 0, 0.9, 0.9, 'sa005hash', 'sa004hash', '', 'sa005sig'),

-- PDPL compliance check
('evt_sa_006', NOW() - INTERVAL '3 hours 30 minutes', 'tool_call', 'kyc-agent-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'kyc-lookup', 'sa_k1l2', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 3, 3, '200', 1, 4.8, 1.9, 'sa006hash', 'sa005hash', '', 'sa006sig'),
('evt_sa_007', NOW() - INTERVAL '2 hours 50 minutes', 'tool_call', 'payment-agent-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'beneficiary-check', 'sa_m3n4', 'allow', 'v1.2.0', 'allowed_tools.beneficiary-check', 'tokenize', 2, 2, '200', 1, 6.2, 2.3, 'sa007hash', 'sa006hash', '', 'sa007sig'),

-- Auth failure
('evt_sa_008', NOW() - INTERVAL '1 hour 20 minutes', 'auth', 'unknown', 'unknown', 'sa', '', 'initialize', '', 'deny', '', 'auth_failure', 'none', 0, 0, '401', 0, 0.4, 0.4, 'sa008hash', 'sa007hash', '', 'sa008sig'),

-- Recent
('evt_sa_009', NOW() - INTERVAL '35 minutes', 'tool_call', 'fraud-detect-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'transaction-analysis', 'sa_o5p6', 'allow', 'v1.2.0', 'allowed_tools.transaction-analysis', 'tokenize', 4, 4, '200', 3, 13.1, 3.8, 'sa009hash', 'sa008hash', '', 'sa009sig'),
('evt_sa_010', NOW() - INTERVAL '12 minutes', 'tool_call', 'kyc-agent-riyadh', 'snb-capital', 'sa', 'stc-cloud-riyadh', 'kyc-lookup', 'sa_q7r8', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 2, 2, '200', 1, 4.5, 1.7, 'sa010hash', 'sa009hash', '', 'sa010sig');

-- ============================================================
-- AUDIT EVENTS — UAE (Mashreq DIFC + ADGM Fintech)
-- ============================================================

INSERT INTO audit_events (event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction, mcp_server, tool, params_hash, policy_result, policy_version, matched_rule, pii_mode, entities_detected, tokens_generated, response_status, result_count, latency_ms, overhead_ms, event_hash, prev_hash, merkle_root, signature) VALUES
('evt_ae_001', NOW() - INTERVAL '5 hours 15 minutes', 'tool_call', 'kyc-agent-difc', 'mashreq-difc', 'ae', 'du-dc-dubai', 'kyc-lookup', 'ae_a1b2', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 3, 3, '200', 1, 4.9, 2.0, 'ae001hash', 'genesis', '', 'ae001sig'),
('evt_ae_002', NOW() - INTERVAL '4 hours 55 minutes', 'tool_call', 'trade-agent-difc', 'mashreq-difc', 'ae', 'du-dc-dubai', 'trade-confirmation', 'ae_c3d4', 'allow', 'v1.2.0', 'allowed_tools.trade-confirmation', 'tokenize', 2, 2, '200', 1, 7.8, 2.9, 'ae002hash', 'ae001hash', '', 'ae002sig'),
('evt_ae_003', NOW() - INTERVAL '4 hours 30 minutes', 'tool_call', 'kyc-agent-difc', 'mashreq-difc', 'ae', 'du-dc-dubai', 'emirates-id-verify', 'ae_e5f6', 'allow', 'v1.2.0', 'allowed_tools.emirates-id-verify', 'tokenize', 2, 2, '200', 1, 6.5, 2.5, 'ae003hash', 'ae002hash', '', 'ae003sig'),

-- ADGM fintech compliance check
('evt_ae_004', NOW() - INTERVAL '3 hours 45 minutes', 'tool_call', 'compliance-agent-adgm', 'adgm-fintech', 'ae', 'du-dc-dubai', 'regulatory-check', 'ae_g7h8', 'allow', 'v1.2.0', 'allowed_tools.regulatory-check', 'tokenize', 1, 1, '200', 1, 8.3, 3.1, 'ae004hash', 'ae003hash', '', 'ae004sig'),

-- Trade agent tried to access customer PII directly — denied
('evt_ae_005', NOW() - INTERVAL '3 hours 10 minutes', 'policy_deny', 'trade-agent-difc', 'mashreq-difc', 'ae', 'du-dc-dubai', 'customer-pii-export', 'ae_i9j0', 'deny', 'v1.2.0', 'default_deny', 'none', 0, 0, '403', 0, 1.1, 1.1, 'ae005hash', 'ae004hash', '', 'ae005sig'),

-- Recent
('evt_ae_006', NOW() - INTERVAL '1 hour 5 minutes', 'tool_call', 'kyc-agent-difc', 'mashreq-difc', 'ae', 'du-dc-dubai', 'kyc-lookup', 'ae_k1l2', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 3, 3, '200', 1, 4.7, 1.8, 'ae006hash', 'ae005hash', '', 'ae006sig'),
('evt_ae_007', NOW() - INTERVAL '28 minutes', 'tool_call', 'compliance-agent-adgm', 'adgm-fintech', 'ae', 'du-dc-dubai', 'sanctions-check', 'ae_m3n4', 'allow', 'v1.2.0', 'allowed_tools.sanctions-check', 'tokenize', 1, 1, '200', 1, 9.1, 2.7, 'ae007hash', 'ae006hash', '', 'ae007sig'),
('evt_ae_008', NOW() - INTERVAL '5 minutes', 'tool_call', 'trade-agent-difc', 'mashreq-difc', 'ae', 'du-dc-dubai', 'trade-confirmation', 'ae_o5p6', 'allow', 'v1.2.0', 'allowed_tools.trade-confirmation', 'tokenize', 2, 2, '200', 1, 7.2, 2.6, 'ae008hash', 'ae007hash', '', 'ae008sig');

-- ============================================================
-- AUDIT EVENTS — France (BNP CIB, Paris)
-- ============================================================

INSERT INTO audit_events (event_id, timestamp, event_type, agent_id, tenant_id, jurisdiction, mcp_server, tool, params_hash, policy_result, policy_version, matched_rule, pii_mode, entities_detected, tokens_generated, response_status, result_count, latency_ms, overhead_ms, event_hash, prev_hash, merkle_root, signature) VALUES
('evt_fr_001', NOW() - INTERVAL '5 hours 40 minutes', 'tool_call', 'kyc-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'kyc-lookup', 'fr_a1b2', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 3, 3, '200', 1, 3.8, 1.5, 'fr001hash', 'genesis', '', 'fr001sig'),
('evt_fr_002', NOW() - INTERVAL '5 hours 20 minutes', 'tool_call', 'risk-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'credit-risk-model', 'fr_c3d4', 'allow', 'v1.2.0', 'allowed_tools.credit-risk-model', 'tokenize', 5, 5, '200', 1, 18.3, 4.2, 'fr002hash', 'fr001hash', '', 'fr002sig'),
('evt_fr_003', NOW() - INTERVAL '4 hours 50 minutes', 'tool_call', 'swift-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'swift-message-parse', 'fr_e5f6', 'allow', 'v1.2.0', 'allowed_tools.swift-message-parse', 'tokenize', 4, 4, '200', 1, 8.9, 3.0, 'fr003hash', 'fr002hash', '', 'fr003sig'),

-- SWIFT agent tried to access raw customer data — denied (GDPR enforcement)
('evt_fr_004', NOW() - INTERVAL '4 hours 25 minutes', 'policy_deny', 'swift-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'customer-data-raw', 'fr_g7h8', 'deny', 'v1.2.0', 'default_deny', 'none', 0, 0, '403', 0, 1.0, 1.0, 'fr004hash', 'fr003hash', '', 'fr004sig'),

-- Risk model with DORA compliance
('evt_fr_005', NOW() - INTERVAL '3 hours 40 minutes', 'tool_call', 'risk-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'stress-test-runner', 'fr_i9j0', 'allow', 'v1.2.0', 'allowed_tools.stress-test-runner', 'tokenize', 2, 2, '200', 1, 22.5, 5.1, 'fr005hash', 'fr004hash', '', 'fr005sig'),
('evt_fr_006', NOW() - INTERVAL '3 hours 10 minutes', 'tool_call', 'kyc-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'pep-screening', 'fr_k1l2', 'allow', 'v1.2.0', 'allowed_tools.pep-screening', 'tokenize', 1, 1, '200', 1, 11.2, 3.3, 'fr006hash', 'fr005hash', '', 'fr006sig'),

-- SWIFT message processing batch
('evt_fr_007', NOW() - INTERVAL '2 hours 30 minutes', 'tool_call', 'swift-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'swift-message-parse', 'fr_m3n4', 'allow', 'v1.2.0', 'allowed_tools.swift-message-parse', 'tokenize', 6, 6, '200', 4, 9.4, 3.2, 'fr007hash', 'fr006hash', '', 'fr007sig'),
('evt_fr_008', NOW() - INTERVAL '2 hours 5 minutes', 'tool_call', 'swift-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'swift-message-parse', 'fr_o5p6', 'allow', 'v1.2.0', 'allowed_tools.swift-message-parse', 'tokenize', 3, 3, '200', 2, 8.1, 2.8, 'fr008hash', 'fr007hash', '', 'fr008sig'),

-- Anomaly on SWIFT batch processing
('evt_fr_009', NOW() - INTERVAL '1 hour 55 minutes', 'anomaly', 'swift-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'swift-message-parse', '', 'alert', 'v1.2.0', 'sequential_bulk_read', 'tokenize', 0, 0, '', 0, 0, 0, 'fr009hash', 'fr008hash', '', 'fr009sig'),

-- Auth failure from unknown source
('evt_fr_010', NOW() - INTERVAL '1 hour 30 minutes', 'auth', 'unknown', 'unknown', 'eu', '', 'tools/call', '', 'deny', '', 'auth_failure', 'none', 0, 0, '401', 0, 0.5, 0.5, 'fr010hash', 'fr009hash', '', 'fr010sig'),

-- Recent SWIFT + KYC activity
('evt_fr_011', NOW() - INTERVAL '50 minutes', 'tool_call', 'swift-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'swift-gpi-tracker', 'fr_q7r8', 'allow', 'v1.2.0', 'allowed_tools.swift-gpi-tracker', 'tokenize', 2, 2, '200', 1, 7.6, 2.5, 'fr011hash', 'fr010hash', '', 'fr011sig'),
('evt_fr_012', NOW() - INTERVAL '18 minutes', 'tool_call', 'kyc-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'kyc-lookup', 'fr_s9t0', 'allow', 'v1.2.0', 'allowed_tools.kyc-lookup', 'tokenize', 2, 2, '200', 1, 3.6, 1.4, 'fr012hash', 'fr011hash', '', 'fr012sig'),
('evt_fr_013', NOW() - INTERVAL '3 minutes', 'tool_call', 'risk-agent-paris', 'bnp-cib', 'eu', 'scaleway-paris', 'credit-risk-model', 'fr_u1v2', 'allow', 'v1.2.0', 'allowed_tools.credit-risk-model', 'tokenize', 4, 4, '200', 1, 16.7, 3.9, 'fr013hash', 'fr012hash', '', 'fr013sig');
