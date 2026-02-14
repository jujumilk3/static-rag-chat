import type { RagPayload } from './types';

export interface IndexedChunk {
	docId: string;
	docTitle: string;
	content: string;
	tokens: string[];
	termFrequency: Record<string, number>;
	tokenCount: number;
}

export interface RagIndex {
	chunks: IndexedChunk[];
	topK: number;
	avgChunkLength: number;
	idfByToken: Record<string, number>;
}

export interface RetrievedChunk {
	docTitle: string;
	content: string;
	score: number;
}

const TOKEN_REGEX = /[A-Za-z0-9_\-\u3131-\uD79D]+/g;
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
const BM25_K1 = 1.2;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
	const lowered = text.toLowerCase();
	const matches = lowered.match(TOKEN_REGEX);
	if (!matches) {
		return [];
	}
	return matches.filter((token) => token.length > 1 && !STOPWORDS.has(token));
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

function toTermFrequency(tokens: string[]): Record<string, number> {
	const frequency: Record<string, number> = {};
	for (const token of tokens) {
		frequency[token] = (frequency[token] ?? 0) + 1;
	}
	return frequency;
}

function buildIdf(chunks: IndexedChunk[]): Record<string, number> {
	const docFrequency: Record<string, number> = {};
	for (const chunk of chunks) {
		const unique = new Set(chunk.tokens);
		for (const token of unique) {
			docFrequency[token] = (docFrequency[token] ?? 0) + 1;
		}
	}

	const totalDocs = chunks.length;
	const idf: Record<string, number> = {};
	for (const [token, frequency] of Object.entries(docFrequency)) {
		idf[token] = Math.log(1 + (totalDocs - frequency + 0.5) / (frequency + 0.5));
	}
	return idf;
}

export function createRagIndex(payload: RagPayload): RagIndex {
	const chunks: IndexedChunk[] = [];

	for (const doc of payload.docs) {
		const parts = splitIntoChunks(doc.content, payload.retrieval.chunkSize, payload.retrieval.overlap);
		let localIndex = 0;
		for (const part of parts) {
			const tokens = tokenize(part);
			chunks.push({
				docId: `${doc.id}#${localIndex++}`,
				docTitle: doc.title,
				content: part,
				tokens,
				termFrequency: toTermFrequency(tokens),
				tokenCount: tokens.length
			});
		}
	}

	const avgChunkLength =
		chunks.length > 0 ? chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length : 1;

	return {
		chunks,
		topK: payload.retrieval.topK,
		avgChunkLength,
		idfByToken: buildIdf(chunks)
	};
}

export function retrieveTopChunks(index: RagIndex, query: string, topK = index.topK): RetrievedChunk[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0 || index.chunks.length === 0) {
		return [];
	}

	const queryFrequency = toTermFrequency(queryTokens);
	const uniqueQuery = Object.keys(queryFrequency);
	const scored = index.chunks
		.map((chunk) => {
			let bm25Score = 0;
			let matched = 0;
			for (const token of uniqueQuery) {
				const tf = chunk.termFrequency[token] ?? 0;
				if (tf === 0) {
					continue;
				}
				matched += 1;
				const idf = index.idfByToken[token] ?? 0;
				const numerator = tf * (BM25_K1 + 1);
				const denominator =
					tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.tokenCount / Math.max(index.avgChunkLength, 1)));
				bm25Score += idf * (numerator / denominator) * queryFrequency[token];
			}

			const coverage = matched / Math.max(uniqueQuery.length, 1);
			const normalized = bm25Score + coverage * 0.15;
			return {
				docTitle: chunk.docTitle,
				content: chunk.content,
				score: normalized
			};
		})
		.filter((entry) => entry.score > 0)
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
