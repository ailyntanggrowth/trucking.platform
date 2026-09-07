// Módulo 8 (Usuarios y Permisos). Solo dos roles por ahora, tal como los pidió
// la dueña: 'admin' ve y hace todo; 'dispatcher' solo entra a Cargas. No hay
// contraseñas — el login es por link mágico de correo (Supabase Auth).
export type Role = 'admin' | 'dispatcher';
export const ROLE_VALUES: Role[] = ['admin', 'dispatcher'];
export const roleLabel = (role: Role) => role === 'admin' ? 'Administrador' : 'Dispatcher';
export type Profile = { id: string; email: string; name: string; role: Role };
