"use client";
// Gráficas mínimas en SVG puro — sin librería externa. Reciben siempre datos ya
// calculados por el módulo que las usa (Reportes); nunca inventan ni redondean
// cifras de negocio, solo dibujan lo que se les pasa.

export type LineSeries = { label: string; color: string; values: number[] };

// Tendencia semana a semana (pedido explícito, Reportes rediseñado): a
// diferencia de GroupedBarChart (una barra por día), esta traza una línea por
// serie a través de N puntos — el número de semanas del rango elegido puede
// cambiar (4/8/12), así que las etiquetas del eje X solo se muestran en la
// primera, la del medio y la última para no amontonarse.
export function LineChart({ categories, series, height = 220, format }: {
  categories: string[]; series: LineSeries[]; height?: number; format: (n: number) => string;
}) {
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const chartTop = 10, chartBottom = height - 26, chartH = chartBottom - chartTop;
  const n = categories.length;
  const xFor = (i: number) => n <= 1 ? 50 : (i / (n - 1)) * 96 + 2;
  const yFor = (v: number) => chartBottom - (v / max) * chartH;
  const labelIdx = new Set([0, Math.floor((n - 1) / 2), n - 1]);
  return <svg viewBox={`0 0 100 ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Gráfica de tendencia">
    {[0, 0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={0} x2={100} y1={chartBottom - f * chartH} y2={chartBottom - f * chartH} stroke="#F0E9E9" strokeWidth={0.5} />)}
    {series.map((s, si) => <polyline key={si} fill="none" stroke={s.color} strokeWidth={1.3}
      points={s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ')} />)}
    {series.map((s, si) => s.values.map((v, i) => <circle key={`${si}-${i}`} cx={xFor(i)} cy={yFor(v)} r={i === n - 1 ? 1.7 : 1.1} fill={s.color}>
      <title>{`${s.label} · ${categories[i]}: ${format(v)}`}</title>
    </circle>))}
    {categories.map((cat, i) => labelIdx.has(i) && <text key={i} x={xFor(i)} y={height - 6} textAnchor="middle" fontSize={5.6} fill="#59616D">{cat}</text>)}
  </svg>;
}
