export type ProviderName = 'openai' | 'anthropic' | 'gemini';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatCompletionRequest {
	provider: ProviderName;
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
}

export const DEFAULT_MODELS: Record<ProviderName, string> = {
	openai: 'gpt-4.1-mini',
	anthropic: 'claude-3-5-sonnet-latest',
	gemini: 'gemini-2.0-flash'
};

export const PROVIDER_LABELS: Record<ProviderName, string> = {
	openai: 'OpenAI',
	anthropic: 'Claude (Anthropic)',
	gemini: 'Gemini (Google)'
};

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => {
			if (typeof entry === 'string') {
				return entry;
			}
			if (entry && typeof entry === 'object') {
				const candidate =
					(typeof (entry as Record<string, unknown>).id === 'string' && (entry as Record<string, unknown>).id) ??
					(typeof (entry as Record<string, unknown>).name === 'string' && (entry as Record<string, unknown>).name) ??
					'';
				return typeof candidate === 'string' ? candidate : '';
			}
			return '';
		})
		.filter(Boolean);
}

function isLikelyChatModel(modelId: string): boolean {
	const id = modelId.toLowerCase().trim();
	const baseId = id.startsWith('ft:') ? id.slice(3) : id;

	const blocked = [
		'instruct',
		'whisper',
		'tts',
		'speech',
		'audio',
		'image',
		'search',
		'realtime',
		'transcribe',
		'transcription',
		'embedding',
		'moderation',
		'text-',
		'dall-e',
		'dalle',
		'sora',
		'davinci',
		'babbage',
		'curie',
		'ada'
	];
	if (blocked.some((disallowed) => baseId.includes(disallowed))) {
		return false;
	}

	// Keep only text-chat families for OpenAI.
	return /^(gpt-(4|5|3\.5|oss)|chatgpt-|o[1-9])/.test(baseId);
}

function asModelArrayFromGemini(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => {
			if (!entry || typeof entry !== 'object') {
				return '';
			}
			const obj = entry as Record<string, unknown>;
			const name = typeof obj.name === 'string' ? obj.name : '';
			const methods = Array.isArray(obj.supportedGenerationMethods) ? obj.supportedGenerationMethods : [];
			const supportsGenerateContent = methods.some(
				(method) => typeof method === 'string' && method === 'generateContent'
			);
			if (!supportsGenerateContent) {
				return '';
			}
			return name.startsWith('models/') ? name.slice('models/'.length) : name;
		})
		.filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
	const seen = new Set<string>();
	const normalized = values
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.filter((value) => {
			const key = value.toLowerCase();
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		})
		.sort((a, b) => a.localeCompare(b));
	return normalized;
}

const ENV_KEYS: Readonly<Record<ProviderName, string>> = {
	openai: (import.meta.env.VITE_OPENAI_API_KEY as string | undefined) ?? '',
	anthropic: (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) ?? '',
	gemini: (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? ''
};

export function getDefaultApiKey(provider: ProviderName): string {
	return ENV_KEYS[provider]?.trim() ?? '';
}

export async function fetchModelCatalog(provider: ProviderName, apiKey: string): Promise<string[]> {
	if (!apiKey.trim()) {
		return [];
	}

	switch (provider) {
		case 'openai':
			return getOpenAIModels(apiKey);
		case 'anthropic':
			return getAnthropicModels(apiKey);
		case 'gemini':
			return getGeminiModels(apiKey);
		default:
			return [];
	}
}

async function getOpenAIModels(apiKey: string): Promise<string[]> {
	const response = await fetch('https://api.openai.com/v1/models', {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		}
	});
	const data = (await assertOk(response, 'openai')) as Record<string, unknown>;
	const models = asStringArray(data?.data).filter(isLikelyChatModel);
	return uniqueSorted(models);
}

async function getAnthropicModels(apiKey: string): Promise<string[]> {
	const response = await fetch('https://api.anthropic.com/v1/models', {
		method: 'GET',
		headers: {
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true'
		}
	});
	const data = (await assertOk(response, 'anthropic')) as Record<string, unknown>;
	const models = asStringArray(data?.data);
	return uniqueSorted(models);
}

async function getGeminiModels(apiKey: string): Promise<string[]> {
	const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json'
		}
	});
	const data = (await assertOk(response, 'gemini')) as Record<string, unknown>;
	const models = asModelArrayFromGemini(data?.models);
	return uniqueSorted(models);
}

function getErrorMessage(data: unknown): string | null {
	if (typeof data !== 'object' || data === null) {
		return null;
	}
	const raw = data as Record<string, unknown>;
	if (typeof raw.error === 'string') {
		return raw.error;
	}
	if (typeof raw.message === 'string') {
		return raw.message;
	}
	if (typeof raw.error === 'object' && raw.error !== null) {
		const nested = raw.error as Record<string, unknown>;
		if (typeof nested.message === 'string') {
			return nested.message;
		}
	}
	return null;
}

