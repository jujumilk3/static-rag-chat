import type { StarterPrompt } from '$lib/types/ui';
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

export const STARTER_PROMPTS: StarterPrompt[] = [
	{
		label: 'Quick Summary',
		prompt: 'Summarize the shared document in 6 clear key points.'
	},
	{
		label: 'Decision Checklist',
		prompt: 'Create a checklist of decision items needed for this document.'
	},
	{
		label: 'Execution Plan',
		prompt: 'Convert this into a practical step-by-step action plan.'
	},
	{
		label: 'Risk Detection',
		prompt: 'Find subtle risks and inconsistencies that are easy to miss.'
	}
];
