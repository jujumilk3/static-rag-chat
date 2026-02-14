import type { ProviderName } from '$lib/chat/providers';

export const STORAGE_PREFIX = 'static-rag-chat';
export const PROVIDERS: ProviderName[] = ['openai', 'anthropic', 'gemini'];

export const PAYLOAD_DRAFT_KEY = `${STORAGE_PREFIX}:payload-draft`;
export const THEME_KEY = `${STORAGE_PREFIX}:theme`;
export const LEFT_RAIL_COLLAPSED_KEY = `${STORAGE_PREFIX}:left-rail-collapsed`;
export const CHAT_SESSIONS_KEY = `${STORAGE_PREFIX}:chat-sessions`;

export const CHAT_SESSIONS_LIMIT = 24;
export const RECENT_HISTORY_LIMIT = 12;
export const MAX_CONTEXT_CHARS = 12000;
export const COMPACT_MEDIA_QUERY = '(max-width: 1100px)';
export const NARROW_MEDIA_QUERY = '(max-width: 760px)';
