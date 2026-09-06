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
