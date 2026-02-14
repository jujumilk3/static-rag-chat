export type UIMessage = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: number;
};

export type ChatSession = {
	id: string;
	title: string;
	messages: UIMessage[];
	createdAt: number;
	updatedAt: number;
	payloadDigest: string;
};

export type StarterPrompt = {
	label: string;
	prompt: string;
};

export type SettingsTab = 'connection' | 'rag' | 'data';
export type ThemeMode = 'light' | 'dark';
export type SettingsPresentation = 'drawer' | 'modal';
