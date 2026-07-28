-- Adds fields required by the deterministic product-demo evidence flow.
-- Safe to run repeatedly on an existing BAWABA database.

ALTER TABLE audit_events
    ADD COLUMN IF NOT EXISTS routing_proof TEXT DEFAULT '';
