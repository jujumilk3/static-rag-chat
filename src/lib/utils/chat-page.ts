import { normalizePayload } from '$lib/rag/urlPayload';
import { createRagIndex } from '$lib/rag/retrieval';
import type { ChatMessage } from '$lib/chat/providers';
import type { UIMessage } from '$lib/types/ui';
import type { RagPayload } from '$lib/rag/types';
import type { ProviderName } from '$lib/chat/providers';

export function nowId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPayloadDigest(nextPayload: RagPayload): string {
	const normalized = normalizePayload(nextPayload);
	const json = JSON.stringify(normalized);
	let hash = 2166136261;
	for (let i = 0; i < json.length; i++) {
		hash ^= json.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function systemTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined') {
		return 'light';
	}
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function formatMessageTime(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getDefaultSettingsPresentation(
	isNarrowViewport: boolean,
	isCompactViewport: boolean
): 'drawer' | 'modal' {
	return 'modal';
}

export function toChatMessages(
	history: UIMessage[],
	payload: RagPayload,
	context: string,
	recentHistoryLimit: number
): ChatMessage[] {
	const list: ChatMessage[] = [];
	const systemParts: string[] = [];

	if (payload.systemPrompt.trim()) {
		systemParts.push(payload.systemPrompt.trim());
	}

	if (context.trim()) {
		systemParts.push(
			`Ground answers in the supplied context whenever possible. If context is insufficient, clearly say what is missing.\n\nContext:\n${context}`
		);
	}

	if (systemParts.length > 0) {
		list.push({ role: 'system', content: systemParts.join('\n\n') });
	}

	const trimmedHistory = history.slice(-recentHistoryLimit);
	for (const message of trimmedHistory) {
		list.push({ role: message.role, content: message.content });
	}

	return list;
}

export function createRagIndexForPayload(payload: RagPayload) {
	return createRagIndex(payload);
}

export function providerLabel(provider: ProviderName) {
	return provider;
}
