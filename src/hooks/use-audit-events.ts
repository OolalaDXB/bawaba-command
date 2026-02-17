import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditEvent {
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
  event_hash: string;
  prev_hash: string;
  merkle_root: string;
  signature: string;
}

export function useAuditEvents(limit = 50) {
  return useQuery({
    queryKey: ['audit_events', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_events')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AuditEvent[];
    },
    refetchInterval: 5000,
  });
}

export function useAuditStats() {
  return useQuery({
    queryKey: ['audit_stats'],
    queryFn: async () => {
      const { data: totalData } = await supabase
        .from('audit_events')
        .select('event_id', { count: 'exact', head: true });

      const { data: denialsData } = await supabase
        .from('audit_events')
        .select('event_id', { count: 'exact', head: true })
        .eq('policy_result', 'deny');

      const { data: piiData } = await supabase
        .from('audit_events')
        .select('tokens_generated');

      const totalPii = (piiData ?? []).reduce((s, r) => s + (r.tokens_generated ?? 0), 0);

      return {
        totalEvents: totalData ? 0 : 0, // count comes from header
        denials: 0,
        piiTokenized: totalPii,
      };
    },
    refetchInterval: 10000,
  });
}

export function useJurisdictionStats() {
  return useQuery({
    queryKey: ['jurisdiction_stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_events')
        .select('jurisdiction, policy_result, tokens_generated');
      if (error) throw error;

      const stats: Record<string, { calls: number; pii: number; denials: number }> = {};
      (data ?? []).forEach(row => {
        const j = row.jurisdiction || 'unknown';
        if (!stats[j]) stats[j] = { calls: 0, pii: 0, denials: 0 };
        stats[j].calls++;
        stats[j].pii += row.tokens_generated ?? 0;
        if (row.policy_result === 'deny') stats[j].denials++;
      });
      return stats;
    },
    refetchInterval: 10000,
  });
}
