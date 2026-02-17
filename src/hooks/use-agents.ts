import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AgentRow {
  agent_id: string;
  tenant_id: string;
  auth_method: string;
  api_key_hash: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentRow[];
    },
    refetchInterval: 10000,
  });
}
