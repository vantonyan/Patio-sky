import { useRef } from 'preact/hooks';
import type { HorizonPoint } from '../lib/types';
import { interpolateHorizon } from '../lib/horizon';
import type { Constellation } from '../lib/types';

const CX = 500;
const CY = 500;
const R = 420;

export type ChartConstellation = {
  con: Constellation;
  alt: number;
  az: number;
  state: 'up' | 'partial' | 'down';
};

type Props = {
  items: ChartConstellation[];
  project: (ra: number, dec: number) => { alt: number; az: number };
  horizon: HorizonPoint[] | null;
  patio: boolean;
  flatHorizon: number;
  showBounds: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
};

function xy(alt: number, az: number): [number, number] {
  const radius = ((90 - alt) / 90) * R;
  const angle = (az * Math.PI) / 180;
  return [CX + radius * Math.sin(angle), CY - radius * Math.cos(angle)];
}

function polyline(points: [number, number][]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ');
}

function ringPath(altitude: (az: number) => number): string {
  const inner: string[] = [];
  const outer: string[] = [];
  for (let step = 0; step <= 180; step += 1) {
    const az = (step / 180) * 360;
    const [x, y] = xy(Math.max(0, Math.min(86, altitude(az))), az);
    inner.push(`${step === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  for (let step = 180; step >= 0; step -= 1) {
    const az = (step / 180) * 360;
    const [x, y] = xy(0, az);
    outer.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `${inner.join('')} ${outer.join('')} Z`;
}

function wedgePath(start: number, end: number, innerAlt: number): string {
  const parts: string[] = [];
  for (let az = start; az <= end; az += 2) {
    const [x, y] = xy(0, az);
    parts.push(`${parts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  for (let az = end; az >= start; az -= 2) {
    const [x, y] = xy(innerAlt, az);
    parts.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `${parts.join('')} Z`;
}

export function SkyChart({ items, project, horizon, patio, flatHorizon, showBounds, selected, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const usePatio = patio && horizon !== null && horizon.length >= 2;
  const ground = usePatio
    ? ringPath((az) => interpolateHorizon(horizon, az))
    : ringPath(() => flatHorizon);

  const labels = items
    .filter((item) => item.state !== 'down' || item.con.id === selected)
    .map((item) => {
      const [x, y] = xy(item.alt, item.az);
      return { id: item.con.id, name: item.con.id, x, y, alt: item.alt };
    })
    .filter((label) => label.alt > -8);

  function selectAt(event: PointerEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 1000;
    const y = ((event.clientY - rect.top) / rect.height) * 1000;
    let bestId: string | null = null;
    let bestDistance = Infinity;
    const consider = (id: string, px: number, py: number, limit: number) => {
      const distance = Math.hypot(px - x, py - y);
      if (distance <= limit && distance < bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    };
    for (const label of labels) consider(label.id, label.x, label.y, 56);
    if (!bestId) {
      for (const item of items) {
        if (item.state === 'down') continue;
        for (const line of item.con.lines) {
          for (const [ra, dec] of line) {
            const horizontal = project(ra, dec);
            const [px, py] = xy(horizontal.alt, horizontal.az);
            consider(item.con.id, px, py, 28);
          }
        }
      }
    }
    if (bestId) onSelect(bestId);
  }

  return (
    <svg
      ref={svgRef}
      class="chart"
      viewBox="0 0 1000 1000"
      role="img"
      aria-label="Polar sky chart, zenith in the center, north up"
      onPointerUp={selectAt}
    >
      <defs>
        <clipPath id="sky-clip">
          <circle cx={CX} cy={CY} r={R} />
        </clipPath>
        <pattern id="streetlights" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="#ff3b3b" stroke-width="3" />
        </pattern>
      </defs>
      <circle cx={CX} cy={CY} r={R} class="sky-disk" />
      <g clip-path="url(#sky-clip)">
        {[60, 30].map((alt) => (
          <circle key={alt} cx={CX} cy={CY} r={((90 - alt) / 90) * R} class="alt-ring" />
        ))}
        <g class="figures">
          {items.map((item) => {
            const active = item.con.id === selected;
            const dim = item.state === 'down';
            return (
              <g key={item.con.id} class={active ? 'figure on' : dim ? 'figure dim' : 'figure'}>
                {showBounds &&
                  item.con.bounds.map((ring, index) => (
                    <path
                      key={`b${index}`}
                      d={polyline(ring.map(([ra, dec]) => xy(project(ra, dec).alt, project(ra, dec).az)))}
                      class="bound"
                    />
                  ))}
                {item.con.lines.map((line, index) => (
                  <path
                    key={`l${index}`}
                    d={polyline(line.map(([ra, dec]) => xy(project(ra, dec).alt, project(ra, dec).az)))}
                    class="stick"
                  />
                ))}
              </g>
            );
          })}
        </g>
        <path d={ground} class="ground" />
        {usePatio && <path d={wedgePath(20, 60, 42)} class="poor-wedge" />}
      </g>
      <circle cx={CX} cy={CY} r={R} class="rim" />
      {labels.map((label) => (
        <text
          key={label.id}
          x={label.x}
          y={label.y}
          class={label.id === selected ? 'label on' : 'label'}
        >
          {label.name}
        </text>
      ))}
      <text x={CX} y={CY - R - 18} class="cardinal">N</text>
      <text x={CX + R + 28} y={CY} class="cardinal">E</text>
      <text x={CX} y={CY + R + 36} class="cardinal">S</text>
      <text x={CX - R - 28} y={CY} class="cardinal">W</text>
      <text x={CX + 10} y={CY - ((90 - 60) / 90) * R} class="tick">60°</text>
      <text x={CX + 10} y={CY - ((90 - 30) / 90) * R} class="tick">30°</text>
    </svg>
  );
}
