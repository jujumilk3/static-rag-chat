import {
	compressToEncodedURIComponent,
	decompressFromEncodedURIComponent
} from 'lz-string';
import type { RagDoc, RagPayload } from './types';

const VERSION = 1;
const HASH_KEY = 'r';

const DEFAULT_RETRIEVAL = {
	topK: 4,
	chunkSize: 800,
	overlap: 120
};

const SAMPLE_DOC = `Static Rag Chat is a static chat app that compresses RAG documents into a URL hash for sharing.\nContext data travels inside the shared URL, and each user can reproduce the same session by entering their own API key locally in the browser.\nThe key idea is that one URL can share the same contextual conversation without running any backend.`;

export function createDefaultPayload(): RagPayload {
	return {
		v: 1,
		title: 'Static Rag Chat',
		systemPrompt:
			'You are a helpful assistant. Prefer answers grounded in the provided context. If the context is insufficient, clearly say what is missing.',
		docs: [
			{
				id: 'doc-1',
				title: 'About Static Rag Chat',
				content: SAMPLE_DOC
			}
		],
		retrieval: { ...DEFAULT_RETRIEVAL }
	};
}

function cleanDoc(input: unknown, index: number): RagDoc {
	const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
	const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `doc-${index + 1}`;
	const title =
		typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : `Document ${index + 1}`;
	const content = typeof raw.content === 'string' ? raw.content.trim() : '';
	return { id, title, content };
}

export function normalizePayload(input: unknown): RagPayload {
	if (typeof input !== 'object' || input === null) {
		throw new Error('Payload must be a JSON object.');
	}

	const raw = input as Record<string, unknown>;
	const docsRaw = Array.isArray(raw.docs) ? raw.docs : [];
	const docs = docsRaw
		.map((entry, index) => cleanDoc(entry, index))
		.filter((doc) => doc.content.length > 0);

	const retrievalRaw =
		typeof raw.retrieval === 'object' && raw.retrieval !== null
			? (raw.retrieval as Record<string, unknown>)
			: {};

	const topKRaw = Number(retrievalRaw.topK);
	const chunkSizeRaw = Number(retrievalRaw.chunkSize);
	const overlapRaw = Number(retrievalRaw.overlap);

	const topK = Number.isFinite(topKRaw) ? Math.min(Math.max(Math.floor(topKRaw), 1), 12) : DEFAULT_RETRIEVAL.topK;
	const chunkSize =
		Number.isFinite(chunkSizeRaw) && chunkSizeRaw >= 200
			? Math.min(Math.floor(chunkSizeRaw), 4000)
			: DEFAULT_RETRIEVAL.chunkSize;
	const overlap =
		Number.isFinite(overlapRaw) && overlapRaw >= 0
			? Math.min(Math.floor(overlapRaw), Math.floor(chunkSize / 2))
			: DEFAULT_RETRIEVAL.overlap;

	const versionRaw = Number(raw.v);
	const version = Number.isFinite(versionRaw) ? Math.floor(versionRaw) : VERSION;

	if (version !== VERSION) {
		throw new Error(`Unsupported payload version: ${version}`);
	}

	return {
		v: 1,
		title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Static Rag Chat',
		systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt.trim() : '',
		docs,
		retrieval: {
			topK,
			chunkSize,
			overlap
		}
	};
}

export function encodePayload(payload: RagPayload): string {
	const normalized = normalizePayload(payload);
	const json = JSON.stringify(normalized);
	const encoded = compressToEncodedURIComponent(json);
	if (!encoded) {
		throw new Error('Failed to encode payload.');
	}
	return encoded;
}

export function decodePayload(encoded: string): RagPayload {
	const decoded = decompressFromEncodedURIComponent(encoded);
	if (!decoded) {
		throw new Error('Invalid encoded payload.');
	}
	const parsed = JSON.parse(decoded);
	return normalizePayload(parsed);
}

function extractEncoded(hash: string): string | null {
	const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
	if (!trimmed) {
		return null;
	}
	const params = new URLSearchParams(trimmed);
	if (params.has(HASH_KEY)) {
		return params.get(HASH_KEY);
	}
	return trimmed;
}

export function payloadToHash(payload: RagPayload): string {
	return `#${HASH_KEY}=${encodePayload(payload)}`;
}

export function parsePayloadFromHash(hash: string): { payload: RagPayload | null; error: string | null } {
	const encoded = extractEncoded(hash);
	if (!encoded) {
		return { payload: null, error: null };
	}

	try {
		return { payload: decodePayload(encoded), error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to parse URL payload.';
		return { payload: null, error: message };
	}
}

export function payloadToPrettyJson(payload: RagPayload): string {
	return JSON.stringify(payload, null, 2);
}
