// Helpers de formato compartidos entre módulos. Antes vivían duplicados
// (y ligeramente distintos, p.ej. sin zona horaria fija) en app/page.tsx y
// app/fleet-module.tsx — centralizados aquí para que Combustible, Contabilidad
// y Reportes los reutilicen en vez de volver a escribirlos.
export const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export const dateLabel = (date: string) => new Intl.DateTimeFormat('es', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
// Para columnas DATE puras (pickup/delivery, fecha de una transacción de combustible):
// no representan un instante, así que nunca deben pasar por conversión de zona horaria
// — eso fue justo el bug que mostraba "10 sept" como "9 sept, 7pm". Se arman los
// componentes a mano para que el día mostrado sea siempre el mismo que se guardó.
export const dayLabel = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(new Date(y, m - 1, d));
};
// Se fija a hora de Miami/Este explícitamente (pedido explícito, corregido
// junto con easternDate abajo) en vez de depender del huso del entorno donde
// corra el código — hoy solo se llama desde el navegador (ya en su hora), pero
// así queda correcto también si algún día se necesita desde el servidor.
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
// Fecha (YYYY-MM-DD) de un timestamp real (ej. paid_at) en hora de Miami — un
// timestamp se guarda siempre en UTC, así que de noche puede caer ya en el
// día siguiente aunque en Miami todavía sea el día de antes. Caso real: una
// sincronización de Google Sheets el lunes 9pm en Miami quedó guardada como
// "martes 1am" en UTC, y el invoice del despachador contó esas 4 cargas como
// de la semana siguiente. Se usa siempre que hay que decidir a qué semana
// pertenece un PAGO real (paidWithinInvoicePeriod y quien mire paidAt para
// agrupar por semana) — nunca para columnas de solo fecha (pickup/delivery),
// que no llevan hora y no necesitan conversión.
export const easternDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
// Solo el primer nombre (pedido explícito, para que quepa en listas cortas o
// en el resumen que se copia para WhatsApp) — excepto los "Jose", que se
// desambiguan dejando también el apellido (hay más de uno en la flota).
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  if (parts[0].toLowerCase() === 'jose') return `${parts[0]} ${parts[1]}`;
  return parts[0];
}
// "Del 7 al 13 de septiembre de 2026" (pedido explícito, Módulo 4): recibe
// solo el lunes de inicio de la semana del statement (fuelWeekStartOf) y
// arma el domingo de cierre a mano (+6 días) — mismo truco de armar la fecha
// con componentes locales que dayLabel, para no arrastrar el bug de zona
// horaria que corría el día mostrado.
export function weekPeriodLabel(weekStart: string) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const month = (dt: Date) => new Intl.DateTimeFormat('es', { month: 'long' }).format(dt);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `Del ${start.getDate()} al ${end.getDate()} de ${month(start)} de ${end.getFullYear()}`;
  }
  return `Del ${start.getDate()} de ${month(start)} al ${end.getDate()} de ${month(end)} de ${end.getFullYear()}`;
}
