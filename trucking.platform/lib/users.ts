// Módulo 8 (Usuarios y Permisos). 'owner' y 'admin' ven y hacen todo,
// incluyendo Usuarios y Permisos (pedido explícito: Mario como Administrador
// tiene acceso completo) — la única protección es que un 'admin' no puede
// tocar la cuenta del 'owner' (cambiarle el rol, desactivarla o borrarla).
// El resto de roles reparten el acceso al resto de módulos — ver
// moduleAccessByRole en app/page.tsx. No hay contraseñas — el login es por
// link mágico de correo (Supabase Auth).
//
// 'driver': chofer con cuenta real, ligado a su registro de Choferes y Flota
// vía profiles.driver_id — solo ve sus propias cargas ("Mis Cargas") y su
// grupo privado de chat ("Mi Chat"), filtrado siempre del lado del servidor.
export type Role = 'owner' | 'admin' | 'contabilidad' | 'gerente' | 'dispatcher' | 'consulta' | 'driver';
export const ROLE_VALUES: Role[] = ['owner', 'admin', 'contabilidad', 'gerente', 'dispatcher', 'consulta', 'driver'];
export const roleLabel = (role: Role) => ({
  owner: 'Dueño', admin: 'Administrador', contabilidad: 'Contabilidad', gerente: 'Gerente', dispatcher: 'Dispatcher', consulta: 'Consulta', driver: 'Chofer',
}[role]);
export const roleDescription = (role: Role) => ({
  owner: 'Control total del sistema',
  admin: 'Control total del sistema (excepto tocar la cuenta del dueño)',
  contabilidad: 'Cargas, Combustible, Contabilidad y Reportes',
  gerente: 'Cargas, Combustible, Reportes y Chat — sin Contabilidad',
  dispatcher: 'Cargas, Chat y su Invoice semanal — sin Combustible ni Contabilidad',
  consulta: 'Solo lectura: Cargas y Reportes',
  driver: 'Solo sus propias cargas y su grupo de chat',
}[role]);
export const roleTone = (role: Role) => ({
  owner: '#8B102A', admin: '#8B102A', contabilidad: '#8a5a00', gerente: '#59616D', dispatcher: '#1e4e8c', consulta: '#1f7a4d', driver: '#6b3fa0',
}[role]);
export type Profile = { id: string; email: string; name: string; role: Role; active: boolean; lastSignInAt: string | null; driverId: string | null };
