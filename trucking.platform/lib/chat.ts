// Módulo 7 (Chat). Conversaciones separadas (1 a 1 y de grupo) entre los
// perfiles reales de la compañía — ya no un solo canal general (spec 11.2
// hablaba de eso como primera versión; esto la reemplaza). No hay chats con
// choferes/brokers porque ellos no tienen cuenta en el sistema todavía.
export type Message = { id: string; conversationId: string; senderId: string; senderName: string; body: string; createdAt: string };
export type Conversation = {
  id: string; name: string; isGroup: boolean;
  memberIds: string[]; memberNames: string[];
  lastMessage: { body: string; senderName: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
};
export type ChatContact = { id: string; name: string };
