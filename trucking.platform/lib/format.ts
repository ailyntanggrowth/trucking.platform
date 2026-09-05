// Helpers de formato compartidos entre módulos. Antes vivían duplicados
// (y ligeramente distintos, p.ej. sin zona horaria fija) en app/page.tsx y
// app/fleet-module.tsx — centralizados aquí para que Combustible, Contabilidad
// y Reportes los reutilicen en vez de volver a escribirlos.
export const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export const dateLabel = (date: string) => new Intl.DateTimeFormat('es', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
export const today = () => new Date().toLocaleDateString('en-CA');
