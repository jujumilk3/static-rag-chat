<svelte:options runes={false} />

<script lang="ts">
	import { afterUpdate, onMount } from 'svelte';
	import {
		DEFAULT_MODELS,
		PROVIDER_LABELS,
		generateChatCompletion,
		type ChatMessage,
		type ProviderName
	} from '$lib/chat/providers';
	import {
		createDefaultPayload,
		encodePayload,
		normalizePayload,
		parsePayloadFromHash,
		payloadToHash,
		payloadToPrettyJson
	} from '$lib/rag/urlPayload';
	import {
		createRagIndex,
		formatRetrievedContext,
		retrieveTopChunks,
		type RetrievedChunk
	} from '$lib/rag/retrieval';
	import type { RagDoc, RagPayload } from '$lib/rag/types';

	type UIMessage = {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		createdAt: number;
	};

	type StarterPrompt = {
		label: string;
		prompt: string;
	};

	type SettingsTab = 'connection' | 'rag' | 'data';
	type ThemeMode = 'light' | 'dark';

	const STORAGE_PREFIX = 'static-rag-chat';
	const PROVIDERS: ProviderName[] = ['openai', 'anthropic', 'gemini'];
	const PAYLOAD_DRAFT_KEY = `${STORAGE_PREFIX}:payload-draft`;
	const THEME_KEY = `${STORAGE_PREFIX}:theme`;
	const RECENT_HISTORY_LIMIT = 12;
	const MAX_CONTEXT_CHARS = 12000;
	const STARTER_PROMPTS: StarterPrompt[] = [
		{
			label: '빠른 요약',
			prompt: '공유된 문서 전체를 6줄 핵심 요약으로 정리해줘.'
		},
		{
			label: '의사결정 포인트',
			prompt: '이 문서 기준으로 의사결정에 필요한 체크리스트를 만들어줘.'
		},
		{
			label: '실행 플랜',
			prompt: '바로 실행 가능한 단계별 액션 플랜으로 변환해줘.'
		},
		{
			label: '리스크 탐지',
			prompt: '문서 안에서 놓치기 쉬운 리스크나 모순점을 찾아줘.'
		}
	];

	let provider: ProviderName = 'openai';
	let apiKey = '';
	let model = DEFAULT_MODELS.openai;
	let payload: RagPayload = createDefaultPayload();
	let payloadJson = payloadToPrettyJson(payload);
	let payloadError = '';
	let status = '';
	let loading = false;
	let prompt = '';
	let chatMessages: UIMessage[] = [];
	let retrievedChunks: RetrievedChunk[] = [];
	let shareUrl = '';
	let ragIndex = createRagIndex(payload);
	let activeRequestController: AbortController | null = null;
	let messageViewport: HTMLDivElement | null = null;
	let composerTextarea: HTMLTextAreaElement | null = null;
	let shouldAutoScroll = true;

	let settingsOpen = false;
	let settingsTab: SettingsTab = 'connection';
	let showRetrievedContext = false;
	let theme: ThemeMode = 'light';

	let titleInput = payload.title;
	let systemPromptInput = payload.systemPrompt;
	let topKInput = payload.retrieval.topK;
	let chunkSizeInput = payload.retrieval.chunkSize;
	let overlapInput = payload.retrieval.overlap;

	let newDocTitle = '';
	let newDocContent = '';
	let importUrl = '';

	let encodedLength = 0;
	let urlLength = 0;
	let urlRisk: 'ok' | 'warn' | 'danger' = 'ok';

	$: ragIndex = createRagIndex(payload);
	$: hasApiKey = apiKey.trim().length > 0;
	$: canSend = !loading && hasApiKey && prompt.trim().length > 0;
	$: hasConversation = chatMessages.length > 0;
	$: docCount = payload.docs.length;
	$: docChars = payload.docs.reduce((sum, doc) => sum + doc.content.length, 0);
	$: {
		try {
			encodedLength = encodePayload(payload).length;
		} catch {
			encodedLength = 0;
		}
	}
	$: urlLength = shareUrl.length;
	$: {
		if (urlLength >= 7800 || encodedLength >= 7200) {
			urlRisk = 'danger';
		} else if (urlLength >= 4500 || encodedLength >= 4000) {
			urlRisk = 'warn';
		} else {
			urlRisk = 'ok';
		}
	}
	$: {
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.theme = theme;
			document.documentElement.style.colorScheme = theme;
			document.body.style.overflow = settingsOpen ? 'hidden' : '';
		}
	}

	function nowId(): string {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function systemTheme(): ThemeMode {
		if (typeof window === 'undefined') {
			return 'light';
		}
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	function loadTheme() {
		if (typeof window === 'undefined') {
			return;
		}
		const saved = window.localStorage.getItem(THEME_KEY);
		if (saved === 'light' || saved === 'dark') {
			theme = saved;
			return;
		}
		theme = systemTheme();
	}

	function setTheme(next: ThemeMode) {
		theme = next;
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(THEME_KEY, next);
		}
		status = `Theme: ${next}`;
	}

	function toggleTheme() {
		setTheme(theme === 'dark' ? 'light' : 'dark');
	}

	function formatMessageTime(timestamp: number): string {
		return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function focusComposer() {
		composerTextarea?.focus();
	}

	function useStarterPrompt(nextPrompt: string) {
		prompt = nextPrompt;
		focusComposer();
	}

	function scrollMessagesToBottom(force = false) {
		if (!messageViewport) {
			return;
		}
		if (!force && !shouldAutoScroll) {
			return;
		}
		messageViewport.scrollTop = messageViewport.scrollHeight;
	}

	function handleMessagesScroll() {
		if (!messageViewport) {
			return;
		}
		const remaining = messageViewport.scrollHeight - messageViewport.scrollTop - messageViewport.clientHeight;
		shouldAutoScroll = remaining < 80;
	}

	function openSettings(tab: SettingsTab = 'connection') {
		settingsTab = tab;
		settingsOpen = true;
	}

	function closeSettings() {
		settingsOpen = false;
	}

	function handleModalBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			closeSettings();
		}
	}

	function storageKeyForApi(providerName: ProviderName): string {
		return `${STORAGE_PREFIX}:api:${providerName}`;
	}

	function storageKeyForModel(providerName: ProviderName): string {
		return `${STORAGE_PREFIX}:model:${providerName}`;
	}

	function storageKeyProvider(): string {
		return `${STORAGE_PREFIX}:provider`;
	}

	function syncBuilderInputsFromPayload() {
		titleInput = payload.title;
		systemPromptInput = payload.systemPrompt;
		topKInput = payload.retrieval.topK;
		chunkSizeInput = payload.retrieval.chunkSize;
		overlapInput = payload.retrieval.overlap;
	}

	function loadLocalSettings() {
		if (typeof window === 'undefined') {
			return;
		}

		const preferredProvider = window.localStorage.getItem(storageKeyProvider());
		if (preferredProvider === 'openai' || preferredProvider === 'anthropic' || preferredProvider === 'gemini') {
			provider = preferredProvider;
		}

		model = window.localStorage.getItem(storageKeyForModel(provider)) ?? DEFAULT_MODELS[provider];
		apiKey = window.localStorage.getItem(storageKeyForApi(provider)) ?? '';
	}

	function saveProviderSettings() {
		if (typeof window === 'undefined') {
			return;
		}
		window.localStorage.setItem(storageKeyProvider(), provider);
		window.localStorage.setItem(storageKeyForModel(provider), model);
		window.localStorage.setItem(storageKeyForApi(provider), apiKey);
	}

	function savePayloadDraft() {
		if (typeof window === 'undefined') {
			return;
		}
		window.localStorage.setItem(PAYLOAD_DRAFT_KEY, payloadToPrettyJson(payload));
	}

	function loadPayloadDraft(): boolean {
		if (typeof window === 'undefined') {
			return false;
		}

		const raw = window.localStorage.getItem(PAYLOAD_DRAFT_KEY);
		if (!raw) {
			return false;
		}

		try {
			const parsed = JSON.parse(raw);
			const normalized = normalizePayload(parsed);
			commitPayload(normalized, {
				syncHash: false,
				statusMessage: `Loaded local draft (${normalized.docs.length} doc(s))`
			});
			return true;
		} catch {
			window.localStorage.removeItem(PAYLOAD_DRAFT_KEY);
			return false;
		}
	}

	function updateShareUrl() {
		if (typeof window === 'undefined') {
			return;
		}
		const hash = payloadToHash(payload);
		shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
	}

	function syncHashWithPayload() {
		if (typeof window === 'undefined') {
			return;
		}
		const nextHash = payloadToHash(payload);
		if (window.location.hash !== nextHash) {
			window.history.replaceState(null, '', nextHash);
		}
		updateShareUrl();
	}

	function commitPayload(
		nextPayload: RagPayload,
		options: {
			syncHash?: boolean;
			statusMessage?: string;
		} = {}
	) {
		payload = normalizePayload(nextPayload);
		payloadJson = payloadToPrettyJson(payload);
		payloadError = '';
		syncBuilderInputsFromPayload();
		savePayloadDraft();

		if (options.statusMessage) {
			status = options.statusMessage;
		}

		if (options.syncHash === false) {
			updateShareUrl();
		} else {
			syncHashWithPayload();
		}
	}

	function loadPayloadFromHash(): boolean {
		if (typeof window === 'undefined') {
			return false;
		}

		const { payload: parsed, error } = parsePayloadFromHash(window.location.hash);
		if (parsed) {
			commitPayload(parsed, {
				syncHash: false,
				statusMessage: `URL payload loaded (${parsed.docs.length} doc(s))`
			});
			return true;
		}

		if (error) {
			payloadError = `Failed to parse URL payload: ${error}`;
			status = '';
			updateShareUrl();
			return false;
		}

		updateShareUrl();
		return false;
	}

	function handleProviderChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement;
		const next = target.value as ProviderName;
		if (!PROVIDERS.includes(next)) {
			return;
		}
		provider = next;
		if (typeof window !== 'undefined') {
			model = window.localStorage.getItem(storageKeyForModel(provider)) ?? DEFAULT_MODELS[provider];
			apiKey = window.localStorage.getItem(storageKeyForApi(provider)) ?? '';
		}
		saveProviderSettings();
	}

	function handleApiKeyInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		apiKey = target.value;
		saveProviderSettings();
	}

	function handleModelInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		model = target.value;
		saveProviderSettings();
	}

	function applyBuilderSettings() {
		try {
			const next = normalizePayload({
				...payload,
				title: titleInput,
				systemPrompt: systemPromptInput,
				retrieval: {
					topK: Number(topKInput),
					chunkSize: Number(chunkSizeInput),
					overlap: Number(overlapInput)
				}
			});
			commitPayload(next, { statusMessage: 'Builder settings updated' });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Invalid settings';
			payloadError = message;
			status = '';
		}
	}

	function applyPayloadJson() {
		try {
			const parsed = JSON.parse(payloadJson);
			const next = normalizePayload(parsed);
			commitPayload(next, { statusMessage: `Payload updated (${next.docs.length} doc(s))` });
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Invalid payload JSON';
			payloadError = message;
			status = '';
		}
	}

	function resetPayload() {
		commitPayload(createDefaultPayload(), { statusMessage: 'Payload reset to sample' });
	}

	function addDocument() {
		const content = newDocContent.trim();
		const title = newDocTitle.trim();

		if (!content) {
			payloadError = 'Document content cannot be empty.';
			status = '';
			return;
		}

		const nextDoc: RagDoc = {
			id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			title: title || `Document ${payload.docs.length + 1}`,
			content
		};

		commitPayload(
			{
				...payload,
				docs: [...payload.docs, nextDoc]
			},
			{ statusMessage: `Added document: ${nextDoc.title}` }
		);

		newDocTitle = '';
		newDocContent = '';
	}

	function removeDocument(docId: string) {
		if (payload.docs.length <= 1) {
			payloadError = 'At least one document must remain in the payload.';
			status = '';
			return;
		}

		const nextDocs = payload.docs.filter((doc) => doc.id !== docId);
		commitPayload(
			{
				...payload,
				docs: nextDocs
			},
			{ statusMessage: `Removed document. ${nextDocs.length} doc(s) left.` }
		);
	}

	function titleFromFilename(filename: string): string {
		const withoutExt = filename.replace(/\.[^.]+$/, '');
		const normalized = withoutExt.replace(/[_-]+/g, ' ').trim();
		return normalized || filename;
	}

	async function importFiles(files: File[]) {
		if (files.length === 0) {
			return;
		}

		payloadError = '';
		status = 'Importing files...';

		if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
			const text = await files[0].text();
			try {
				const parsed = JSON.parse(text);
				const next = normalizePayload(parsed);
				commitPayload(next, { statusMessage: `Imported payload from ${files[0].name}` });
				return;
			} catch {
				// fallback to plain text import
			}
		}

		const importedDocs: RagDoc[] = [];
		for (const file of files) {
			const text = (await file.text()).trim();
			if (!text) {
				continue;
			}
			importedDocs.push({
				id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				title: titleFromFilename(file.name),
				content: text
			});
		}

		if (importedDocs.length === 0) {
			status = '';
			payloadError = 'No readable content found in imported files.';
			return;
		}

		commitPayload(
			{
				...payload,
				docs: [...payload.docs, ...importedDocs]
			},
			{ statusMessage: `Imported ${importedDocs.length} file(s)` }
		);
	}

	function handleFileInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const files = target.files ? Array.from(target.files) : [];
		target.value = '';
		void importFiles(files);
	}

	function applyImportUrl() {
		const input = importUrl.trim();
		if (!input) {
			return;
		}

		let hash = '';
		if (input.startsWith('#')) {
			hash = input;
		} else {
			try {
				const parsed = new URL(input);
				hash = parsed.hash;
			} catch {
				hash = `#r=${input}`;
			}
		}

		if (!hash) {
			payloadError = 'Input URL does not contain a payload hash.';
			status = '';
			return;
		}

		const { payload: parsed, error } = parsePayloadFromHash(hash);
		if (!parsed) {
			payloadError = error ? `Failed to import URL payload: ${error}` : 'Failed to import URL payload.';
			status = '';
			return;
		}

		commitPayload(parsed, { statusMessage: `Imported payload from URL (${parsed.docs.length} doc(s))` });
		importUrl = '';
	}

	async function copyShareUrl() {
		if (!shareUrl) {
			status = 'No share URL available';
			return;
		}
		try {
			await navigator.clipboard.writeText(shareUrl);
			status = 'Share URL copied';
		} catch {
			status = 'Clipboard access failed. Copy from the field manually.';
		}
	}

	function downloadPayload() {
		if (typeof window === 'undefined') {
			return;
		}
		const blob = new Blob([payloadToPrettyJson(payload)], { type: 'application/json' });
		const objectUrl = URL.createObjectURL(blob);
		const anchor = window.document.createElement('a');
		anchor.href = objectUrl;
		anchor.download = 'rag-payload.json';
		anchor.click();
		URL.revokeObjectURL(objectUrl);
		status = 'Payload JSON downloaded';
	}

	function clearChat() {
		chatMessages = [];
		retrievedChunks = [];
		prompt = '';
		status = 'Chat cleared';
		shouldAutoScroll = true;
		focusComposer();
	}

	function toChatMessages(history: UIMessage[], context: string): ChatMessage[] {
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

		const trimmedHistory = history.slice(-RECENT_HISTORY_LIMIT);
		for (const message of trimmedHistory) {
			list.push({ role: message.role, content: message.content });
		}

		return list;
	}

	async function submitPrompt() {
		if (!canSend) {
			return;
		}

		payloadError = '';
		status = '';
		const content = prompt.trim();
		prompt = '';

		const userMessage: UIMessage = {
			id: nowId(),
			role: 'user',
			content,
			createdAt: Date.now()
		};
		const nextHistory = [...chatMessages, userMessage];
		chatMessages = nextHistory;

		retrievedChunks = retrieveTopChunks(ragIndex, content, payload.retrieval.topK);
		showRetrievedContext = retrievedChunks.length > 0;
		const context = formatRetrievedContext(retrievedChunks, MAX_CONTEXT_CHARS);

		loading = true;
		const controller = new AbortController();
		activeRequestController = controller;

		try {
			const answer = await generateChatCompletion({
				provider,
				apiKey: apiKey.trim(),
				model: model.trim() || DEFAULT_MODELS[provider],
				messages: toChatMessages(nextHistory, context),
				signal: controller.signal
			});

			chatMessages = [...nextHistory, { id: nowId(), role: 'assistant', content: answer, createdAt: Date.now() }];
			status = `Response generated with ${PROVIDER_LABELS[provider]}`;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				status = 'Generation canceled';
				return;
			}
			const message = error instanceof Error ? error.message : 'Request failed';
			payloadError = message;
		} finally {
			loading = false;
			activeRequestController = null;
		}
	}

	function sendMessage(event: Event) {
		event.preventDefault();
		void submitPrompt();
	}

	function handlePromptKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submitPrompt();
		}
	}

	function cancelGeneration() {
		if (activeRequestController) {
			activeRequestController.abort();
		}
	}

	afterUpdate(() => {
		scrollMessagesToBottom();
	});

	onMount(() => {
		loadTheme();
		loadLocalSettings();
		const loadedFromHash = loadPayloadFromHash();
		if (!loadedFromHash) {
			const canLoadDraft = window.location.hash.length === 0;
			const loadedDraft = canLoadDraft ? loadPayloadDraft() : false;
			if (canLoadDraft && !loadedDraft) {
				syncHashWithPayload();
			}
		}

		const onHashChange = () => {
			loadPayloadFromHash();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && settingsOpen) {
				closeSettings();
			}
		};

		window.addEventListener('hashchange', onHashChange);
		window.addEventListener('keydown', onKeyDown);
		focusComposer();
		scrollMessagesToBottom(true);
		return () => {
			window.removeEventListener('hashchange', onHashChange);
			window.removeEventListener('keydown', onKeyDown);
			if (typeof document !== 'undefined') {
				document.body.style.overflow = '';
			}
		};
	});
