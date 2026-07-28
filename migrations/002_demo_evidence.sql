-- Additive migration for the signed sovereign-routing evidence flow.
--
-- Migration 001 is never modified. This file is mounted AFTER 001 and BEFORE
-- the demo seed (999), so the column exists before any rows are inserted. It is
-- idempotent and safe to run repeatedly on an already-provisioned database.

ALTER TABLE audit_events
    ADD COLUMN IF NOT EXISTS routing_proof TEXT DEFAULT '';
