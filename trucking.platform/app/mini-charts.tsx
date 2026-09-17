"use client";
// Gráficas mínimas en SVG puro — sin librería externa. Reciben siempre datos ya
// calculados por el módulo que las usa (Reportes); nunca inventan ni redondean
// cifras de negocio, solo dibujan lo que se les pasa.

export type LineSeries = { label: string; color: string; values: number[] };

// Tendencia semana a semana (pedido explícito, Reportes rediseñado): traza una
// línea por serie a través de N puntos — el número de semanas del rango
// elegido puede cambiar (4/8/12), así que las etiquetas del eje X solo se
// muestran en la primera, la del medio y la última para no amontonarse.
//
// El viewBox usa PÍXELES reales (no un ancho de 100 unidades estirado sin
// mantener proporción) — con `preserveAspectRatio="none"` y un viewBox
// angosto, el texto salía aplastado verticalmente (ilegible, "no se ve esa
// letra"). Con ancho y alto en la misma escala y sin estirar de forma
// distinta cada eje, el texto siempre queda de tamaño real sin importar el
// ancho del contenedor.
export function LineChart({ categories, series, format }: {
  categories: string[]; series: LineSeries[]; format: (n: number) => string;
}) {
  const width = 720, height = 260;
  const chartLeft = 54, chartRight = width - 12, chartTop = 16, chartBottom = height - 34;
  const chartW = chartRight - chartLeft, chartH = chartBottom - chartTop;
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const n = categories.length;
  const xFor = (i: number) => n <= 1 ? (chartLeft + chartRight) / 2 : chartLeft + (i / (n - 1)) * chartW;
  const yFor = (v: number) => chartBottom - (v / max) * chartH;
  const labelIdx = new Set([0, Math.floor((n - 1) / 2), n - 1]);
  const gridFracs = [0, 0.25, 0.5, 0.75, 1];
  // Etiqueta compacta para el eje ($60k) — el money() completo ($60,000.00)
  // no cabe en el margen izquierdo; el monto exacto sigue en el tooltip.
  const compact = (v: number) => Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
  return <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Gráfica de tendencia">
    {gridFracs.map(f => <g key={f}>
      <line x1={chartLeft} x2={chartRight} y1={chartBottom - f * chartH} y2={chartBottom - f * chartH} stroke={f === 0 ? '#E3DADD' : '#F0E9E9'} strokeWidth={1} />
      <text x={chartLeft - 8} y={chartBottom - f * chartH + 4} textAnchor="end" fontSize={12} fill="#59616D">{compact(max * f)}</text>
    </g>)}
    {series.map((s, si) => <polyline key={si} fill="none" stroke={s.color} strokeWidth={2.2}
      points={s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ')} />)}
    {series.map((s, si) => s.values.map((v, i) => <circle key={`${si}-${i}`} cx={xFor(i)} cy={yFor(v)} r={i === n - 1 ? 4 : 2.6} fill={s.color}>
      <title>{`${s.label} · ${categories[i]}: ${format(v)}`}</title>
    </circle>))}
    {categories.map((cat, i) => labelIdx.has(i) && <text key={i} x={xFor(i)} y={height - 10} textAnchor="middle" fontSize={12} fill="#59616D">{cat}</text>)}
  </svg>;
}