</script>

<svelte:head>
	<title>Static RAG Chat</title>
	<meta
		name="description"
		content="URL-shared static RAG chat for OpenAI, Claude, and Gemini API keys"
	/>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Source+Sans+3:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="app-shell">
	<aside class="left-rail">
		<div class="brand">
			<p class="kicker">Static URL RAG</p>
			<h1>RAG Chat Studio</h1>
			<p class="rail-note">공유된 URL 컨텍스트 + 사용자 API 키로 누구나 같은 RAG 채팅을 실행합니다.</p>
		</div>

		<div class="rail-actions">
			<button type="button" on:click={clearChat}>New Chat</button>
			<button type="button" class="ghost" on:click={() => openSettings('connection')}>Settings</button>
			<button type="button" class="ghost" on:click={toggleTheme}>
				{theme === 'dark' ? 'Switch Light' : 'Switch Dark'}
			</button>
		</div>

		<section class="rail-card primary">
			<h2>{payload.title}</h2>
			<p>{docCount} docs · {docChars.toLocaleString()} chars</p>
			<div class="chip-row">
				<span>{PROVIDER_LABELS[provider]}</span>
				<span>{model}</span>
			</div>
		</section>

		<section class="rail-card">
			<div class="card-head">
				<h3>Share Bundle</h3>
				<span class="pill {urlRisk}">{urlRisk === 'ok' ? 'Stable' : urlRisk === 'warn' ? 'Long' : 'Risky'}</span>
			</div>
			<p class="rail-note">URL hash에 RAG payload를 담아 그대로 배포/공유할 수 있습니다.</p>
			<div class="rail-inline-actions">
				<button type="button" class="ghost" on:click={copyShareUrl}>Copy URL</button>
				<button type="button" class="ghost" on:click={() => openSettings('data')}>Data</button>
			</div>
			<p class="rail-meta">URL length {urlLength.toLocaleString()} / payload {encodedLength.toLocaleString()}</p>
		</section>

		<section class="rail-card">
			<h3>Quick Jump</h3>
			<div class="rail-inline-actions">
				<button type="button" class="ghost" on:click={() => openSettings('rag')}>RAG Setup</button>
				<button type="button" class="ghost" on:click={() => openSettings('connection')}>Provider</button>
			</div>
		</section>
	</aside>

	<section class="chat-column">
		<header class="chat-header">
			<div class="chat-title">
				<p class="kicker">Conversation</p>
				<h2>{payload.title}</h2>
				<p class="chat-subtitle">
					{hasApiKey ? 'API key loaded' : 'API key required'} · {hasConversation ? `${chatMessages.length} messages` : 'empty conversation'}
				</p>
			</div>
			<div class="header-actions">
				<button type="button" class="ghost" on:click={() => openSettings('connection')}>Settings</button>
				<button type="button" class="ghost" on:click={() => openSettings('rag')}>RAG</button>
				<button type="button" class="ghost" on:click={() => openSettings('rag')}>Share</button>
			</div>
		</header>

		{#if !hasApiKey}
			<div class="notice warning">
				<span>API key를 입력해야 메시지를 보낼 수 있습니다.</span>
				<button type="button" on:click={() => openSettings('connection')}>Open Settings</button>
			</div>
		{/if}

		<div class="message-stream" bind:this={messageViewport} on:scroll={handleMessagesScroll} aria-live="polite">
			{#if !hasConversation}
				<section class="empty-state">
					<h3>공유된 RAG를 바로 테스트해보세요</h3>
					<p>아래 스타터 프롬프트를 누르면 입력창에 자동으로 들어갑니다.</p>
					<div class="starter-grid">
						{#each STARTER_PROMPTS as starter}
							<button type="button" class="starter-card" on:click={() => useStarterPrompt(starter.prompt)}>
								<span>{starter.label}</span>
								<small>{starter.prompt}</small>
							</button>
						{/each}
					</div>
				</section>
			{/if}

			{#each chatMessages as message}
				<article class="message-row {message.role}">
					<div class="message-avatar">{message.role === 'user' ? 'ME' : 'AI'}</div>
					<div class="message-bubble">
						<div class="message-meta">
							<strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
							<span>{formatMessageTime(message.createdAt)}</span>
						</div>
						<p>{message.content}</p>
					</div>
				</article>
			{/each}

			{#if loading}
				<article class="message-row assistant">
					<div class="message-avatar">AI</div>
					<div class="message-bubble typing">
						<div class="message-meta">
							<strong>Assistant</strong>
							<span>Thinking...</span>
						</div>
						<div class="typing-indicator" aria-hidden="true">
							<span></span>
							<span></span>
							<span></span>
						</div>
					</div>
				</article>
			{/if}
		</div>

		<form class="composer" on:submit={sendMessage}>
			<textarea
				bind:this={composerTextarea}
				bind:value={prompt}
				rows="3"
				placeholder="Message shared RAG context... (Enter send / Shift+Enter newline)"
				on:keydown={handlePromptKeydown}
			></textarea>
			<div class="composer-foot">
				<p>Context-aware reply · 최근 멀티턴 대화와 검색 청크를 함께 사용합니다.</p>
				<div class="composer-actions">
					{#if loading}
						<button type="button" class="danger" on:click={cancelGeneration}>Stop</button>
					{/if}
					<button type="submit" disabled={!canSend}>{loading ? 'Sending...' : 'Send Message'}</button>
				</div>
			</div>
		</form>
	</section>

	<aside class="context-column">
		<section class="context-card">
			<h3>Session</h3>
			<p>Provider: <strong>{PROVIDER_LABELS[provider]}</strong></p>
			<p>Model: <strong>{model}</strong></p>
			<p>API Key: <strong>{hasApiKey ? 'Loaded' : 'Missing'}</strong></p>
			<div class="rail-inline-actions">
				<button type="button" class="ghost" on:click={() => openSettings('connection')}>Manage</button>
			</div>
		</section>

		<section class="context-card">
			<div class="card-head">
				<h3>Retrieved Context</h3>
				{#if retrievedChunks.length > 0}
					<button
						type="button"
						class="ghost mini-btn"
						on:click={() => (showRetrievedContext = !showRetrievedContext)}
					>
						{showRetrievedContext ? 'Hide' : 'Show'}
					</button>
				{/if}
			</div>
			{#if retrievedChunks.length === 0}
				<p class="panel-empty">메시지를 보내면 관련 문서 청크가 여기에 표시됩니다.</p>
			{:else}
				<p class="panel-meta">{retrievedChunks.length} chunk(s) selected</p>
				{#if showRetrievedContext}
					<div class="retrieval-list">
						{#each retrievedChunks as chunk, index}
							<article class="retrieval-item">
								<div class="retrieval-head">
									<strong>{index + 1}. {chunk.docTitle}</strong>
									<span>{chunk.score.toFixed(3)}</span>
								</div>
								<p>{chunk.content}</p>
							</article>
						{/each}
					</div>
				{/if}
			{/if}
		</section>

		<section class="context-card">
			<h3>Activity</h3>
			{#if payloadError}
				<p class="error">{payloadError}</p>
			{:else if status}
				<p class="status">{status}</p>
			{:else}
				<p class="panel-empty">No recent status.</p>
			{/if}
		</section>
	</aside>
</main>

{#if settingsOpen}
	<div class="modal-backdrop" role="presentation" on:click={handleModalBackdropClick}>
		<div class="settings-modal" role="dialog" aria-modal="true" aria-label="RAG settings modal">
			<header class="modal-head">
				<h2>Settings</h2>
				<button type="button" class="icon-btn" on:click={closeSettings}>Close</button>
			</header>

			<nav class="tab-row" aria-label="settings tabs">
				<button type="button" class:selected={settingsTab === 'connection'} on:click={() => (settingsTab = 'connection')}
					>Connection</button
				>
				<button type="button" class:selected={settingsTab === 'rag'} on:click={() => (settingsTab = 'rag')}>RAG</button>
				<button type="button" class:selected={settingsTab === 'data'} on:click={() => (settingsTab = 'data')}>Data</button>
			</nav>

			<div class="tab-panel">
				{#if settingsTab === 'connection'}
					<div class="panel-block">
						<h3>Provider & Model</h3>
						<div class="theme-row">
							<span class="theme-label">Theme</span>
							<div class="theme-options">
								<button
									type="button"
									class="ghost theme-option"
									class:selected-theme={theme === 'light'}
									on:click={() => setTheme('light')}
								>
									Light
								</button>
								<button
									type="button"
									class="ghost theme-option"
									class:selected-theme={theme === 'dark'}
									on:click={() => setTheme('dark')}
								>
									Dark
								</button>
							</div>
						</div>
						<label>
							Provider
							<select value={provider} on:change={handleProviderChange}>
								{#each PROVIDERS as providerOption}
									<option value={providerOption}>{PROVIDER_LABELS[providerOption]}</option>
								{/each}
							</select>
						</label>
						<label>
							API key (saved in localStorage)
							<input
								type="password"
								value={apiKey}
								on:input={handleApiKeyInput}
								placeholder="Paste your API key"
							/>
						</label>
						<label>
							Model
							<input type="text" value={model} on:input={handleModelInput} />
						</label>
					</div>
				{:else if settingsTab === 'rag'}
					<div class="panel-block">
						<h3>RAG Configuration</h3>
						<label>
							Chat title
							<input type="text" bind:value={titleInput} />
						</label>
						<label>
							System prompt
							<textarea rows="4" bind:value={systemPromptInput}></textarea>
						</label>
						<div class="retrieval-grid">
							<label>
								Top K
								<input type="number" min="1" max="12" bind:value={topKInput} />
							</label>
							<label>
								Chunk size
								<input type="number" min="200" max="4000" step="50" bind:value={chunkSizeInput} />
							</label>
							<label>
								Overlap
								<input type="number" min="0" max="2000" step="10" bind:value={overlapInput} />
							</label>
						</div>
						<div class="actions">
							<button type="button" on:click={applyBuilderSettings}>Apply Settings</button>
						</div>
					</div>

					<div class="panel-block">
						<h3>Share URL</h3>
						<label>
							Share URL
							<input type="text" readonly value={shareUrl} />
						</label>
						<p class="help {urlRisk}">
							Encoded payload: {encodedLength.toLocaleString()} chars | URL: {urlLength.toLocaleString()} chars
						</p>
						{#if urlRisk === 'warn'}
							<p class="warn">Warning: link is getting long and may fail in some apps.</p>
						{:else if urlRisk === 'danger'}
							<p class="error">High risk: URL is too long for some browsers/messengers.</p>
						{/if}
						<div class="actions">
							<button type="button" on:click={copyShareUrl}>Copy URL</button>
							<button type="button" class="ghost" on:click={downloadPayload}>Download JSON</button>
						</div>
					</div>
				{:else}
					<div class="panel-block">
						<h3>Documents</h3>
						<p class="help">{docCount} doc(s), {docChars.toLocaleString()} characters</p>
						<div class="doc-list">
							{#each payload.docs as doc, index}
								<article>
									<div class="doc-head">
										<strong>{index + 1}. {doc.title}</strong>
										<button type="button" class="danger" on:click={() => removeDocument(doc.id)}>Remove</button>
									</div>
									<p>{doc.content.slice(0, 220)}{doc.content.length > 220 ? '...' : ''}</p>
								</article>
							{/each}
						</div>

						<label>
							New document title (optional)
							<input type="text" bind:value={newDocTitle} placeholder="Example: Product FAQ" />
						</label>
						<label>
							New document content
							<textarea rows="5" bind:value={newDocContent} placeholder="Paste source text here"></textarea>
						</label>
						<div class="actions">
							<button type="button" on:click={addDocument}>Add Document</button>
						</div>

						<label>
							Import files (.txt, .md, .json)
							<input type="file" multiple accept=".txt,.md,.json" on:change={handleFileInput} />
						</label>
						<label>
							Import from shared URL/hash
							<input type="text" bind:value={importUrl} placeholder="https://.../#r=... or #r=..." />
						</label>
						<div class="actions">
							<button type="button" class="ghost" on:click={applyImportUrl}>Import URL Payload</button>
						</div>
					</div>

					<div class="panel-block">
						<h3>Advanced JSON</h3>
						<textarea bind:value={payloadJson} rows="12" spellcheck="false"></textarea>
						<div class="actions">
							<button type="button" on:click={applyPayloadJson}>Apply JSON</button>
							<button type="button" class="ghost" on:click={resetPayload}>Reset Sample</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	:global(:root) {
		--bg: #eff3f7;
		--bg-soft: #e7edf4;
		--bg-spot-a: #9fb8de54;
		--bg-spot-b: #9fcfbe4f;
		--surface: #ffffff;
		--surface-soft: #f7f9fc;
		--surface-muted: #eef3f8;
		--sidebar: #0f1727;
		--sidebar-2: #111f35;
		--text: #182334;
		--muted: #5e6f86;
		--line: #d4ddea;
		--line-strong: #bfccdf;
		--accent: #1f7a8c;
		--accent-strong: #0f5e6d;
		--accent-soft: #e2f3f7;
		--danger: #c23d4a;
		--danger-soft: #fbe4e8;
		--kicker: #738cb6;
		--sidebar-text: #eaf1ff;
		--sidebar-muted: #c5d4ef;
		--sidebar-card-bg: #ffffff10;
		--sidebar-card-border: #ffffff25;
		--message-user-bg: #1f7a8c;
		--message-user-text: #eafaff;
		--message-assistant-bg: #f8fbff;
		--message-assistant-border: #d8e4f1;
		--message-avatar-user-bg: #cfe8ff;
		--message-avatar-assistant-bg: #d9f0f4;
		--label: #6b7d99;
		--input-bg: #ffffff;
		--input-text: #132033;
		--input-border: #bfccdf;
		--input-focus: #2f8aa0;
		--input-focus-ring: #2f8aa02a;
		--ghost-bg: #e9eff7;
		--ghost-text: #2f4667;
		--modal-backdrop: #0b1324a3;
		--notice-bg: #fff7e9;
		--notice-border: #ebd2a3;
		--notice-text: #765400;
		--error: #a11f33;
		--status: #1b7a57;
		--shadow: 0 18px 42px rgba(14, 26, 44, 0.14);
	}

	:global(:root[data-theme='dark']) {
		--bg: #0d141f;
		--bg-soft: #111a28;
		--bg-spot-a: #2f617f55;
		--bg-spot-b: #426c7f57;
		--surface: #172132;
		--surface-soft: #1d293d;
		--surface-muted: #202d44;
		--sidebar: #090f1a;
		--sidebar-2: #0d1728;
		--text: #e7eefb;
		--muted: #a6b6d0;
		--line: #30415d;
		--line-strong: #3f5374;
		--accent: #55a6bf;
		--accent-strong: #2d8198;
		--accent-soft: #244556;
		--danger: #da6b78;
		--danger-soft: #43232a;
		--kicker: #9db0d6;
		--sidebar-text: #e6edf8;
		--sidebar-muted: #b7c7e2;
		--sidebar-card-bg: #ffffff0d;
		--sidebar-card-border: #ffffff1f;
		--message-user-bg: #2f8ea8;
		--message-user-text: #e8f9ff;
		--message-assistant-bg: #202d44;
		--message-assistant-border: #364a6e;
		--message-avatar-user-bg: #2f557f;
		--message-avatar-assistant-bg: #33576a;
		--label: #a4b8d8;
		--input-bg: #131c2b;
		--input-text: #deebff;
		--input-border: #3d5272;
		--input-focus: #66b4cb;
		--input-focus-ring: #66b4cb2a;
		--ghost-bg: #293851;
		--ghost-text: #d7e4fb;
		--modal-backdrop: #040810c9;
		--notice-bg: #3d3218;
		--notice-border: #836a34;
		--notice-text: #f4d891;
		--error: #ff9db1;
		--status: #98dfbf;
		--shadow: 0 12px 36px rgba(0, 3, 10, 0.42);
	}

	:global(body) {
		margin: 0;
		font-family: 'Source Sans 3', 'Noto Sans KR', sans-serif;
		color: var(--text);
		background:
			radial-gradient(circle at 0 0, var(--bg-spot-a) 0, transparent 35%),
			radial-gradient(circle at 100% 0, var(--bg-spot-b) 0, transparent 38%),
			linear-gradient(165deg, var(--bg) 0%, var(--bg-soft) 100%);
	}

	:global(*) {
		box-sizing: border-box;
	}

	h1,
	h2,
	h3,
	p {
		margin: 0;
	}

	h1,
	h2,
	h3,
	.kicker {
		font-family: 'Space Grotesk', 'Source Sans 3', sans-serif;
	}

	.kicker {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-weight: 700;
		color: var(--kicker);
	}

	.app-shell {
		display: grid;
		grid-template-columns: 290px minmax(0, 1fr) 330px;
		gap: 0.9rem;
		height: 100vh;
		padding: 1rem;
		max-width: 1920px;
		margin: 0 auto;
	}

	.left-rail {
		border-radius: 18px;
		background: linear-gradient(180deg, var(--sidebar) 0%, var(--sidebar-2) 100%);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		box-shadow: var(--shadow);
		color: var(--sidebar-text);
		border: 1px solid #ffffff14;
	}

	.brand h1 {
		font-size: 1.5rem;
		line-height: 1.08;
		margin-top: 0.2rem;
	}

	.rail-note {
		margin-top: 0.4rem;
		font-size: 0.89rem;
		line-height: 1.35;
		color: var(--sidebar-muted);
	}

	.rail-actions {
		display: grid;
		gap: 0.5rem;
	}

	.rail-card {
		padding: 0.75rem;
		border-radius: 12px;
		background: var(--sidebar-card-bg);
		border: 1px solid var(--sidebar-card-border);
		display: grid;
		gap: 0.45rem;
	}

	.rail-card.primary {
		background: linear-gradient(140deg, #ffffff1b 0%, #ffffff09 100%);
	}

	.rail-card h2 {
		font-size: 1rem;
	}

	.rail-card h3 {
		font-size: 0.96rem;
	}

	.rail-card p {
		font-size: 0.86rem;
		color: var(--sidebar-muted);
	}

	.card-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.45rem;
		align-items: center;
	}

	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip-row span {
		display: inline-flex;
		border-radius: 999px;
		padding: 0.2rem 0.5rem;
		background: #ffffff1e;
		border: 1px solid #ffffff2f;
		font-size: 0.75rem;
		color: #eef5ff;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		padding: 0.14rem 0.5rem;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.pill.ok {
		background: #d4f5e2;
		color: #125236;
	}

	.pill.warn {
		background: #fce5b7;
		color: #7c5300;
	}

	.pill.danger {
		background: #ffd5dc;
		color: #8f1f34;
	}

	:global(:root[data-theme='dark']) .pill.ok {
		background: #224434;
		color: #baf0d2;
	}

	:global(:root[data-theme='dark']) .pill.warn {
		background: #4f3d1b;
		color: #ffe1a3;
	}

	:global(:root[data-theme='dark']) .pill.danger {
		background: #592a32;
		color: #ffc2cd;
	}

	.rail-inline-actions {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.rail-meta {
		font-size: 0.76rem;
		letter-spacing: 0.02em;
	}

	.chat-column {
		display: grid;
		grid-template-rows: auto auto 1fr auto;
		gap: 0.75rem;
		height: calc(100vh - 2rem);
		padding: 0.9rem;
		border-radius: 18px;
		background: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
		box-shadow: var(--shadow);
		border: 1px solid var(--line);
	}

	.chat-header {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: flex-start;
		padding-bottom: 0.58rem;
		border-bottom: 1px solid var(--line);
	}

	.chat-title {
		display: grid;
		gap: 0.3rem;
	}

	.chat-title h2 {
		font-size: 1.28rem;
	}

	.chat-subtitle {
		font-size: 0.87rem;
		color: var(--muted);
	}

	.header-actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.notice {
		border-radius: 10px;
		padding: 0.62rem 0.72rem;
		border: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.92rem;
	}

	.notice.warning {
		background: var(--notice-bg);
		border-color: var(--notice-border);
		color: var(--notice-text);
	}

	.message-stream {
		overflow-y: auto;
		padding: 0.4rem 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.82rem;
		scroll-behavior: smooth;
	}

	.empty-state {
		padding: 0.92rem;
		border-radius: 14px;
		background: linear-gradient(160deg, var(--surface-soft) 0%, var(--surface-muted) 100%);
		border: 1px solid var(--line);
		display: grid;
		gap: 0.7rem;
	}

	.empty-state h3 {
		font-size: 1.02rem;
	}

	.empty-state p {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.starter-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.starter-card {
		text-align: left;
		padding: 0.64rem;
		border: 1px solid var(--line);
		border-radius: 11px;
		background: var(--surface);
		display: grid;
		gap: 0.28rem;
		color: var(--text);
	}

	.starter-card span {
		font-weight: 700;
		font-size: 0.88rem;
	}

	.starter-card small {
		font-size: 0.82rem;
		line-height: 1.28;
		color: var(--muted);
	}

	.message-row {
		display: grid;
		grid-template-columns: 40px minmax(0, min(760px, 92%));
		gap: 0.5rem;
		align-items: flex-end;
		animation: rise 220ms ease both;
	}

	.message-row.user {
		justify-content: end;
		grid-template-columns: minmax(0, min(760px, 92%)) 40px;
	}

	.message-row.user .message-avatar {
		order: 2;
		background: var(--message-avatar-user-bg);
	}

	.message-row.assistant .message-avatar {
		background: var(--message-avatar-assistant-bg);
	}

	.message-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: #f6f8ff;
		border: 1px solid #ffffff38;
		box-shadow: inset 0 -8px 14px #00000012;
	}

	.message-bubble {
		display: grid;
		gap: 0.38rem;
		padding: 0.74rem 0.84rem;
		border-radius: 12px;
		background: var(--message-assistant-bg);
		border: 1px solid var(--message-assistant-border);
		box-shadow: 0 3px 10px #0d162310;
	}

	.message-row.user .message-bubble {
		background: linear-gradient(160deg, var(--message-user-bg) 0%, var(--accent-strong) 100%);
		color: var(--message-user-text);
		border-color: transparent;
	}

	.message-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: center;
	}

	.message-meta strong {
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--label);
	}

	.message-meta span {
		font-size: 0.76rem;
		color: var(--muted);
	}

	.message-row.user .message-meta strong,
	.message-row.user .message-meta span {
		color: color-mix(in srgb, var(--message-user-text) 84%, #0e3240 16%);
	}

	.message-bubble p {
		line-height: 1.45;
		white-space: pre-wrap;
	}

	.typing-indicator {
		display: flex;
		gap: 0.32rem;
		padding: 0.16rem 0.04rem;
	}

	.typing-indicator span {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--label);
		animation: pulse 1s ease infinite;
	}

	.typing-indicator span:nth-child(2) {
		animation-delay: 0.15s;
	}

	.typing-indicator span:nth-child(3) {
		animation-delay: 0.3s;
	}

	.composer {
		display: grid;
		gap: 0.58rem;
		padding-top: 0.58rem;
		border-top: 1px solid var(--line);
		background: linear-gradient(180deg, transparent 0%, var(--surface) 34%);
	}

	.composer textarea {
		min-height: 84px;
		max-height: 220px;
	}

	.composer-foot {
		display: flex;
		justify-content: space-between;
		gap: 0.7rem;
		align-items: center;
	}

	.composer-foot p {
		font-size: 0.82rem;
		color: var(--muted);
	}

	.composer-actions {
		display: flex;
		gap: 0.48rem;
		justify-content: flex-end;
		flex-shrink: 0;
	}

	.context-column {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 0.75rem;
		height: calc(100vh - 2rem);
	}

	.context-card {
		border-radius: 15px;
		border: 1px solid var(--line);
		background: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
		padding: 0.8rem;
		display: grid;
		gap: 0.55rem;
		box-shadow: var(--shadow);
	}

	.context-card h3 {
		font-size: 0.98rem;
	}

	.context-card p {
		font-size: 0.88rem;
		color: var(--muted);
	}

	.context-card strong {
		color: var(--text);
	}

	.mini-btn {
		padding: 0.32rem 0.58rem;
		font-size: 0.8rem;
	}

	.panel-meta {
		font-size: 0.82rem;
	}

	.panel-empty {
		padding: 0.62rem;
		border-radius: 10px;
		background: var(--surface-muted);
		border: 1px solid var(--line);
		font-size: 0.84rem;
		color: var(--muted);
	}

	.retrieval-list {
		display: grid;
		gap: 0.5rem;
		max-height: min(48vh, 460px);
		overflow: auto;
	}

	.retrieval-item {
		padding: 0.58rem 0.6rem;
		border-radius: 10px;
		background: var(--surface);
		border: 1px solid var(--line);
	}

	.retrieval-head {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: center;
	}

	.retrieval-head strong {
		font-size: 0.82rem;
	}

	.retrieval-head span {
		font-size: 0.76rem;
		color: var(--muted);
		font-weight: 700;
	}

	.retrieval-item p {
		margin-top: 0.36rem;
		font-size: 0.82rem;
		line-height: 1.36;
		color: var(--muted);
		white-space: pre-wrap;
	}

	.error {
		color: var(--error);
		font-weight: 700;
		background: var(--danger-soft);
		border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
		padding: 0.55rem 0.62rem;
		border-radius: 10px;
	}

	.status {
		color: var(--status);
		font-weight: 700;
		background: color-mix(in srgb, var(--status) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--status) 28%, transparent);
		padding: 0.55rem 0.62rem;
		border-radius: 10px;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--modal-backdrop);
		display: grid;
		place-items: center;
		padding: 1rem;
		z-index: 30;
	}

	.settings-modal {
		width: min(980px, 100%);
		max-height: min(92vh, 920px);
		overflow: auto;
		border-radius: 16px;
		background: var(--surface);
		border: 1px solid var(--line);
		box-shadow: 0 24px 54px rgba(15, 25, 45, 0.34);
		display: grid;
		grid-template-rows: auto auto 1fr;
	}

	.modal-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--line);
	}

	.modal-head h2 {
		font-size: 1.18rem;
	}

	.tab-row {
		display: flex;
		gap: 0.45rem;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface-soft);
	}

	.tab-row button {
		padding: 0.45rem 0.74rem;
		background: var(--ghost-bg);
		color: var(--ghost-text);
		font-weight: 700;
	}

	.tab-row button.selected {
		background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
		color: #f4fbff;
	}

	.tab-panel {
		padding: 0.9rem 1rem 1rem;
		display: grid;
		gap: 0.7rem;
		background: var(--surface);
	}

	.panel-block {
		padding: 0.8rem;
		border-radius: 12px;
		border: 1px solid var(--line);
		background: var(--surface-soft);
		display: grid;
		gap: 0.62rem;
	}

	.panel-block h3 {
		font-size: 1rem;
	}

	.theme-row {
		display: grid;
		gap: 0.4rem;
	}

	.theme-label {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--muted);
	}

	.theme-options {
		display: flex;
		gap: 0.45rem;
	}

	.theme-option {
		min-width: 86px;
	}

	.theme-option.selected-theme {
		background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
		color: #f1fdff;
	}

	label {
		display: grid;
		gap: 0.3rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted);
	}

	input,
	select,
	textarea,
	button {
		font: inherit;
	}

	input,
	select,
	textarea {
		width: 100%;
		border: 1px solid var(--input-border);
		border-radius: 10px;
		padding: 0.58rem 0.66rem;
		background: var(--input-bg);
		color: var(--input-text);
		transition: box-shadow 150ms ease, border-color 150ms ease;
	}

	input:focus,
	select:focus,
	textarea:focus {
		border-color: var(--input-focus);
		box-shadow: 0 0 0 3px var(--input-focus-ring);
		outline: none;
	}

	textarea {
		resize: vertical;
		line-height: 1.4;
	}

	button {
		border: none;
		border-radius: 10px;
		padding: 0.55rem 0.86rem;
		background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
		color: #f1fdff;
		font-weight: 700;
		cursor: pointer;
		transition: transform 140ms ease, filter 160ms ease;
	}

	button:hover {
		filter: brightness(1.04);
		transform: translateY(-1px);
	}

	button:active {
		transform: translateY(0);
	}

	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
	}

	button.ghost,
	.icon-btn {
		background: var(--ghost-bg);
		color: var(--ghost-text);
	}

	button.danger {
		background: linear-gradient(135deg, #db4f5c 0%, var(--danger) 100%);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.retrieval-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.55rem;
	}

	.doc-list {
		display: grid;
		gap: 0.5rem;
		max-height: 280px;
		overflow: auto;
	}

	.doc-list article {
		padding: 0.54rem 0.58rem;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--surface);
	}

	.doc-list p {
		margin-top: 0.28rem;
		font-size: 0.86rem;
		line-height: 1.34;
		white-space: pre-wrap;
		color: var(--muted);
	}

	.doc-head {
		display: flex;
		justify-content: space-between;
		gap: 0.44rem;
		align-items: center;
	}

	.doc-head button {
		padding: 0.3rem 0.54rem;
		font-size: 0.78rem;
	}

	.help {
		font-size: 0.82rem;
		color: var(--muted);
	}

	.help.warn,
	.warn {
		color: #8f5a08;
		font-weight: 700;
	}

	.help.danger {
		color: #9b1d32;
		font-weight: 700;
	}

	/* User preference: keep UI mostly flat (minimal rounding) */
	.left-rail,
	.rail-card,
	.chip-row span,
	.pill,
	.chat-column,
	.notice,
	.empty-state,
	.starter-card,
	.message-avatar,
	.message-bubble,
	.context-card,
	.panel-empty,
	.retrieval-item,
	.error,
	.status,
	.settings-modal,
	.panel-block,
	.doc-list article,
	input,
	select,
	textarea,
	button {
		border-radius: 0;
	}

	:global(::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
	}

	:global(::-webkit-scrollbar-track) {
		background: color-mix(in srgb, var(--line) 60%, transparent);
		border-radius: 999px;
	}

	:global(::-webkit-scrollbar-thumb) {
		background: color-mix(in srgb, var(--muted) 40%, var(--line));
		border-radius: 999px;
		border: 2px solid color-mix(in srgb, var(--line) 60%, transparent);
	}

	@keyframes rise {
		from {
			transform: translateY(7px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.4;
			transform: translateY(0);
		}
		50% {
			opacity: 1;
			transform: translateY(-2px);
		}
	}

	@media (max-width: 1460px) {
		.app-shell {
			grid-template-columns: 270px minmax(0, 1fr);
		}

		.context-column {
			grid-column: 1 / -1;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			grid-template-rows: none;
			height: auto;
		}

		.retrieval-list {
			max-height: 300px;
		}
	}

	@media (max-width: 1100px) {
		.app-shell {
			grid-template-columns: 1fr;
			height: auto;
			min-height: 100vh;
			padding: 0.75rem;
		}

		.chat-column {
			order: 1;
			height: auto;
			min-height: 68vh;
		}

		.left-rail {
			order: 2;
		}

		.context-column {
			order: 3;
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 760px) {
		.starter-grid {
			grid-template-columns: 1fr;
		}

		.chat-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.header-actions {
			width: 100%;
		}

		.header-actions button {
			flex: 1;
			min-width: 90px;
		}

		.message-row,
		.message-row.user {
			grid-template-columns: 34px minmax(0, 1fr);
			justify-content: stretch;
		}

		.message-row.user .message-avatar {
			order: 0;
		}

		.composer-foot {
			flex-direction: column;
			align-items: flex-start;
		}

		.composer-actions {
			width: 100%;
			justify-content: flex-end;
		}

		.retrieval-grid {
			grid-template-columns: 1fr;
		}

		.settings-modal {
			max-height: 94vh;
		}

		.tab-row {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
