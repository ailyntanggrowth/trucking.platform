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
export const today = () => new Date().toLocaleDateString('en-CA');
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
