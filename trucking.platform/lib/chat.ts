// Módulo 7 (Chat). Primera versión: un solo canal de toda la compañía — sin
// conversaciones separadas por chofer, carga o departamento todavía (spec 11.2).
export type Message = { id: string; senderId: string; senderName: string; body: string; createdAt: string };
