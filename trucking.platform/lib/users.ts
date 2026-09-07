// Módulo 8 (Usuarios y Permisos). Tres roles, tal como los pidió la dueña:
// 'owner' ve y hace todo, y es el ÚNICO que puede entrar a Usuarios y Permisos
// (agregar/quitar personas, cambiar roles); 'admin' ve y hace todo excepto
// Usuarios y Permisos; 'dispatcher' solo entra a Cargas. No hay contraseñas —
// el login es por link mágico de correo (Supabase Auth).
export type Role = 'owner' | 'admin' | 'dispatcher';
export const ROLE_VALUES: Role[] = ['owner', 'admin', 'dispatcher'];
export const roleLabel = (role: Role) => role === 'owner' ? 'Dueño' : role === 'admin' ? 'Administrador' : 'Dispatcher';
export type Profile = { id: string; email: string; name: string; role: Role };
