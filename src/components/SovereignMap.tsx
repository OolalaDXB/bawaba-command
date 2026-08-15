import { useState, useMemo } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
} from 'react-simple-maps';

// ---------------------------------------------------------------------------
// World map TopoJSON (Natural Earth 110m, all countries)
// ---------------------------------------------------------------------------

const GEO_URL =
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SovereignMapProps {
  jurisdictions: Array<{
    code: string;
    event_count: number;
    avg_latency?: number;
  }>;
  onNodeClick?: (code: string) => void;
}

// ---------------------------------------------------------------------------
// Data-plane node definitions
// ---------------------------------------------------------------------------

interface DataPlane {
  id: string;
  code: string; // jurisdiction code
  label: string;
  lat: number;
  lng: number;
  color: string;
  pulseDelay: number;
}

const DATA_PLANES: DataPlane[] = [
  { id: 'casa', code: 'ma', label: 'Casablanca', lat: 33.57, lng: -7.59, color: 'hsl(var(--safe))', pulseDelay: 0 },
  { id: 'riyadh', code: 'sa', label: 'Riyadh', lat: 24.71, lng: 46.67, color: '#1D4ED8', pulseDelay: 0.75, labelAnchor: 'end' as const, labelX: -10, labelY: 4 },
  { id: 'abudhabi', code: 'ae', label: 'Abu Dhabi', lat: 24.45, lng: 54.65, color: 'hsl(var(--accent))', pulseDelay: 1.5, labelAnchor: 'start' as const, labelX: 10, labelY: 4 },
  { id: 'frankfurt', code: 'fr', label: 'Frankfurt', lat: 50.11, lng: 8.68, color: 'hsl(var(--muted-foreground))', pulseDelay: 2.25 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SovereignMap({ jurisdictions, onNodeClick }: SovereignMapProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Map jurisdiction data by code for quick lookup
  const jMap = useMemo(() => {
    const m = new Map<string, { event_count: number; avg_latency?: number }>();
    for (const j of jurisdictions) {
      m.set(j.code, { event_count: j.event_count, avg_latency: j.avg_latency });
    }
    return m;
  }, [jurisdictions]);

  // Enrich nodes with event data
  const nodes = useMemo(
    () =>
      DATA_PLANES.map((dp) => {
        const jData = jMap.get(dp.code);
        return {
          ...dp,
          eventCount: jData?.event_count ?? 0,
          avgLatency: jData?.avg_latency,
        };
      }),
    [jMap],
  );

  // Max event count (for stroke-width scaling)
  const maxEvents = useMemo(
    () => Math.max(...nodes.map((n) => n.eventCount), 1),
    [nodes],
  );

  // Build flow lines between active nodes
  const flowLines = useMemo(() => {
    const result: Array<{
      key: string;
      from: [number, number];
      to: [number, number];
      color: string;
      width: number;
    }> = [];

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.eventCount === 0 && b.eventCount === 0) continue;

        const traffic = Math.max(a.eventCount, b.eventCount);
        const width = 1 + (traffic / maxEvents) * 2;

        result.push({
          key: `${a.id}-${b.id}`,
          from: [a.lng, a.lat],
          to: [b.lng, b.lat],
          color: b.color,
          width,
        });
      }
    }
    return result;
  }, [nodes, maxEvents]);

  return (
    <div className="relative" style={{ height: 370 }}>
      <style>{`
        @keyframes sovereignDash { to { stroke-dashoffset: -24; } }
        .sov-dash { stroke-dasharray: 6 6; animation: sovereignDash 1.2s linear infinite; }
      `}</style>

      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 148, center: [25, 5] }}
        width={800}
        height={420}
        style={{ width: '100%', height: '100%' }}
      >
        {/* Country outlines */}
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="hsl(var(--border))"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={0.3}
                style={{
                  default: { outline: 'none' },
                  hover: { outline: 'none', fill: 'hsl(var(--muted))' },
                  pressed: { outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>

        {/* Flow lines between data-plane nodes */}
        {flowLines.map((l) => (
          <Line
            key={l.key}
            from={l.from}
            to={l.to}
            stroke={l.color}
            strokeWidth={l.width}
            className="sov-dash"
            strokeOpacity={0.45}
            strokeLinecap="round"
          />
        ))}

        {/* Data-plane markers */}
        {nodes.map((node) => (
          <Marker key={node.id} coordinates={[node.lng, node.lat]}>
            <g
              onClick={() => onNodeClick?.(node.code)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Animated pulse ring */}
              <circle
                r={6}
                fill="none"
                stroke={node.color}
                strokeWidth={1.5}
                opacity={0.3}
              >
                <animate
                  attributeName="r"
                  values="6;12;6"
                  dur="3s"
                  begin={`${node.pulseDelay}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.4;0.05;0.4"
                  dur="3s"
                  begin={`${node.pulseDelay}s`}
                  repeatCount="indefinite"
                />
              </circle>

              {/* Core dot */}
              <circle r={5} fill={node.color} />

              {/* Label */}
              <text
                x={(node as any).labelX ?? 0}
                y={(node as any).labelY ?? 20}
                textAnchor={(node as any).labelAnchor ?? 'middle'}
                fill={node.color}
                fontSize={12}
                fontFamily="'DM Sans', sans-serif"
                fontWeight={600}
              >
                {node.label}
              </text>

              {/* Hover tooltip */}
              {hoveredNode === node.id && (
                <g>
                  <rect
                    x={-80}
                    y={-44}
                    width={160}
                    height={34}
                    rx={4}
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--border))"
                    strokeWidth={1}
                  />
                  <text
                    x={0}
                    y={-23}
                    textAnchor="middle"
                    fill="hsl(var(--foreground))"
                    fontSize={11}
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {node.eventCount.toLocaleString()} events
                    {node.avgLatency != null ? ` / ${node.avgLatency}ms` : ''}
                  </text>
                </g>
              )}
            </g>
          </Marker>
        ))}
      </ComposableMap>
    </div>
  );
}
