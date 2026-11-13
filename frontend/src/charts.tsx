// SVG charts for the projector dashboard. Light theme; series colors are the
// validated pair below (checked against #ffffff), text always in ink tokens.
import { AMOUNTS } from './stats';

export const COLORS = { s1: '#2a78d6', s2: '#eb6834', ink: '#0b0b0b', ink2: '#52514e', grid: '#e7e6e2', band: '#f0efec' };
export const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
export const num = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

// Gemini models are drawn as ink shapes with direct labels.
const SHAPES = ['triangle', 'diamond', 'square'] as const;
const Shape = ({ kind, x, y, r = 7 }: { kind: typeof SHAPES[number]; x: number; y: number; r?: number }) => {
  if (kind === 'triangle') return <path d={`M${x},${y - r}L${x + r},${y + r * 0.8}L${x - r},${y + r * 0.8}Z`} fill={COLORS.ink} stroke="#fff" strokeWidth={2} />;
  if (kind === 'diamond') return <path d={`M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`} fill={COLORS.ink} stroke="#fff" strokeWidth={2} />;
  return <rect x={x - r * 0.8} y={y - r * 0.8} width={r * 1.6} height={r * 1.6} fill={COLORS.ink} stroke="#fff" strokeWidth={2} />;
};
export const shapeFor = (i: number) => SHAPES[i % SHAPES.length];
export const ShapeKey = ({ i }: { i: number }) => (
  <svg width={16} height={16} className="inline-block align-[-2px]"><Shape kind={shapeFor(i)} x={8} y={8} r={6} /></svg>
);

