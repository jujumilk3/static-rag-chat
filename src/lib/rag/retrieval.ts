import MiniSearch from 'minisearch';
import type { RagPayload } from './types';

export interface RetrievedChunk {
	docTitle: string;
	content: string;
	score: number;
}

export interface IndexedChunk {
	docId: string;
	docTitle: string;
	content: string;
	contentTokenCount: number;
}

export interface RagIndex {
	chunks: IndexedChunk[];
	topK: number;
	searchIndex: MiniSearch<IndexedChunk>;
	chunkById: Map<string, IndexedChunk>;
}

const TOKEN_REGEX = /[A-Za-z0-9_\-]+/g;
const STOPWORDS = new Set([
	'the',
	'and',
	'for',
	'are',
	'that',
	'this',
	'from',
	'with',
	'have',
	'your',
	'what',
	'when',
	'where',
	'which',
	'will',
	'would',
	'about',
	'into',
	'then',
	'than',
	'there',
	'they',
	'them',
	'you',
	'how',
	'can',
	'use',
	'using',
	'used',
	'been',
	'also',
	'was',
	'were',
	'has',
	'had',
	'our'
]);

const ENGLISH_STEM_SUFFIXES = ['ingly', 'edly', 'ing', 'ed', 'ies', 'es', 'ly', 's'];

function expandEnglishToken(token: string): string[] {
	if (token.length <= 2) {
		return [token];
	}

	const variants = new Set<string>([token]);
	const queue = [token];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) {
			continue;
		}
		for (const suffix of ENGLISH_STEM_SUFFIXES) {
			if (!current.endsWith(suffix)) {
				continue;
			}
			if (current.length <= suffix.length + 2) {
				continue;
			}

			let stem = current.slice(0, -suffix.length);
			if (suffix === 'ies' && stem.length > 1) {
				stem = `${stem}y`;
			}
			if (stem.length <= 2) {
				continue;
			}

			if (!variants.has(stem)) {
				variants.add(stem);
				queue.push(stem);
			}
		}
	}

	return [...variants];
}

function tokenize(text: string): string[] {
	const lowered = text.toLowerCase();
	const matches = lowered.match(TOKEN_REGEX);
	if (!matches) {
		return [];
	}

	return matches.flatMap((token) =>
		expandEnglishToken(token)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 1 && !STOPWORDS.has(entry))
	);
}

function splitIntoChunks(content: string, chunkSize: number, overlap: number): string[] {
	if (content.length <= chunkSize) {
		return [content];
	}

	const chunks: string[] = [];
	let cursor = 0;
	const step = Math.max(chunkSize - overlap, 100);

	while (cursor < content.length) {
		const end = Math.min(cursor + chunkSize, content.length);
		chunks.push(content.slice(cursor, end).trim());
		if (end === content.length) {
			break;
		}
		cursor += step;
	}

	return chunks.filter(Boolean);
}

export function createRagIndex(payload: RagPayload): RagIndex {
	const chunks: IndexedChunk[] = [];
	const chunkById = new Map<string, IndexedChunk>();

	for (const doc of payload.docs) {
		const parts = splitIntoChunks(doc.content, payload.retrieval.chunkSize, payload.retrieval.overlap);
		let localIndex = 0;
		for (const part of parts) {
			const tokens = tokenize(part);
			const chunkId = `${doc.id}#${localIndex}`;
			localIndex += 1;
			const chunk: IndexedChunk = {
				docId: chunkId,
				docTitle: doc.title,
				content: part,
				contentTokenCount: tokens.length
			};
			chunks.push(chunk);
			chunkById.set(chunkId, chunk);
		}
	}

	const searchIndex = new MiniSearch<IndexedChunk>({
		idField: 'id',
		fields: ['docTitle', 'content'],
		storeFields: ['docTitle', 'content'],
		tokenize,
		searchOptions: {
			prefix: true
		}
	});

	for (const chunk of chunks) {
		searchIndex.add({ ...chunk, id: `${chunk.docId}` });
	}

	return {
		chunks,
		topK: payload.retrieval.topK,
		searchIndex,
		chunkById
	};
}

export function retrieveTopChunks(index: RagIndex, query: string, topK = index.topK): RetrievedChunk[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0 || index.chunks.length === 0) {
		return [];
	}

	const matches = index.searchIndex.search(query, {
		limit: topK,
		prefix: true,
		fuzzy: 0.15
	}) as Array<{ id: string; score: number; docTitle?: string; content?: string }>;

	const scored = matches
		.map((match) => {
			const chunk = index.chunkById.get(match.id);
			if (!chunk) {
				return null;
			}
			return {
				docTitle: match.docTitle ?? chunk.docTitle,
				content: match.content ?? chunk.content,
				score: match.score
			};
		})
		.filter((entry): entry is RetrievedChunk => Boolean(entry))
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);

	return scored;
}

function truncateText(input: string, maxChars: number): string {
	if (input.length <= maxChars) {
		return input;
	}
	return `${input.slice(0, Math.max(maxChars - 16, 32)).trimEnd()}\n...[truncated]`;
}

export function formatRetrievedContext(chunks: RetrievedChunk[], maxChars = 12000): string {
	if (chunks.length === 0) {
		return '';
	}

	const parts: string[] = [];
	let totalLength = 0;

	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		const body = truncateText(chunk.content, 2200);
		const block = `[${index + 1}] ${chunk.docTitle}\n${body}`;
		const nextLength = totalLength + block.length + 2;

		if (nextLength > maxChars) {
			break;
		}

		parts.push(block);
		totalLength = nextLength;
	}

	return parts.join('\n\n');
}
