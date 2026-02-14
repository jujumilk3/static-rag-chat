export interface RagDoc {
	id: string;
	title: string;
	content: string;
}

export interface RagRetrievalConfig {
	topK: number;
	chunkSize: number;
	overlap: number;
}

export interface RagPayload {
	v: 1;
	title: string;
	systemPrompt: string;
	docs: RagDoc[];
	retrieval: RagRetrievalConfig;
}