// Column with a 4px rounded top and a square base.
const column = (x: number, y: number, w: number, h: number) => {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

export interface Series { label: string; color: string; counts: number[] }
export interface RefLine { x: number; label: string }
export interface GeminiMark { label: string; x: number; index: number }

// Histogram over 0..10 as proportions of each series, with reference lines,
// an optional shaded band, and Gemini means on a strip below the axis.
export const AmountHistogram = ({ series, refs = [], band, gemini = [], xLabel }: {
  series: Series[]; refs?: RefLine[]; band?: { from: number; to: number; label: string }; gemini?: GeminiMark[]; xLabel: string;
}) => {
  const W = 960, left = 56, right = 20, top = 44, plotH = 220;
  const geminiH = gemini.length ? 30 + gemini.length * 26 : 0;
  const H = top + plotH + 56 + geminiH;
  const plotW = W - left - right;
  const band_ = plotW / 11;
  const barW = Math.min(28, (band_ - 12) / series.length);
  const xc = (a: number) => left + band_ * (a + 0.5);
  const props = series.map((s) => { const n = s.counts.reduce((a, b) => a + b, 0); return s.counts.map((c) => (n ? c / n : 0)); });
  const yMax = Math.max(0.2, Math.ceil(Math.max(0, ...props.flat()) * 10) / 10);
  const y = (p: number) => top + plotH - (p / yMax) * plotH;
  const ticks = Array.from({ length: Math.round(yMax * 10) + 1 }, (_, i) => i / 10).filter((_, i, a) => a.length <= 6 || i % 2 === 0);
  const baseY = top + plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={xLabel}>
      {band && (
        <g>
          <rect x={xc(band.from) - band_ / 2} y={top} width={band_ * (band.to - band.from + 1)} height={plotH} fill={COLORS.band} />
          <text x={xc((band.from + band.to) / 2)} y={top - 8} textAnchor="middle" fontSize={15} fill={COLORS.ink2}>{band.label}</text>
        </g>
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke={COLORS.grid} />
          <text x={left - 10} y={y(t) + 5} textAnchor="end" fontSize={15} fill={COLORS.ink2}>{Math.round(t * 100)}%</text>
        </g>
      ))}
      {series.map((s, si) => AMOUNTS.map((a) => {
        const p = props[si][a];
        const x = xc(a) - (barW * series.length) / 2 + si * barW + 1;
        return (
          <path key={`${si}-${a}`} d={column(x, y(p), barW - 2, baseY - y(p))} fill={s.color}>
            <title>{`${s.label}: ${a} → ${pct(p)} (${s.counts[a]})`}</title>
          </path>
        );
      }))}
      {AMOUNTS.map((a) => <text key={a} x={xc(a)} y={baseY + 24} textAnchor="middle" fontSize={17} fill={COLORS.ink}>{a}</text>)}
      <text x={left + plotW / 2} y={baseY + 48} textAnchor="middle" fontSize={15} fill={COLORS.ink2}>{xLabel}</text>
      {refs.map((r, i) => (
        <g key={r.label}>
          <line x1={xc(r.x)} x2={xc(r.x)} y1={top - 4 + i * 0} y2={baseY} stroke={COLORS.ink} strokeWidth={2} />
          <text x={xc(r.x) + 6} y={top + 16 + i * 20} fontSize={15} fill={COLORS.ink} fontWeight={600}>{r.label}</text>
        </g>
      ))}
      {gemini.length > 0 && (
        <g>
          <text x={left - 10} y={baseY + 76} textAnchor="end" fontSize={13} fill={COLORS.ink2}>mean</text>
          {gemini.map((m, i) => Number.isFinite(m.x) && (
            <g key={m.label}>
              <Shape kind={shapeFor(m.index)} x={xc(m.x)} y={baseY + 72 + i * 26} />
              <text x={xc(m.x) + 14} y={baseY + 77 + i * 26} fontSize={15} fill={COLORS.ink}>{m.label} ({num(m.x)})</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
};

// Acceptance rate by offer: bars from real decisions, the stated
// "lowest I'd accept" curve as a line, Gemini acceptance as shapes.
export const AcceptanceChart = ({ acceptance, curve, gemini }: {
  acceptance: { n: number; accepted: number }[]; curve: number[]; gemini: { label: string; index: number; rates: number[] }[];
}) => {
  const W = 960, left = 56, right = 20, top = 20, plotH = 200, H = top + plotH + 60;
  const plotW = W - left - right, bw = plotW / 11, barW = Math.min(36, bw - 14);
  const xc = (a: number) => left + bw * (a + 0.5);
  const y = (p: number) => top + plotH - p * plotH;
  const baseY = top + plotH;
  const MIN_N = 3; // fewer real decisions than this: drawn faint
  const path = curve.map((p, a) => (Number.isFinite(p) ? `${a === 0 || !Number.isFinite(curve[a - 1]) ? 'M' : 'L'}${xc(a) - bw / 2},${y(p)}H${xc(a) + bw / 2}` : '')).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Acceptance rate by offer">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke={COLORS.grid} />
          <text x={left - 10} y={y(t) + 5} textAnchor="end" fontSize={15} fill={COLORS.ink2}>{Math.round(t * 100)}%</text>
        </g>
      ))}
      {acceptance.map((c, a) => {
        if (!c.n) return null;
        const p = c.accepted / c.n;
        return (
          <g key={a}>
            <path d={column(xc(a) - barW / 2, y(p), barW, baseY - y(p))} fill={COLORS.s1} opacity={c.n >= MIN_N ? 1 : 0.3}>
              <title>{`Offer ${a}: ${c.accepted} of ${c.n} accepted`}</title>
            </path>
            <text x={xc(a)} y={baseY - 6} textAnchor="middle" fontSize={12} fill={c.n >= MIN_N ? '#fff' : COLORS.ink2}>{c.n >= MIN_N ? '' : `n=${c.n}`}</text>
          </g>
        );
      })}
      <path d={path} fill="none" stroke={COLORS.s2} strokeWidth={3} strokeLinejoin="round" />
      {gemini.map((m) => m.rates.map((r, a) => Number.isFinite(r) && (
        <g key={`${m.label}-${a}`}><Shape kind={shapeFor(m.index)} x={xc(a) + (m.index ? 12 : -12)} y={y(r)} r={6} /><title>{`${m.label}: offer ${a} accepted ${pct(r)}`}</title></g>
      )))}
      {AMOUNTS.map((a) => <text key={a} x={xc(a)} y={baseY + 24} textAnchor="middle" fontSize={17} fill={COLORS.ink}>{a}</text>)}
      <text x={left + plotW / 2} y={baseY + 48} textAnchor="middle" fontSize={15} fill={COLORS.ink2}>Offer to the responder (points)</text>
    </svg>
  );
};

// Horizontal bars of counts per option, with Gemini picks to the right.
export const OptionBars = ({ options, counts, gemini }: {
  options: string[]; counts: number[]; gemini: { label: string; index: number; counts: number[] }[];
}) => {
  const W = 960, labelW = 260, right = 220, rowH = 44, top = 8, H = top + rowH * options.length;
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const x = (c: number) => labelW + (c / max) * (W - labelW - right);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Meeting spot choices">
      {options.map((o, i) => {
        const yy = top + i * rowH;
        const bw = x(counts[i]) - labelW;
        return (
          <g key={o}>
            <text x={labelW - 12} y={yy + 27} textAnchor="end" fontSize={18} fill={COLORS.ink}>{o}</text>
            {bw > 0 && <path d={`M${labelW},${yy + 8}H${labelW + bw - 4}Q${labelW + bw},${yy + 8} ${labelW + bw},${yy + 12}V${yy + 32}Q${labelW + bw},${yy + 36} ${labelW + bw - 4},${yy + 36}H${labelW}Z`} fill={COLORS.s1}><title>{`${o}: ${counts[i]}`}</title></path>}
            <text x={labelW + bw + 8} y={yy + 28} fontSize={16} fill={COLORS.ink2}>{counts[i]} ({pct(total ? counts[i] / total : NaN)})</text>
            {gemini.map((m, gi) => m.counts[i] > 0 && (
              <g key={m.label}>
                <Shape kind={shapeFor(m.index)} x={W - right + 60 + gi * 76} y={yy + 22} r={6} />
                <text x={W - right + 72 + gi * 76} y={yy + 27} fontSize={15} fill={COLORS.ink}>×{m.counts[i]}</text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
};
