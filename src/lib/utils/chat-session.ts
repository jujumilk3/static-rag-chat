import type { ChatSession, UIMessage } from '$lib/types/ui';

export function isUiMessage(value: unknown): value is UIMessage {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<UIMessage>;
	return (
		typeof candidate.id === 'string' &&
		(candidate.role === 'user' || candidate.role === 'assistant') &&
		typeof candidate.content === 'string' &&
		typeof candidate.createdAt === 'number'
	);
}

export function createChatTitleFromMessages(messages: UIMessage[]): string {
	const firstUser = messages.find((message) => message.role === 'user');
	if (!firstUser) {
		return 'New Conversation';
	}
	const raw = firstUser.content.replace(/\s+/g, ' ').trim();
	if (!raw) {
		return 'New Conversation';
	}
	return raw.length > 40 ? `${raw.slice(0, 40)}...` : raw;
}

export function sanitizeSessionTitle(rawTitle: string | undefined, messages: UIMessage[]): string {
	const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
	if (!title) {
		return createChatTitleFromMessages(messages);
	}
	return title;
}

export function createSession(forDigest: string): ChatSession {
	const now = Date.now();
	return {
		id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
		title: 'New Conversation',
		messages: [],
		createdAt: now,
		updatedAt: now,
		payloadDigest: forDigest
	};
}

export function normalizeSession(raw: unknown, forDigest: string): ChatSession | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const candidate = raw as Partial<ChatSession>;
	if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
		return null;
	}

	const rawMessages = Array.isArray(candidate.messages) ? candidate.messages : [];
	const messages = rawMessages.filter(isUiMessage);
	const createdAt = Number(candidate.createdAt) || Date.now();
	const updatedAt = Number(candidate.updatedAt) || createdAt;
	const title =
		sanitizeSessionTitle(typeof candidate.title === 'string' ? candidate.title : '', messages);

	return {
		id: candidate.id,
		title,
		messages,
		createdAt,
		updatedAt,
		payloadDigest: typeof candidate.payloadDigest === 'string' ? candidate.payloadDigest : forDigest
	};
}
