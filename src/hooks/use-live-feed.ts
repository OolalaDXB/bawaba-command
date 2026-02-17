import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { AuditEvent } from '@/hooks/use-audit-events';

const MAX_EVENTS = 100;

export function useLiveFeed(initialCount = 25) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [isLive, setIsLive] = useState(true);

  // Initial fetch
  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('audit_events')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(initialCount);
      if (data) setEvents(data as AuditEvent[]);
    }
    fetch();
  }, [initialCount]);

  // Polling for new events
  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(async () => {
      const latest = events[0]?.timestamp;
      let query = supabase
        .from('audit_events')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(5);

      if (latest) {
        query = query.gt('timestamp', latest);
      }

      const { data } = await query;
      if (data && data.length > 0) {
        setEvents(prev => [...(data as AuditEvent[]), ...prev].slice(0, MAX_EVENTS));
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isLive, events]);

  const toggleLive = useCallback(() => setIsLive(prev => !prev), []);

  return { events, isLive, toggleLive };
}
