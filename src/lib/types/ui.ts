export type UIMessage = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: number;
	isError?: boolean;
};

export type ChatSession = {
	id: string;
	title: string;
	messages: UIMessage[];
	createdAt: number;
	updatedAt: number;
	payloadDigest: string;
};

export type SettingsTab = 'connection' | 'systemPrompt' | 'data';
export type ThemeMode = 'light' | 'dark';
export type SettingsPresentation = 'drawer' | 'modal';
