import { useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SovereignMapProps {
  jurisdictions: Array<{
    code: string;
    event_count: number;
    avg_latency?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Coordinate projection  (lng/lat -> SVG x/y)
// viewBox covers longitude -15..75, latitude 65..12
// ---------------------------------------------------------------------------

const LNG_MIN = -15;
const LNG_MAX = 75;
const LAT_MAX = 65;
const LAT_MIN = 12;
const VB_W = 900;
const VB_H = 530;

function toSvg(lat: number, lng: number): { x: number; y: number } {
  return {
    x: ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * VB_W,
    y: ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * VB_H,
  };
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
  pulseDelay: string;
}

const DATA_PLANES: DataPlane[] = [
  { id: 'casa', code: 'ma', label: 'Casablanca', lat: 33.57, lng: -7.59, color: 'hsl(var(--safe))', pulseDelay: '0s' },
  { id: 'riyadh', code: 'sa', label: 'Riyadh', lat: 24.71, lng: 46.67, color: '#1D4ED8', pulseDelay: '0.75s' },
  { id: 'abudhabi', code: 'ae', label: 'Abu Dhabi', lat: 24.45, lng: 54.65, color: 'hsl(var(--accent))', pulseDelay: '1.5s' },
  { id: 'frankfurt', code: 'fr', label: 'Frankfurt', lat: 50.11, lng: 8.68, color: 'hsl(var(--muted-foreground))', pulseDelay: '2.25s' },
];

// ---------------------------------------------------------------------------
// Simplified country outlines (schematic SVG paths)
// Coordinates are in the viewBox (0 0 900 530) space, roughly matching
// real-world positions via the toSvg() projection.
// ---------------------------------------------------------------------------

const COUNTRY_PATHS: Array<{ id: string; d: string }> = [
  // Morocco
  {
    id: 'ma',
    d: `M ${f(toSvg(36, -5.4))} L ${f(toSvg(35.8, -1))} L ${f(toSvg(34.5, -1.3))}
        L ${f(toSvg(33, -1.2))} L ${f(toSvg(32, -1.3))} L ${f(toSvg(29.5, -9.8))}
        L ${f(toSvg(32, -9.3))} L ${f(toSvg(33.3, -9))} L ${f(toSvg(35.1, -6.1))}
        L ${f(toSvg(35.8, -5.8))} Z`,
  },
  // Algeria
  {
    id: 'dz',
    d: `M ${f(toSvg(37, -1))} L ${f(toSvg(37, 8.6))} L ${f(toSvg(36.5, 8.6))}
        L ${f(toSvg(34, 9))} L ${f(toSvg(30, 9.4))} L ${f(toSvg(24, 8.6))}
        L ${f(toSvg(19.5, 3))} L ${f(toSvg(24, -3))} L ${f(toSvg(27, -3))}
        L ${f(toSvg(29.5, -2.2))} L ${f(toSvg(32, -1.3))} L ${f(toSvg(34.5, -1.3))}
        L ${f(toSvg(35.8, -1))} Z`,
  },
  // Tunisia
  {
    id: 'tn',
    d: `M ${f(toSvg(37.3, 8.6))} L ${f(toSvg(37.1, 9.5))} L ${f(toSvg(36.8, 10.2))}
        L ${f(toSvg(35.5, 11))} L ${f(toSvg(34, 10))} L ${f(toSvg(33.8, 8.2))}
        L ${f(toSvg(34, 8))} L ${f(toSvg(36.5, 8.6))} Z`,
  },
  // Libya
  {
    id: 'ly',
    d: `M ${f(toSvg(33, 11.5))} L ${f(toSvg(32.5, 15))} L ${f(toSvg(32, 20))}
        L ${f(toSvg(31.5, 25))} L ${f(toSvg(29, 25))} L ${f(toSvg(25, 25))}
        L ${f(toSvg(22, 25))} L ${f(toSvg(20, 20))} L ${f(toSvg(20, 15))}
        L ${f(toSvg(23.5, 11))} L ${f(toSvg(24, 9))} L ${f(toSvg(30, 9.4))}
        L ${f(toSvg(32.5, 12))} Z`,
  },
  // Egypt
  {
    id: 'eg',
    d: `M ${f(toSvg(31.5, 25))} L ${f(toSvg(31.2, 32))} L ${f(toSvg(30.4, 32.8))}
        L ${f(toSvg(29.5, 34.8))} L ${f(toSvg(27.5, 34.2))} L ${f(toSvg(24, 35))}
        L ${f(toSvg(22, 36.9))} L ${f(toSvg(22, 32))} L ${f(toSvg(22, 25))}
        L ${f(toSvg(25, 25))} L ${f(toSvg(29, 25))} Z`,
  },
  // Saudi Arabia
  {
    id: 'sa',
    d: `M ${f(toSvg(32, 36))} L ${f(toSvg(29, 37))} L ${f(toSvg(28.5, 36))}
        L ${f(toSvg(29, 43))} L ${f(toSvg(27.5, 48))} L ${f(toSvg(25, 50))}
        L ${f(toSvg(24, 52))} L ${f(toSvg(22, 55))} L ${f(toSvg(19.5, 52))}
        L ${f(toSvg(17, 50))} L ${f(toSvg(15, 42.5))} L ${f(toSvg(17.5, 41))}
        L ${f(toSvg(20, 40))} L ${f(toSvg(24, 38))} L ${f(toSvg(28, 35))}
        L ${f(toSvg(29.5, 35))} Z`,
  },
  // UAE
  {
    id: 'ae',
    d: `M ${f(toSvg(26, 51))} L ${f(toSvg(25.5, 55.5))} L ${f(toSvg(24.2, 56.3))}
        L ${f(toSvg(23, 55))} L ${f(toSvg(22.6, 54))} L ${f(toSvg(22.5, 52))}
        L ${f(toSvg(24, 52))} Z`,
  },
  // France
  {
    id: 'fr',
    d: `M ${f(toSvg(51, -4.5))} L ${f(toSvg(49, -1.5))} L ${f(toSvg(48.5, 1.5))}
        L ${f(toSvg(51, 2.5))} L ${f(toSvg(49, 6))} L ${f(toSvg(47.5, 7))}
        L ${f(toSvg(46, 6.5))} L ${f(toSvg(44.5, 7))} L ${f(toSvg(43.3, 5))}
        L ${f(toSvg(42.5, 3))} L ${f(toSvg(43, 0))} L ${f(toSvg(43.4, -1.5))}
        L ${f(toSvg(46, -1.2))} L ${f(toSvg(47.3, -2.3))} L ${f(toSvg(48.4, -4.5))} Z`,
  },
  // Spain
  {
    id: 'es',
    d: `M ${f(toSvg(43.5, -8))} L ${f(toSvg(43.4, -1.5))} L ${f(toSvg(43, 0))}
        L ${f(toSvg(42.5, 3))} L ${f(toSvg(41.5, 2))} L ${f(toSvg(40.5, 0.5))}
        L ${f(toSvg(38.5, 0))} L ${f(toSvg(37, -2))} L ${f(toSvg(36.2, -5.5))}
        L ${f(toSvg(37, -8))} L ${f(toSvg(38.5, -9))} L ${f(toSvg(40, -8.5))}
        L ${f(toSvg(42, -8.8))} Z`,
  },
  // Italy (boot shape simplified)
  {
    id: 'it',
    d: `M ${f(toSvg(47.3, 7))} L ${f(toSvg(46, 13.5))} L ${f(toSvg(44, 12.5))}
        L ${f(toSvg(43, 11))} L ${f(toSvg(42, 12))} L ${f(toSvg(41, 14))}
        L ${f(toSvg(40, 16))} L ${f(toSvg(38.5, 16.5))} L ${f(toSvg(39, 17.5))}
        L ${f(toSvg(40, 18))} L ${f(toSvg(40.5, 15.5))} L ${f(toSvg(41, 13.5))}
        L ${f(toSvg(42.5, 12.5))} L ${f(toSvg(44, 13.5))} L ${f(toSvg(44.5, 7.5))}
        L ${f(toSvg(46, 6.5))} Z`,
  },
  // Turkey
  {
    id: 'tr',
    d: `M ${f(toSvg(42, 26))} L ${f(toSvg(41, 28))} L ${f(toSvg(40, 30))}
        L ${f(toSvg(39, 35))} L ${f(toSvg(37.5, 40))} L ${f(toSvg(37, 44))}
        L ${f(toSvg(37, 42))} L ${f(toSvg(36.5, 36))} L ${f(toSvg(37, 32))}
        L ${f(toSvg(36.5, 28))} L ${f(toSvg(39, 26.5))} Z`,
  },
];

/** Format a toSvg result as "x,y" for embedding in a path d attribute. */
function f(p: { x: number; y: number }): string {
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SovereignMap({ jurisdictions }: SovereignMapProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Map jurisdiction data by code for quick lookup
  const jMap = useMemo(() => {
    const m = new Map<string, { event_count: number; avg_latency?: number }>();
    for (const j of jurisdictions) {
      m.set(j.code, { event_count: j.event_count, avg_latency: j.avg_latency });
    }
    return m;
  }, [jurisdictions]);

  // Compute node SVG positions
  const nodes = useMemo(
    () =>
      DATA_PLANES.map((dp) => {
        const pos = toSvg(dp.lat, dp.lng);
        const jData = jMap.get(dp.code);
        return {
          ...dp,
          x: pos.x,
          y: pos.y,
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

  // Build flow lines: connect every pair of active nodes
  const lines = useMemo(() => {
    const result: Array<{
      key: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
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
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          color: b.color, // destination colour
          width,
        });
      }
    }
    return result;
  }, [nodes, maxEvents]);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="w-full"
      style={{ height: 350 }}
      role="img"
      aria-label="Carte des data planes souverains"
    >
      {/* ── Inline CSS for animations ─────────────────── */}
      <defs>
        <style>{`
          @keyframes sovereignPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.15); }
          }
          @keyframes dashTravel {
            to { stroke-dashoffset: -24; }
          }
          .sovereign-node-pulse {
            animation: sovereignPulse 3s ease-in-out infinite;
          }
          .sovereign-flow-line {
            stroke-dasharray: 6 6;
            animation: dashTravel 1.2s linear infinite;
          }
        `}</style>
      </defs>

      {/* ── Country outlines ──────────────────────────── */}
      {COUNTRY_PATHS.map((c) => (
        <path
          key={c.id}
          d={c.d}
          className="fill-[hsl(var(--border))] dark:fill-[hsl(var(--ink-5))]"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={0.5}
          strokeLinejoin="round"
          opacity={0.6}
        />
      ))}

      {/* ── Flow lines ────────────────────────────────── */}
      {lines.map((l) => (
        <line
          key={l.key}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={l.color}
          strokeWidth={l.width}
          className="sovereign-flow-line"
          opacity={0.45}
        />
      ))}

      {/* ── Data-plane nodes ──────────────────────────── */}
      {nodes.map((node) => (
        <g
          key={node.id}
          onMouseEnter={() => setHoveredNode(node.id)}
          onMouseLeave={() => setHoveredNode(null)}
          style={{ cursor: 'pointer' }}
        >
          {/* Pulse ring */}
          <circle
            cx={node.x}
            cy={node.y}
            r={8}
            fill="none"
            stroke={node.color}
            strokeWidth={1.2}
            opacity={0.3}
            style={{
              transformOrigin: `${node.x}px ${node.y}px`,
              animationDelay: node.pulseDelay,
            }}
            className="sovereign-node-pulse"
          />

          {/* Core dot */}
          <circle
            cx={node.x}
            cy={node.y}
            r={4}
            fill={node.color}
          />

          {/* Label */}
          <text
            x={node.x}
            y={node.y + 16}
            textAnchor="middle"
            fill={node.color}
            fontSize={10}
            fontFamily="'DM Sans', sans-serif"
            fontWeight={500}
          >
            {node.label}
          </text>

          {/* Hover tooltip */}
          {hoveredNode === node.id && (
            <g>
              <rect
                x={node.x - 60}
                y={node.y - 40}
                width={120}
                height={28}
                rx={2}
                fill="hsl(var(--card))"
                stroke="hsl(var(--border))"
                strokeWidth={1}
              />
              <text
                x={node.x}
                y={node.y - 22}
                textAnchor="middle"
                fill="hsl(var(--foreground))"
                fontSize={9}
                fontFamily="'JetBrains Mono', monospace"
              >
                {node.eventCount.toLocaleString()} évén.
                {node.avgLatency != null ? ` / ${node.avgLatency}ms` : ''}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}
