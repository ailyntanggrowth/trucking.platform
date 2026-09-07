"use client";
// Gráficas mínimas en SVG puro — sin librería externa. Reciben siempre datos ya
// calculados por el módulo que las usa (Contabilidad/Reportes); nunca inventan
// ni redondean cifras de negocio, solo dibujan lo que se les pasa.

export type DonutSlice = { label: string; value: number; color: string };

export function Donut({ data, size = 148, thickness = 24, centerLabel, centerSub }: {
  data: DonutSlice[]; size?: number; thickness?: number; centerLabel?: string; centerSub?: string;
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={centerLabel || 'Distribución'}>
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEE6E4" strokeWidth={thickness} />
    {total > 0 && data.filter(d => d.value > 0).map((d, i) => {
      const frac = d.value / total;
      const dash = frac * c;
      const circle = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
        strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="butt" />;
      offset += dash;
      return circle;
    })}
    {centerLabel && <text x="50%" y="49%" textAnchor="middle" fontSize={size * 0.13} fontWeight={800} fill="#11151B">{centerLabel}</text>}
    {centerSub && <text x="50%" y="64%" textAnchor="middle" fontSize={size * 0.075} fill="#59616D">{centerSub}</text>}
  </svg>;
}

export function DonutLegend({ data, format }: { data: DonutSlice[]; format: (n: number) => string }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  return <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
    {data.map((d, i) => <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flex: '0 0 auto' }} />
      <span>{d.label}</span>
      <b style={{ marginLeft: 'auto' }}>{format(d.value)}</b>
      <span style={{ color: '#59616D', fontSize: 12, minWidth: 38, textAlign: 'right' }}>{total > 0 ? `${Math.round((d.value / total) * 100)}%` : '—'}</span>
    </li>)}
  </ul>;
}

export type BarSeries = { label: string; color: string; values: number[] };

export function GroupedBarChart({ categories, series, height = 180, format }: {
  categories: string[]; series: BarSeries[]; height?: number; format: (n: number) => string;
}) {
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const groupWidth = 100 / categories.length;
  const barWidth = Math.min(14, (groupWidth * 0.7) / series.length);
  return <svg viewBox={`0 0 100 ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Gráfica de barras">
    {[0, 0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={0} x2={100} y1={height - 24 - f * (height - 40)} y2={height - 24 - f * (height - 40)} stroke="#F0E9E9" strokeWidth={0.5} />)}
    {categories.map((cat, ci) => {
      const groupX = ci * groupWidth + groupWidth / 2 - (barWidth * series.length) / 2;
      return <g key={ci}>
        {series.map((s, si) => {
          const v = s.values[ci] || 0;
          const barH = (v / max) * (height - 40);
          const x = groupX + si * barWidth;
          const y = height - 24 - barH;
          return <rect key={si} x={x} y={y} width={barWidth * 0.86} height={barH} fill={s.color} rx={1.5}>
            <title>{`${s.label} · ${cat}: ${format(v)}`}</title>
          </rect>;
        })}
        <text x={ci * groupWidth + groupWidth / 2} y={height - 8} textAnchor="middle" fontSize={5.6} fill="#59616D">{cat}</text>
      </g>;
    })}
  </svg>;
}
