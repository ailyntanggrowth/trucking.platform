// Módulo 8 (Usuarios y Permisos). 'owner' y 'admin' ven y hacen todo,
// incluyendo Usuarios y Permisos — la única protección es que un 'admin' no
// puede tocar la cuenta del 'owner' (cambiarle el rol, desactivarla ni
// borrarla). 'owner' es la cuenta original (no se invita ni se asigna desde
// la UI — por eso no está en ROLE_VALUES) y a propósito se ve y se etiqueta
// idéntica a 'admin' ("Administrador") en toda la interfaz — pedido explícito
// de la dueña: que nadie note que su cuenta tiene más protección que la de
// los demás administradores.
// El resto de roles reparten el acceso al resto de módulos — ver
// moduleAccessByRole en app/page.tsx. No hay contraseñas — el login es por
// link mágico de correo (Supabase Auth).
//
// 'driver': chofer con cuenta real, ligado a su registro de Choferes y Flota
// vía profiles.driver_id — solo ve sus propias cargas ("Mis Cargas") y su
// grupo privado de chat ("Mi Chat"), filtrado siempre del lado del servidor.
export type Role = 'owner' | 'admin' | 'dispatcher' | 'driver';
export const ROLE_VALUES: Role[] = ['admin', 'dispatcher', 'driver'];
export const roleLabel = (role: Role) => ({
  owner: 'Administrador', admin: 'Administrador', dispatcher: 'Dispatcher', driver: 'Chofer',
}[role]);
export const roleDescription = (role: Role) => ({
  owner: 'Control total del sistema',
  admin: 'Control total del sistema',
  dispatcher: 'Cargas, Chat y su Invoice semanal — sin Combustible ni Contabilidad',
  driver: 'Solo sus propias cargas y su grupo de chat',
}[role]);
export const roleTone = (role: Role) => ({
  owner: '#8B102A', admin: '#8B102A', dispatcher: '#1e4e8c', driver: '#6b3fa0',
}[role]);
export type Profile = { id: string; email: string; name: string; role: Role; active: boolean; lastSignInAt: string | null; driverId: string | null };
