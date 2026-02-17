import { useState, useEffect, useCallback } from 'react';
import { generateEvent, generateInitialEvents, type MCPEvent } from '@/lib/mock-data';

const MAX_EVENTS = 100;

export function useLiveFeed(initialCount = 25) {
  const [events, setEvents] = useState<MCPEvent[]>(() => generateInitialEvents(initialCount));
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    if (!isLive) return;

    const interval = setInterval(() => {
      const newEvent = generateEvent();
      setEvents(prev => [newEvent, ...prev].slice(0, MAX_EVENTS));
    }, 2000 + Math.random() * 1500);

    return () => clearInterval(interval);
  }, [isLive]);

  const toggleLive = useCallback(() => setIsLive(prev => !prev), []);

  return { events, isLive, toggleLive };
}