async function safeJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

async function assertOk(response: Response, provider: ProviderName): Promise<unknown> {
	const data = await safeJson(response);
	if (!response.ok) {
		const detail = getErrorMessage(data) ?? `HTTP ${response.status}`;
		throw new Error(`${PROVIDER_LABELS[provider]} request failed: ${detail}`);
	}
	return data;
}

async function callOpenAI(request: ChatCompletionRequest): Promise<string> {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${request.apiKey}`
		},
		body: JSON.stringify({
			model: request.model,
			messages: request.messages,
			temperature: request.temperature ?? 0.2,
			max_tokens: request.maxTokens ?? 1000
		}),
		signal: request.signal
	});

	const data = (await assertOk(response, 'openai')) as Record<string, unknown>;
	const choices = Array.isArray(data.choices) ? data.choices : [];
	const first = choices[0] as Record<string, unknown> | undefined;
	const message = first?.message as Record<string, unknown> | undefined;
	const content = message?.content;

	if (typeof content === 'string' && content.trim()) {
		return content;
	}
	if (Array.isArray(content)) {
		const parts = content
			.map((part) => {
				if (typeof part === 'object' && part !== null && 'text' in part) {
					const text = (part as Record<string, unknown>).text;
					return typeof text === 'string' ? text : '';
				}
				return '';
			})
			.filter(Boolean)
			.join('\n');
		if (parts.trim()) {
			return parts;
		}
	}

	throw new Error('OpenAI response did not include text content.');
}

async function callAnthropic(request: ChatCompletionRequest): Promise<string> {
	const system = request.messages
		.filter((message) => message.role === 'system')
		.map((message) => message.content)
		.join('\n\n');

	const messages = request.messages
		.filter((message) => message.role !== 'system')
		.map((message) => ({
			role: message.role === 'assistant' ? 'assistant' : 'user',
			content: [{ type: 'text', text: message.content }]
		}));

	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': request.apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true'
		},
		body: JSON.stringify({
			model: request.model,
			system,
			messages,
			temperature: request.temperature ?? 0.2,
			max_tokens: request.maxTokens ?? 1000
		}),
		signal: request.signal
	});

	const data = (await assertOk(response, 'anthropic')) as Record<string, unknown>;
	const content = Array.isArray(data.content) ? data.content : [];
	const text = content
		.map((part) => {
			if (typeof part === 'object' && part !== null) {
				const entry = part as Record<string, unknown>;
				if (entry.type === 'text' && typeof entry.text === 'string') {
					return entry.text;
				}
			}
			return '';
		})
		.filter(Boolean)
		.join('\n');

	if (!text.trim()) {
		throw new Error('Claude response did not include text content.');
	}

	return text;
}

async function callGemini(request: ChatCompletionRequest): Promise<string> {
	const system = request.messages
		.filter((message) => message.role === 'system')
		.map((message) => message.content)
		.join('\n\n');

	const contents = request.messages
		.filter((message) => message.role !== 'system')
		.map((message) => ({
			role: message.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: message.content }]
		}));

	const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`;
	const body: Record<string, unknown> = {
		contents,
		generationConfig: {
			temperature: request.temperature ?? 0.2,
			maxOutputTokens: request.maxTokens ?? 1000
		}
	};

	if (system.trim()) {
		body.systemInstruction = {
			parts: [{ text: system }]
		};
	}

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body),
		signal: request.signal
	});

	const data = (await assertOk(response, 'gemini')) as Record<string, unknown>;
	const candidates = Array.isArray(data.candidates) ? data.candidates : [];
	const first = candidates[0] as Record<string, unknown> | undefined;
	const content = first?.content as Record<string, unknown> | undefined;
	const parts = Array.isArray(content?.parts) ? content?.parts : [];
	const text = parts
		.map((part) => {
			if (typeof part === 'object' && part !== null && 'text' in part) {
				const value = (part as Record<string, unknown>).text;
				return typeof value === 'string' ? value : '';
			}
			return '';
		})
		.filter(Boolean)
		.join('\n');

	if (!text.trim()) {
		throw new Error('Gemini response did not include text content.');
	}

	return text;
}

export async function generateChatCompletion(request: ChatCompletionRequest): Promise<string> {
	if (!request.apiKey.trim()) {
		throw new Error('API key is required.');
	}
	if (!request.model.trim()) {
		throw new Error('Model is required.');
	}

	switch (request.provider) {
		case 'openai':
			return callOpenAI(request);
		case 'anthropic':
			return callAnthropic(request);
		case 'gemini':
			return callGemini(request);
		default:
			throw new Error(`Unsupported provider: ${request.provider}`);
	}
}
