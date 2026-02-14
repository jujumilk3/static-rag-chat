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
		PanelLeftClose,
		Menu,
		Plus,
		Settings as SettingsIcon,
		Sun,
		Moon,
		X,
		Trash2,
		Send,
		Copy,
		Download
	} from 'lucide-svelte';
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

	type ChatSession = {
		id: string;
		title: string;
		messages: UIMessage[];
		createdAt: number;
		updatedAt: number;
		payloadDigest: string;
	};

	type StarterPrompt = {
		label: string;
		prompt: string;
	};

	type SettingsTab = 'connection' | 'rag' | 'data';
	type ThemeMode = 'light' | 'dark';
	type SettingsPresentation = 'drawer' | 'modal';

	const STORAGE_PREFIX = 'static-rag-chat';
	const PROVIDERS: ProviderName[] = ['openai', 'anthropic', 'gemini'];
	const PAYLOAD_DRAFT_KEY = `${STORAGE_PREFIX}:payload-draft`;
	const THEME_KEY = `${STORAGE_PREFIX}:theme`;
	const LEFT_RAIL_COLLAPSED_KEY = `${STORAGE_PREFIX}:left-rail-collapsed`;
	const CHAT_SESSIONS_KEY = `${STORAGE_PREFIX}:chat-sessions`;
	const CHAT_SESSIONS_LIMIT = 24;
	const RECENT_HISTORY_LIMIT = 12;
	const MAX_CONTEXT_CHARS = 12000;
	const COMPACT_MEDIA_QUERY = '(max-width: 1100px)';
	const NARROW_MEDIA_QUERY = '(max-width: 760px)';
	const STARTER_PROMPTS: StarterPrompt[] = [
		{
			label: 'Quick Summary',
			prompt: 'Summarize the shared document in 6 clear key points.'
		},
		{
			label: 'Decision Checklist',
			prompt: 'Create a checklist of decision items needed for this document.'
		},
		{
			label: 'Execution Plan',
			prompt: 'Convert this into a practical step-by-step action plan.'
		},
		{
			label: 'Risk Detection',
			prompt: 'Find subtle risks and inconsistencies that are easy to miss.'
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
	let chatSessions: ChatSession[] = [];
	let activeSessionId = '';
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
	let settingsPresentation: SettingsPresentation = 'modal';
	let showRetrievedContext = false;
	let theme: ThemeMode = 'light';
	let leftRailCollapsed = false;
	let mobileLeftRailOpen = false;
	let persistApiKey = false;
	let isCompactViewport = false;
	let isNarrowViewport = false;
	let mobileContextOpen = false;

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
	let payloadDigest = '';

	$: ragIndex = createRagIndex(payload);
	$: hasApiKey = apiKey.trim().length > 0;
	$: canSend = !loading && hasApiKey && prompt.trim().length > 0;
	$: hasConversation = chatMessages.length > 0;
	$: docCount = payload.docs.length;
	$: docChars = payload.docs.reduce((sum, doc) => sum + doc.content.length, 0);
	$: activeSessionTitle = chatSessions.find((session) => session.id === activeSessionId)?.title ?? 'New Conversation';
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
			document.body.style.overflow =
				settingsOpen || (isNarrowViewport && (mobileContextOpen || mobileLeftRailOpen)) ? 'hidden' : '';
		}
	}

	function storageKeyLeftRailCollapsed() {
		return LEFT_RAIL_COLLAPSED_KEY;
	}

	function loadLeftRailPreference() {
		if (typeof window === 'undefined') {
			return;
		}
		leftRailCollapsed = window.localStorage.getItem(storageKeyLeftRailCollapsed()) === 'true';
	}

	function saveLeftRailPreference() {
		if (typeof window === 'undefined') {
			return;
		}
		window.localStorage.setItem(storageKeyLeftRailCollapsed(), String(leftRailCollapsed));
	}

	function toggleLeftRail() {
		leftRailCollapsed = !leftRailCollapsed;
		saveLeftRailPreference();
	}

	function nowId(): string {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function buildPayloadDigest(nextPayload: RagPayload): string {
		const normalized = normalizePayload(nextPayload);
		const json = JSON.stringify(normalized);
		let hash = 2166136261;
		for (let i = 0; i < json.length; i++) {
			hash ^= json.charCodeAt(i);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return (hash >>> 0).toString(16).padStart(8, '0');
	}

	function chatStorageKey(forDigest: string): string {
		return `${CHAT_SESSIONS_KEY}:${forDigest}`;
	}

	function isUiMessage(value: unknown): value is UIMessage {
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

	function createChatTitleFromMessages(messages: UIMessage[]): string {
		const firstUser = messages.find((message) => message.role === 'user');
		if (!firstUser) {
			return 'New Conversation';
		}
		const raw = firstUser.content.replace(/\s+/g, ' ').trim();
		if (!raw) {
			return 'New Conversation';
		}
		const short = raw.length > 40 ? `${raw.slice(0, 40)}...` : raw;
		return short;
	}

	function sanitizeSessionTitle(rawTitle: string | undefined, messages: UIMessage[]): string {
		const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
		if (!title) {
			return createChatTitleFromMessages(messages);
		}
		if (/\p{Script=Hangul}/u.test(title)) {
			return createChatTitleFromMessages(messages);
		}
		return title;
	}

	function createSession(forDigest: string): ChatSession {
		const now = Date.now();
		return {
			id: nowId(),
			title: 'New Conversation',
			messages: [],
			createdAt: now,
			updatedAt: now,
			payloadDigest: forDigest
		};
	}

	function normalizeSession(raw: unknown, forDigest: string): ChatSession | null {
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

	function getDefaultSettingsPresentation(): SettingsPresentation {
		return isNarrowViewport || isCompactViewport ? 'drawer' : 'modal';
	}

	function openSettings(tab: SettingsTab = 'connection', presentation?: SettingsPresentation) {
		settingsTab = tab;
		settingsPresentation = presentation ?? getDefaultSettingsPresentation();
		settingsOpen = true;
		mobileContextOpen = false;
		mobileLeftRailOpen = false;
	}

	function closeSettings() {
		settingsOpen = false;
	}

	function toggleMobileContext() {
		if (!mobileContextOpen) {
			closeMobileLeftRail();
		}
		mobileContextOpen = !mobileContextOpen;
	}

	function toggleMobileLeftRail() {
		mobileLeftRailOpen = !mobileLeftRailOpen;
	}

	function closeMobileLeftRail() {
		mobileLeftRailOpen = false;
	}

	function startNewSessionFromRail() {
		clearChat();
		closeMobileLeftRail();
	}

	function handleSettingsDrawerBackdropClick(event: MouseEvent) {
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

	function storageKeyForApiSavePreference(providerName: ProviderName): string {
		return `${STORAGE_PREFIX}:api-save:${providerName}`;
	}

	function storageKeyProvider(): string {
		return `${STORAGE_PREFIX}:provider`;
	}

	function shouldPersistApiKeyForProvider(providerName: ProviderName): boolean {
		if (typeof window === 'undefined') {
			return false;
		}
		const explicit = window.localStorage.getItem(storageKeyForApiSavePreference(providerName));
		if (explicit === 'true' || explicit === 'false') {
			return explicit === 'true';
		}
		return Boolean(window.localStorage.getItem(storageKeyForApi(providerName)));
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
		persistApiKey = shouldPersistApiKeyForProvider(provider);

		model = window.localStorage.getItem(storageKeyForModel(provider)) ?? DEFAULT_MODELS[provider];
		apiKey = persistApiKey ? window.localStorage.getItem(storageKeyForApi(provider)) ?? '' : '';
	}

	function saveProviderSettings() {
		if (typeof window === 'undefined') {
			return;
		}
		window.localStorage.setItem(storageKeyProvider(), provider);
		window.localStorage.setItem(storageKeyForModel(provider), model);
		window.localStorage.setItem(storageKeyForApiSavePreference(provider), String(persistApiKey));
		if (persistApiKey) {
			window.localStorage.setItem(storageKeyForApi(provider), apiKey);
		} else {
			window.localStorage.removeItem(storageKeyForApi(provider));
		}
	}

	function handleApiKeySaveToggle(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const next = target.checked;
		if (next && typeof window !== 'undefined') {
			const currentStored = window.localStorage.getItem(storageKeyForApi(provider));
			if (currentStored) {
				window.alert('An API key already exists in localStorage for this browser. Enabling this will overwrite it with your current input.');
				if (!apiKey.trim()) {
					apiKey = currentStored;
				}
			}
		}
		persistApiKey = next;
		saveProviderSettings();
	}

	function setActiveSession(sessionId: string, options: { focusComposer?: boolean } = {}) {
		const session = chatSessions.find((item) => item.id === sessionId);
		if (!session) {
			return;
		}
		activeSessionId = session.id;
		chatMessages = [...session.messages];
		retrievedChunks = [];
		showRetrievedContext = false;
		prompt = '';
		shouldAutoScroll = true;
		closeMobileLeftRail();
		if (options.focusComposer) {
			focusComposer();
		}
	}

	function upsertActiveSessionMessages(nextMessages: UIMessage[]) {
		const index = chatSessions.findIndex((session) => session.id === activeSessionId);
		if (index === -1) {
			return;
		}
		const derivedTitle = createChatTitleFromMessages(nextMessages);
		chatSessions[index] = {
			...chatSessions[index],
			messages: nextMessages,
			title: chatSessions[index].title === 'New Conversation' ? derivedTitle : chatSessions[index].title,
			updatedAt: Date.now()
		};
		chatMessages = nextMessages;
		chatSessions = [...chatSessions.sort((a, b) => b.updatedAt - a.updatedAt)];
		saveChatSessions();
	}

	function ensureSessionForCurrentPayload() {
		const nextDigest = buildPayloadDigest(payload);
		if (!nextDigest) {
			return;
		}
		if (nextDigest !== payloadDigest) {
			payloadDigest = nextDigest;
			loadChatSessions();
		}
		if (!activeSessionId || !chatSessions.some((session) => session.id === activeSessionId)) {
			startNewSession();
		}
	}

	function saveChatSessions() {
		if (typeof window === 'undefined' || !payloadDigest) {
			return;
		}
		const trimmed = chatSessions
			.map((session) => ({
				...session,
				messages: session.messages.slice(-120)
			}))
			.slice(0, CHAT_SESSIONS_LIMIT);
		window.localStorage.setItem(chatStorageKey(payloadDigest), JSON.stringify(trimmed));
	}

	function loadChatSessions() {
		if (typeof window === 'undefined') {
			return;
		}
		if (!payloadDigest) {
			payloadDigest = buildPayloadDigest(payload);
		}
		const raw = window.localStorage.getItem(chatStorageKey(payloadDigest));
		if (!raw) {
			chatSessions = [];
			startNewSession();
			return;
		}

		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				throw new Error('Invalid session list');
			}
			const normalized = parsed
				.map((entry) => normalizeSession(entry, payloadDigest))
				.filter((entry): entry is ChatSession => entry !== null)
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, CHAT_SESSIONS_LIMIT);

			chatSessions = normalized;
			const active = chatSessions[0];
			if (active) {
				setActiveSession(active.id);
			} else {
				startNewSession();
			}
		} catch {
			window.localStorage.removeItem(chatStorageKey(payloadDigest));
			chatSessions = [];
			startNewSession();
		}
	}

	function startNewSession() {
		if (!payloadDigest) {
			payloadDigest = buildPayloadDigest(payload);
		}
		const session = createSession(payloadDigest);
		chatSessions = [session, ...chatSessions].slice(0, CHAT_SESSIONS_LIMIT);
		activeSessionId = session.id;
		chatMessages = [];
		retrievedChunks = [];
		showRetrievedContext = false;
		status = 'Started new chat';
		prompt = '';
		shouldAutoScroll = true;
		focusComposer();
		saveChatSessions();
	}

	function deleteSession(event: MouseEvent, sessionId: string) {
		event.preventDefault();
		event.stopPropagation();
		if (!window.confirm('Delete this conversation?')) {
			return;
		}
		chatSessions = chatSessions.filter((session) => session.id !== sessionId);
		if (activeSessionId === sessionId) {
			startNewSession();
			return;
		}
		if (!chatSessions.length) {
			startNewSession();
			return;
		}
		saveChatSessions();
		status = 'Chat deleted';
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
		ensureSessionForCurrentPayload();

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
			persistApiKey = shouldPersistApiKeyForProvider(provider);
			apiKey = persistApiKey ? window.localStorage.getItem(storageKeyForApi(provider)) ?? '' : '';
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
		startNewSession();
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
		ensureSessionForCurrentPayload();
		if (!activeSessionId) {
			startNewSession();
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
		upsertActiveSessionMessages(nextHistory);

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

			upsertActiveSessionMessages([...nextHistory, { id: nowId(), role: 'assistant', content: answer, createdAt: Date.now() }]);
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

	function setViewportState() {
		if (typeof window === 'undefined') {
			isCompactViewport = false;
			isNarrowViewport = false;
			mobileContextOpen = false;
			mobileLeftRailOpen = false;
			return;
		}
		isCompactViewport = window.matchMedia(COMPACT_MEDIA_QUERY).matches;
		isNarrowViewport = window.matchMedia(NARROW_MEDIA_QUERY).matches;
		if (!isNarrowViewport) {
			mobileContextOpen = false;
			mobileLeftRailOpen = false;
		}
		if (settingsOpen) {
			settingsPresentation = getDefaultSettingsPresentation();
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
		setViewportState();
		loadTheme();
		loadLocalSettings();
		loadLeftRailPreference();
		const loadedFromHash = loadPayloadFromHash();
		if (!loadedFromHash) {
			const canLoadDraft = window.location.hash.length === 0;
			const loadedDraft = canLoadDraft ? loadPayloadDraft() : false;
			if (canLoadDraft && !loadedDraft) {
				syncHashWithPayload();
			}
		}
		ensureSessionForCurrentPayload();

		const onHashChange = () => {
			loadPayloadFromHash();
			ensureSessionForCurrentPayload();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				if (mobileContextOpen) {
					mobileContextOpen = false;
					return;
				}
				if (mobileLeftRailOpen) {
					mobileLeftRailOpen = false;
					return;
				}
				closeSettings();
				 }
		};
		const compactMedia = window.matchMedia(COMPACT_MEDIA_QUERY);
		const narrowMedia = window.matchMedia(NARROW_MEDIA_QUERY);
		const onViewportResize = () => setViewportState();

		compactMedia.addEventListener('change', onViewportResize);
		narrowMedia.addEventListener('change', onViewportResize);
		window.addEventListener('hashchange', onHashChange);
		window.addEventListener('keydown', onKeyDown);
		focusComposer();
		scrollMessagesToBottom(true);
		return () => {
			compactMedia.removeEventListener('change', onViewportResize);
			narrowMedia.removeEventListener('change', onViewportResize);
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

<main class="app-shell" class:rail-collapsed={leftRailCollapsed}>
	{#if isNarrowViewport && mobileLeftRailOpen}
		<button
			type="button"
			class="left-rail-backdrop"
			on:click={closeMobileLeftRail}
			aria-label="Close side menu"
		></button>
	{/if}

	<aside class="left-rail" class:collapsed={leftRailCollapsed} class:mobile-open={mobileLeftRailOpen && isNarrowViewport}>
		<button
			type="button"
			class="icon-btn rail-toggle"
			on:click={() => {
				if (isNarrowViewport) {
					closeMobileLeftRail();
				} else {
					toggleLeftRail();
				}
			}}
			aria-label={isNarrowViewport ? 'Close side menu' : leftRailCollapsed ? 'Open side menu' : 'Close side menu'}
		>
			{#if isNarrowViewport}
				<PanelLeftClose size={18} />
			{:else if leftRailCollapsed}
				<Menu size={18} />
			{:else}
				<PanelLeftClose size={18} />
			{/if}
		</button>
		<div class="rail-content">
			<div class="brand">
				<p class="kicker">Static URL RAG</p>
				<h1 class="rail-label">RAG Chat Studio</h1>
				<p class="rail-note">Share the same URL context + API key so anyone can run identical RAG chat sessions.</p>
			</div>

			<div class="rail-actions">
				<button type="button" on:click={startNewSessionFromRail}>
					<span class="rail-icon" aria-hidden="true"><Plus size={16} /></span>
					<span class="rail-label">New Chat</span>
				</button>
				<button type="button" class="ghost" on:click={() => openSettings('connection')}>
					<span class="rail-icon" aria-hidden="true"><SettingsIcon size={16} /></span>
					<span class="rail-label">Settings</span>
				</button>
				<button type="button" class="ghost" on:click={toggleTheme}>
					<span class="rail-icon" aria-hidden="true">
						{#if theme === 'dark'}
							<Sun size={16} />
						{:else}
							<Moon size={16} />
						{/if}
					</span>
					<span class="rail-label">{theme === 'dark' ? 'Switch Light' : 'Switch Dark'}</span>
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
					<h3>Chat List</h3>
					<span class="pill">{chatSessions.length}</span>
				</div>
				{#if chatSessions.length === 0}
					<p class="rail-note">No conversation yet. Start a new chat.</p>
				{:else}
					<div class="session-list">
						{#each chatSessions as session (session.id)}
							<div class="session-item">
								<button
									type="button"
									class="session-btn {activeSessionId === session.id ? 'active' : ''}"
									on:click={() => setActiveSession(session.id, { focusComposer: true })}
								>
									<span class="session-title">{session.title}</span>
									<span class="session-meta">
										{session.messages.length} msgs · {formatMessageTime(session.updatedAt)}
									</span>
								</button>
								<button
									type="button"
									class="icon-btn mini-btn danger"
									on:click={(event) => deleteSession(event, session.id)}
									aria-label="Delete chat"
								>
									<Trash2 size={14} />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<section class="rail-card">
				<div class="card-head">
					<h3>Share Bundle</h3>
					<span class="pill {urlRisk}">{urlRisk === 'ok' ? 'Stable' : urlRisk === 'warn' ? 'Long' : 'Risky'}</span>
				</div>
				<p class="rail-note">Pack the RAG payload into the URL hash to share and deploy directly.</p>
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
		</div>
	</aside>

	<section class="chat-column">
		<header class="chat-header">
			{#if isNarrowViewport}
				<button
					type="button"
					class="icon-btn mobile-menu-btn"
					on:click={toggleMobileLeftRail}
					aria-label="Toggle side menu"
				>
					{#if mobileLeftRailOpen}
						<PanelLeftClose size={18} />
					{:else}
						<Menu size={18} />
					{/if}
				</button>
			{/if}

			<div class="chat-title">
				<p class="kicker">Conversation</p>
				<h2>{activeSessionTitle}</h2>
				<p class="chat-subtitle">
					{payload.title} · {hasApiKey ? 'API key loaded' : 'API key required'} · {hasConversation ? `${chatMessages.length} messages` : 'empty conversation'}
				</p>
			</div>
			<div class="chat-toolbar">
				<span class="chat-pill {hasApiKey ? 'chat-pill-ok' : 'chat-pill-warn'}">
					{hasApiKey ? 'API Connected' : 'API Missing'}
				</span>
				<span class="chat-pill">{PROVIDER_LABELS[provider]}</span>
				{#if isNarrowViewport}
					<button type="button" class="chat-pill ghost mobile-pill-btn" on:click={clearChat}>New</button>
					<button type="button" class="chat-pill ghost mobile-pill-btn" on:click={toggleMobileContext}>
						{mobileContextOpen ? 'Close Context' : 'Context'}
					</button>
				{/if}
			</div>
		</header>

		{#if !hasApiKey}
			<div class="notice warning">
				<span>You must enter an API key before sending messages.</span>
				<button type="button" on:click={() => openSettings('connection')}>Open Settings</button>
			</div>
		{/if}

		<div class="message-stream" bind:this={messageViewport} on:scroll={handleMessagesScroll} aria-live="polite">
			{#if !hasConversation}
				<section class="empty-state">
					<h3>Try the shared RAG in one click</h3>
					<p>Click a starter prompt to autofill the composer.</p>
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
				<p>Context-aware responses combine multi-turn history with retrieved chunks.</p>
				<div class="composer-actions">
					{#if loading}
						<button type="button" class="danger" on:click={cancelGeneration}>Stop</button>
					{/if}
					<button type="submit" class="send-btn" disabled={!canSend}>
						<span>{loading ? 'Sending...' : 'Send Message'}</span>
						<Send size={16} />
					</button>
				</div>
			</div>
		</form>
	</section>

	{#if isNarrowViewport && mobileContextOpen}
		<button
			type="button"
			class="context-sheet-backdrop"
			on:click={() => {
				mobileContextOpen = false;
			}}
			aria-label="Close context"
		></button>
	{/if}

	<aside class="context-column" class:mobile-open={mobileContextOpen && isNarrowViewport}>
		{#if isNarrowViewport}
			<div class="mobile-context-head">
				<h3>Session Context</h3>
				<button type="button" class="icon-btn" on:click={() => (mobileContextOpen = false)} aria-label="Close context sheet">
					<X size={16} />
				</button>
			</div>
		{/if}
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
				<p class="panel-empty">Send a message to show matched document chunks here.</p>
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

<div
	class="settings-drawer-backdrop"
	class:open={settingsOpen}
	class:modal={settingsPresentation === 'modal'}
	role="presentation"
	on:click={handleSettingsDrawerBackdropClick}
>
	<div
		class="settings-drawer"
		class:open={settingsOpen}
		class:modal={settingsPresentation === 'modal'}
		class:drawer={settingsPresentation === 'drawer'}
		role="dialog"
		aria-modal="true"
		aria-label="RAG settings"
	>
		<header class="drawer-head">
			<div>
				<p class="kicker">Configuration</p>
				<h2>Settings</h2>
			</div>
			<button type="button" class="icon-btn" on:click={closeSettings} aria-label="Close settings">
				<X size={18} />
			</button>
		</header>

		<nav class="tab-row" aria-label="settings tabs">
			<button
				type="button"
				class:selected={settingsTab === 'connection'}
				on:click={() => (settingsTab = 'connection')}
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
					<label class="toggle-field">
						<span>
							<input
								type="checkbox"
								checked={persistApiKey}
								on:change={handleApiKeySaveToggle}
								aria-label="Save API key in this browser"
							/>
							Save API key in localStorage
						</span>
						<small class="caution">
							Notice: localStorage is stored only in this browser. Disable saving on shared computers and delete it after use.
						</small>
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
						<button type="button" class="with-icon" on:click={copyShareUrl}>
							<Copy size={14} />
							<span>Copy URL</span>
						</button>
						<button type="button" class="with-icon ghost" on:click={downloadPayload}>
							<Download size={14} />
							<span>Download JSON</span>
						</button>
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

<style>
	:global(:root) {
		--bg: #eff3f7;
		--bg-soft: #e7edf4;
		--bg-spot-a: #9fb8de54;
		--bg-spot-b: #9fcfbe4f;
		--surface: #ffffff;
		--surface-soft: #f7f9fc;
		--surface-muted: #eef3f8;
		--surface-elevated: #ffffffed;
		--surface-emphasis: #f2f6ff;
		--surface-border: #d8e0ea;
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
		--left-rail-width: 276px;
		--left-rail-width-collapsed: 84px;
		--left-rail-control-size: var(--control-height);
		--left-rail-shell-gap: 0.9rem;
		--left-rail-shell-padding: 1rem;
		--left-rail-content-padding: 1rem;
		--left-rail-content-padding-collapsed: 0.72rem 0.56rem 0.82rem;
		--left-rail-content-gap: 0.86rem;
		--left-rail-content-gap-collapsed: 0.52rem;
		--left-rail-card-padding: 0.75rem;
		--left-rail-card-gap: 0.45rem;
		--left-rail-collapsed-action-gap: 0.48rem;
		--left-rail-brand-title-size: 1.52rem;
		--left-rail-brand-title-leading: 1.04;
		--left-rail-brand-margin-top: 0.18rem;
		--left-rail-action-pad-x: 0.74rem;
		--left-rail-action-pad-y: 0.52rem;
		--left-rail-rail-gap: 0.6rem;
		--shell-gutter: min(1rem, 2.4vw);
		--shell-max-w: 1820px;
		--message-max-width: min(860px, 92%);
		--left-rail-bg: linear-gradient(180deg, var(--sidebar) 0%, var(--sidebar-2) 100%);
		--left-rail-panel-line: #ffffff14;
		--left-rail-card-bg: linear-gradient(140deg, var(--sidebar-card-bg) 0%, color-mix(in srgb, var(--sidebar-card-bg) 72%, transparent) 100%);
		--left-rail-card-border: var(--sidebar-card-border);
		--left-rail-card-primary: linear-gradient(140deg, #ffffff1f 0%, #ffffff0d 100%);
		--left-rail-shadow: var(--shadow);
		--left-rail-toggle-pos-shift: 0.2rem;
		--left-rail-toggle-hover: color-mix(in srgb, var(--accent) 16%, var(--ghost-bg));
		--panel-shadow: 0 10px 28px rgba(8, 24, 44, 0.2);
		--panel-shadow-soft: 0 4px 16px rgba(9, 24, 44, 0.08);
		--focus-ring-alpha: color-mix(in srgb, var(--accent) 16%, transparent);
		--surface-divider: color-mix(in srgb, var(--line) 82%, transparent);
		--panel-backplate: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
		--input-bg: #ffffff;
		--input-text: #132033;
		--input-border: #bfccdf;
		--input-focus: #2f8aa0;
		--input-focus-ring: color-mix(in srgb, var(--input-focus) 18%, transparent);
		--ghost-bg: #e9eff7;
		--ghost-text: #2f4667;
		--modal-backdrop: #0b1324a3;
		--notice-bg: #fff7e9;
		--notice-border: #ebd2a3;
		--notice-text: #765400;
		--error: #a11f33;
		--status: #1b7a57;
		--shadow: 0 18px 42px rgba(14, 26, 44, 0.14);
		--shadow-soft: 0 8px 24px rgba(14, 26, 44, 0.08);
		--control-height: 36px;
		--control-gap: 0.56rem;
		--control-pad-x: 0.88rem;
		--control-pad-y: 0.5rem;
		--small-pad-x: 0.6rem;
		--small-pad-y: 0.32rem;
		--radius-sm: 8px;
		--radius-md: 12px;
		--radius-lg: 16px;
		--radius-xl: 22px;
		}

	:global(:root[data-theme='dark']) {
		--bg: #0d141f;
		--bg-soft: #111a28;
		--bg-spot-a: #2f617f55;
		--bg-spot-b: #426c7f57;
		--surface: #172132;
		--surface-soft: #1d293d;
		--surface-muted: #202d44;
		--surface-elevated: #172132e8;
		--surface-emphasis: #1d2f47;
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
		--left-rail-width: 258px;
		--left-rail-width-collapsed: 74px;
		--left-rail-control-size: var(--control-height);
		--left-rail-shell-gap: 0.72rem;
		--left-rail-shell-padding: 0.9rem;
		--left-rail-content-padding: 0.86rem;
		--left-rail-content-padding-collapsed: 0.58rem 0.46rem 0.74rem;
		--left-rail-content-gap: 0.72rem;
		--left-rail-content-gap-collapsed: 0.44rem;
		--left-rail-card-padding: 0.68rem;
		--left-rail-card-gap: 0.38rem;
		--left-rail-collapsed-action-gap: 0.4rem;
		--left-rail-action-pad-x: 0.62rem;
		--left-rail-action-pad-y: 0.44rem;
		--left-rail-brand-title-size: 1.36rem;
		--left-rail-brand-title-leading: 1.02;
		--left-rail-brand-margin-top: 0.1rem;
		--left-rail-bg: linear-gradient(165deg, var(--sidebar) 0%, var(--sidebar-2) 100%);
		--left-rail-panel-line: #ffffff1e;
		--left-rail-card-bg: linear-gradient(150deg, #ffffff11 0%, #ffffff08 100%);
		--left-rail-card-border: #ffffff28;
		--left-rail-card-primary: linear-gradient(150deg, #ffffff16 0%, #ffffff0a 100%);
		--left-rail-shadow: 0 14px 34px rgba(1, 5, 12, 0.38);
		--left-rail-toggle-pos-shift: 0.15rem;
		--left-rail-toggle-hover: color-mix(in srgb, var(--accent) 16%, var(--ghost-bg));
		--panel-shadow: 0 10px 28px rgba(1, 5, 10, 0.52);
		--panel-shadow-soft: 0 4px 16px rgba(1, 5, 10, 0.24);
		--focus-ring-alpha: color-mix(in srgb, var(--accent) 18%, transparent);
		--surface-divider: color-mix(in srgb, var(--line) 65%, transparent);
		--panel-backplate: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
		--input-bg: #131c2b;
		--input-text: #deebff;
		--input-border: #3d5272;
		--input-focus: #66b4cb;
		--input-focus-ring: color-mix(in srgb, var(--input-focus) 22%, transparent);
		--ghost-bg: #293851;
		--ghost-text: #d7e4fb;
		--modal-backdrop: #040810c9;
		--notice-bg: #3d3218;
		--notice-border: #836a34;
		--notice-text: #f4d891;
		--error: #ff9db1;
		--status: #98dfbf;
		--shadow: 0 12px 36px rgba(0, 3, 10, 0.42);
		--shadow-soft: 0 7px 26px rgba(0, 2, 8, 0.24);
		--surface-border: #32405c;
		--control-height: 34px;
		--control-gap: 0.5rem;
		--control-pad-x: 0.8rem;
		--control-pad-y: 0.46rem;
		--small-pad-x: 0.55rem;
		--small-pad-y: 0.28rem;
		--radius-sm: 8px;
		--radius-md: 11px;
		--radius-lg: 15px;
		--radius-xl: 20px;
		}

	:global(body) {
		margin: 0;
		font-family: 'Source Sans 3', 'Noto Sans KR', sans-serif;
		color: var(--text);
		min-height: 100vh;
		background-attachment: fixed;
		background:
			radial-gradient(circle at 0 0, var(--bg-spot-a) 0, transparent 35%),
			radial-gradient(circle at 100% 0, var(--bg-spot-b) 0, transparent 38%),
			linear-gradient(165deg, var(--bg) 0%, var(--bg-soft) 100%);
	}

	:global(::selection) {
		background: color-mix(in srgb, var(--accent) 26%, white);
		color: #08111f;
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
		grid-template-columns: var(--left-rail-width) minmax(0, 1fr) 330px;
		gap: var(--left-rail-shell-gap);
		height: 100dvh;
		min-height: 100vh;
		padding: var(--shell-gutter);
		max-width: var(--shell-max-w);
		margin: 0 auto;
		align-items: stretch;
	}

	.app-shell.rail-collapsed {
		grid-template-columns: var(--left-rail-width-collapsed) minmax(0, 1fr) 330px;
	}

	.left-rail-backdrop {
		position: fixed;
		inset: 0;
		border: 0;
		background: transparent;
		z-index: 108;
		pointer-events: none;
	}

	.left-rail {
		border-radius: var(--radius-lg);
		background: var(--left-rail-bg);
		background-blend-mode: soft-light;
		padding: var(--left-rail-content-padding);
		display: flex;
		flex-direction: column;
		gap: var(--left-rail-content-gap);
		box-shadow: var(--left-rail-shadow);
		color: var(--sidebar-text);
		border: 1px solid color-mix(in srgb, var(--left-rail-panel-line), transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		position: relative;
		min-height: 0;
		width: var(--left-rail-width);
		min-width: var(--left-rail-width);
		max-width: var(--left-rail-width);
		overflow: hidden;
		transition:
			width 180ms ease,
			padding 180ms ease,
			gap 180ms ease,
			box-shadow 180ms ease,
			border-color 180ms ease,
			background-position 180ms ease;
		background-position: top;
		z-index: 111;
	}

	.left-rail.mobile-open {
		overflow: auto;
	}

	.left-rail.collapsed {
		padding: var(--left-rail-content-padding-collapsed);
		gap: var(--left-rail-content-gap-collapsed);
		align-items: stretch;
		width: var(--left-rail-width-collapsed);
		min-width: var(--left-rail-width-collapsed);
		max-width: var(--left-rail-width-collapsed);
	}

	.rail-content {
		display: flex;
		flex-direction: column;
		gap: var(--left-rail-content-gap);
		min-height: 0;
		overflow: auto;
	}

	.rail-toggle {
		width: var(--left-rail-control-size);
		height: var(--left-rail-control-size);
		padding: 0;
		display: grid;
		place-items: center;
		font-size: 1rem;
		font-weight: 700;
		border: 1px solid var(--line);
		background: var(--ghost-bg);
		color: var(--sidebar-text);
		transition: background-color 150ms ease, border-color 150ms ease;
	}

	.rail-toggle:hover {
		background-color: var(--left-rail-toggle-hover);
	}

	.left-rail:not(.collapsed) .rail-toggle {
		align-self: flex-end;
		justify-self: end;
		margin-bottom: var(--left-rail-toggle-pos-shift);
	}

	.left-rail.collapsed .rail-toggle {
		margin-inline: auto;
		align-self: center;
		justify-self: center;
		margin-bottom: 0;
	}

	.left-rail .brand,
	.left-rail .rail-card {
		transition: opacity 150ms ease;
	}

	.left-rail.collapsed .brand,
	.left-rail.collapsed .rail-card {
		display: none;
	}

	.left-rail.collapsed .rail-actions {
		gap: var(--left-rail-collapsed-action-gap);
		justify-items: center;
	}

	.left-rail.collapsed .rail-actions button {
		display: grid;
		place-items: center;
		width: var(--left-rail-control-size);
		min-width: var(--left-rail-control-size);
		max-width: var(--left-rail-control-size);
		height: var(--left-rail-control-size);
		min-height: var(--left-rail-control-size);
		max-height: var(--left-rail-control-size);
		padding: 0;
		margin-inline: auto;
	}

	.rail-actions {
		display: grid;
		gap: 0.5rem;
	}

	.rail-actions button {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		text-align: left;
		width: 100%;
		min-height: var(--left-rail-control-size);
		padding: var(--left-rail-action-pad-y) var(--left-rail-action-pad-x);
		transition: background-color 150ms ease, border-color 150ms ease;
	}

	.rail-actions button:hover {
		background: color-mix(in srgb, var(--line) 20%, var(--ghost-bg));
	}

	.rail-actions button.ghost:hover {
		background: color-mix(in srgb, var(--line) 26%, var(--ghost-bg));
	}

	.rail-actions button .rail-icon {
		min-width: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.left-rail.collapsed .rail-label {
		display: none;
	}

	.left-rail .rail-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.left-rail .rail-icon :global(svg) {
		display: block;
	}

	.brand h1 {
		font-size: var(--left-rail-brand-title-size);
		line-height: var(--left-rail-brand-title-leading);
		margin-top: var(--left-rail-brand-margin-top);
	}

	.rail-note {
		margin-top: 0.4rem;
		font-size: 0.89rem;
		line-height: 1.35;
		color: var(--sidebar-muted);
	}

	.rail-card {
		padding: var(--left-rail-card-padding);
		border-radius: var(--radius-md);
		background: var(--left-rail-card-bg);
		border: 1px solid var(--left-rail-card-border);
		display: grid;
		gap: var(--left-rail-card-gap);
		box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff2d 45%, transparent);
	}

	.rail-card.primary {
		background: var(--left-rail-card-primary);
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

	.session-list {
		display: grid;
		gap: 0.45rem;
		max-height: min(300px, 40dvh);
		overflow: auto;
		padding-right: 2px;
	}

	.session-item {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.38rem;
		align-items: stretch;
		min-height: var(--control-height);
	}

	.session-btn {
		display: grid;
		text-align: left;
		gap: 0.22rem;
		background: var(--surface-soft);
		border: 1px solid var(--line);
		color: var(--text);
		width: 100%;
		padding: 0.52rem 0.58rem;
		transition:
			border-color 150ms ease,
			background-color 150ms ease,
			transform 150ms ease;
		border-radius: var(--radius-sm);
	}

	.session-btn:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
		background-color: color-mix(in srgb, var(--accent-soft) 20%, var(--surface-soft));
		transform: translateY(-1px);
	}

	.session-btn.active {
		background: color-mix(in srgb, var(--accent-soft) 42%, var(--surface));
		border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
	}

	.session-btn.active:hover {
		background: color-mix(in srgb, var(--accent-soft) 55%, var(--surface));
	}

	.session-title {
		font-size: 0.84rem;
		font-weight: 700;
		display: block;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-meta {
		font-size: 0.72rem;
		color: var(--muted);
		line-height: 1.3;
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
		height: calc(100dvh - (2 * var(--shell-gutter)));
		padding: 0.95rem;
		border-radius: var(--radius-lg);
		background: var(--panel-backplate);
		box-shadow: var(--panel-shadow-soft);
		border: 1px solid color-mix(in srgb, var(--surface-border) 70%, transparent);
		overflow: hidden;
		min-height: 0;
	}

	.chat-header {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: flex-start;
		padding-bottom: 0.58rem;
		border-bottom: 1px solid var(--line);
		flex-wrap: wrap;
	}

	.chat-toolbar {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}

	.mobile-menu-btn {
		flex: 0 0 auto;
		min-width: 36px;
		padding: 0;
		width: 36px;
		height: 36px;
	}

	.chat-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		background: var(--surface-muted);
		border: 1px solid var(--line);
		font-size: 0.76rem;
		color: var(--muted);
		white-space: nowrap;
	}

	.chat-pill.chat-pill-ok {
		border-color: color-mix(in srgb, #4fca98 40%, var(--line));
		background: color-mix(in srgb, #4fca98 18%, var(--surface-soft));
		color: #085f3d;
	}

	.chat-pill.chat-pill-warn {
		border-color: color-mix(in srgb, #f4b54f 40%, var(--line));
		background: color-mix(in srgb, #f4b54f 18%, var(--surface-soft));
		color: #7a4a08;
	}

	.mobile-pill-btn {
		cursor: pointer;
		text-transform: none;
		text-decoration: none;
		font-size: 0.74rem;
		padding-inline: 0.54rem;
	}

	.mobile-pill-btn:hover,
	.mobile-pill-btn:active {
		filter: none;
	}

	.chat-title {
		display: grid;
		gap: 0.3rem;
	}

	.chat-title h2 {
		font-size: 1.28rem;
		line-height: 1.24;
	}

	.chat-subtitle {
		font-size: 0.87rem;
		color: var(--muted);
	}

	.notice {
		border-radius: var(--radius-md);
		padding: 0.62rem 0.72rem;
		border: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.92rem;
		line-height: 1.35;
		background: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
	}

	.notice.warning {
		background: var(--notice-bg);
		border-color: var(--notice-border);
		color: var(--notice-text);
	}

	.message-stream {
		overflow-y: auto;
		padding: 0.55rem 0.25rem 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.82rem;
		scroll-behavior: smooth;
		border-top: 1px solid var(--surface-divider);
		padding-top: 0.8rem;
	}

	.empty-state {
		padding: 0.92rem;
		border-radius: 14px;
		background: linear-gradient(160deg, var(--surface-soft) 0%, var(--surface-muted) 100%);
		border: 1px solid var(--line);
		display: grid;
		gap: 0.7rem;
		border-left: 3px solid var(--accent);
		box-shadow: var(--panel-shadow-soft);
	}

	.empty-state h3 {
		font-size: 1.02rem;
	}

	.empty-state p {
		color: var(--muted);
		font-size: 0.9rem;
		line-height: 1.45;
	}

	.starter-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.starter-card {
		text-align: left;
		padding: 0.72rem;
		border: 1px solid var(--line);
		border-radius: 11px;
		background: var(--surface);
		display: grid;
		gap: 0.24rem;
		color: var(--text);
		box-shadow: var(--panel-shadow-soft);
		background:
			linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
		transition:
			border-color 150ms ease,
			transform 150ms ease;
	}

	.starter-card:hover {
		border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
		transform: translateY(-1px);
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
		grid-template-columns: 40px minmax(0, var(--message-max-width));
		gap: 0.5rem;
		align-items: flex-end;
		animation: rise 220ms ease both;
	}

	.message-row.user {
		justify-content: end;
		grid-template-columns: minmax(0, var(--message-max-width)) 40px;
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
		padding: 0.76rem 0.9rem;
		border-radius: var(--radius-md);
		background: var(--message-assistant-bg);
		border: 1px solid var(--message-assistant-border);
		box-shadow: var(--panel-shadow-soft);
		line-height: 1.52;
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
		font-size: 0.93rem;
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
		padding-inline: 0.1rem;
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

	.send-btn {
		display: inline-flex;
		gap: 0.45rem;
		align-items: center;
		justify-content: center;
		min-width: 154px;
	}

	.send-btn :global(svg) {
		transform: translateY(1px);
	}

	.composer-foot p {
		font-size: 0.82rem;
		color: var(--muted);
		line-height: 1.35;
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
		height: calc(100dvh - (2 * var(--shell-gutter)));
		min-height: 0;
	}

	.context-sheet-backdrop {
		position: fixed;
		inset: 0;
		border: 0;
		background: transparent;
		z-index: 109;
		pointer-events: none;
	}

	.context-column.mobile-open {
		position: relative;
		grid-template-columns: 1fr;
	}

	.mobile-context-head {
		display: none;
	}

	.context-card {
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--panel-backplate);
		padding: 0.8rem;
		display: grid;
		gap: 0.55rem;
		box-shadow: var(--panel-shadow-soft);
		border-color: color-mix(in srgb, var(--line) 84%, transparent);
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
		min-height: 28px;
		height: 28px;
		line-height: 1;
		min-width: 60px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.32rem;
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
		scrollbar-gutter: stable;
	}

	.retrieval-item {
		padding: 0.58rem 0.6rem;
		border-radius: 10px;
		background: var(--surface);
		border: 1px solid var(--line);
		transition: border-color 150ms ease;
		background: linear-gradient(180deg, var(--surface) 0%, var(--surface-soft) 100%);
	}

	.retrieval-item:hover {
		border-color: color-mix(in srgb, var(--accent) 34%, var(--line));
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

	.settings-drawer-backdrop {
		position: fixed;
		inset: 0;
		display: flex;
		justify-content: center;
		align-items: stretch;
		z-index: 120;
		background: var(--modal-backdrop);
		opacity: 0;
		pointer-events: none;
		transition: opacity 180ms ease;
		backdrop-filter: blur(2px);
		-webkit-backdrop-filter: blur(2px);
	}

	.settings-drawer-backdrop:not(.modal) {
		justify-content: flex-end;
		align-items: stretch;
	}

	.settings-drawer-backdrop.open {
		opacity: 1;
		pointer-events: auto;
	}

	.settings-drawer-backdrop.modal {
		justify-content: center;
		align-items: center;
		padding: 1.2rem;
	}

	.settings-drawer {
		position: relative;
		width: min(460px, 88vw);
		max-height: 100%;
		height: 100%;
		overflow: auto;
		background: var(--surface);
		border: 1px solid var(--line);
		box-shadow: var(--panel-shadow);
		display: grid;
		grid-template-rows: auto auto 1fr;
		transform: translateX(100%);
		transition-behavior: normal;
		transition:
			transform 240ms cubic-bezier(0.2, 0.9, 0.2, 1),
			opacity 200ms ease;
		opacity: 0;
		z-index: 121;
		border-radius: var(--radius-xl);
	}

	.settings-drawer.drawer {
		border-radius: var(--radius-lg);
	}

	.settings-drawer.open {
		transform: translateX(0);
		opacity: 1;
	}

	.settings-drawer.modal {
		width: min(980px, calc(100vw - 2.4rem));
		max-height: calc(100vh - 2.25rem);
		height: min(92vh, 860px);
		transform: translateY(14px) scale(0.98);
		box-shadow: var(--panel-shadow);
		border: 1px solid var(--line);
		border-radius: var(--radius-lg);
		margin-inline: auto;
	}

	.settings-drawer.modal.open {
		transform: translateY(0) scale(1);
	}

	.drawer-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--line);
	}

	.drawer-head h2 {
		font-size: 1.18rem;
	}

	.tab-row {
		display: flex;
		gap: 0.45rem;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid var(--line);
		background: linear-gradient(180deg, var(--surface-soft), var(--surface));
	}

	.tab-row button {
		min-height: var(--control-height);
		padding: 0.42rem 0.7rem;
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
		border-radius: var(--radius-md);
		border: 1px solid var(--line);
		background: var(--surface-soft);
		display: grid;
		gap: 0.62rem;
		box-shadow: var(--panel-shadow-soft);
		transition: border-color 150ms ease;
	}

	.panel-block:hover {
		border-color: color-mix(in srgb, var(--accent) 26%, var(--line));
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

	.toggle-field {
		gap: 0.42rem;
	}

	.toggle-field span {
		display: flex;
		gap: 0.44rem;
		align-items: center;
	}

	.toggle-field input[type='checkbox'] {
		width: auto;
		margin: 0;
		accent-color: var(--accent);
	}

	.toggle-field .caution {
		font-size: 0.74rem;
		font-weight: 500;
		color: var(--muted);
		line-height: 1.35;
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
		border-radius: var(--radius-sm);
		padding: 0.54rem 0.64rem;
		min-height: var(--control-height);
		background: var(--input-bg);
		color: var(--input-text);
		line-height: 1.35;
		transition: box-shadow 150ms ease, border-color 150ms ease, background-color 150ms ease;
	}

	input:focus,
	select:focus,
	textarea:focus {
		border-color: var(--input-focus);
		box-shadow: 0 0 0 3px var(--input-focus-ring);
		outline: none;
	}

	input:focus-visible,
	select:focus-visible,
	textarea:focus-visible {
		box-shadow: 0 0 0 3px var(--focus-ring-alpha);
		border-color: var(--input-focus);
	}

	textarea {
		resize: vertical;
		line-height: 1.4;
	}

	button {
		border: none;
		border-radius: var(--radius-sm);
		min-height: var(--control-height);
		padding: var(--control-pad-y) var(--control-pad-x);
		background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
		color: #f1fdff;
		font-weight: 700;
		cursor: pointer;
		transition:
			transform 140ms ease,
			filter 160ms ease,
			box-shadow 140ms ease,
			background 160ms ease;
	}

	button:hover {
		filter: brightness(1.06);
	}

	button:active {
		transform: translateY(0);
		filter: brightness(0.99);
	}

	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
	}

	button:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--line), 0 0 0 2px var(--focus-ring-alpha);
	}

	button.ghost,
	.icon-btn {
		background: var(--ghost-bg);
		color: var(--ghost-text);
		box-shadow: none;
	}

	button.ghost:hover {
		filter: none;
		background: color-mix(in srgb, var(--ghost-bg) 45%, var(--surface));
	}

	button.with-icon {
		display: inline-flex;
		align-items: center;
		gap: 0.38rem;
		justify-content: center;
	}

	button.with-icon :global(svg) {
		flex-shrink: 0;
	}

	button.icon-btn {
		min-height: auto;
		padding: 0;
		width: var(--control-height);
		height: var(--control-height);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.icon-btn.mini-btn {
		width: 28px;
		height: 28px;
		min-width: 28px;
		min-height: 28px;
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
		border-radius: var(--radius-sm);
		background: var(--surface);
		display: grid;
		gap: 0.22rem;
	}

	.doc-list article:hover {
		border-color: color-mix(in srgb, var(--accent) 34%, var(--line));
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
		min-width: auto;
		height: 26px;
		min-height: 26px;
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
	/* Layout should stay softly rounded; keep pills as full circles */
	.left-rail,
	.chat-column,
	.notice,
	.empty-state,
	.starter-card,
	.message-bubble,
	.context-card,
	.panel-empty,
	.retrieval-item,
	.error,
	.status,
	.settings-drawer,
	.panel-block,
	.doc-list article,
	input,
	select,
	textarea,
	button:not(.icon-btn) {
		border-radius: var(--radius-md);
	}

	.left-rail {
		border-radius: var(--radius-lg);
	}

	.message-avatar {
		border-radius: 50%;
	}

	.settings-drawer {
		border-radius: var(--radius-lg) 0 0 var(--radius-lg);
	}

	.settings-drawer.modal {
		border-radius: var(--radius-lg);
	}

	.rail-card {
		border-radius: var(--radius-md);
	}

	.message-row.user .message-avatar,
	.message-row.assistant .message-avatar {
		border-radius: 50%;
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
			grid-template-columns: var(--left-rail-width) minmax(0, 1fr);
		}

		.app-shell.rail-collapsed {
			grid-template-columns: var(--left-rail-width-collapsed) minmax(0, 1fr);
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
		:global(:root) {
			--control-height: 38px;
			--control-pad-y: 0.5rem;
		}

		.settings-drawer.drawer {
			top: 0.75rem;
			height: calc(100dvh - 1.5rem);
		}

		.app-shell {
			grid-template-columns: 1fr;
			height: auto;
			min-height: 100vh;
			padding: clamp(0.65rem, 2vw, 0.95rem);
		}

		.app-shell.rail-collapsed {
			grid-template-columns: 1fr;
		}

		.chat-column {
			order: 1;
			height: auto;
			min-height: min(72dvh, 760px);
		}

		.left-rail {
			order: 2;
		}

		.context-column {
			order: 3;
			grid-template-columns: 1fr;
		}

		.settings-drawer-backdrop.modal {
			justify-content: center;
			align-items: center;
			padding: min(1rem, 4vw);
		}

		.settings-drawer {
			width: min(560px, 100vw);
			max-width: 100%;
		}

		.settings-drawer.modal {
			width: min(560px, 100vw);
			max-width: 100%;
			max-height: min(92vh, 860px);
			height: min(92vh, 860px);
			transform: translateY(8px) scale(0.98);
		}

		.settings-drawer.modal.open {
			transform: translateY(0) scale(1);
		}

		.left-rail {
			min-height: min(52dvh, 420px);
		}
	}

	@media (max-width: 760px) {
		:global(:root) {
			--control-height: 42px;
			--control-pad-y: 0.55rem;
			--radius-sm: 9px;
			--radius-md: 11px;
			--radius-lg: 14px;
			--radius-xl: 18px;
		}

		.settings-drawer.drawer {
			top: 0;
			height: 100dvh;
		}

		.app-shell {
			padding: 0.5rem;
			gap: 0.6rem;
		}

		.left-rail-backdrop {
			background: var(--modal-backdrop);
			pointer-events: auto;
			z-index: 109;
		}

		.left-rail {
			width: min(300px, 85vw);
			min-width: min(300px, 85vw);
			max-width: min(300px, 85vw);
			height: 100dvh;
			position: fixed;
			top: 0;
			left: 0;
			transform: translateX(-110%);
			border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
			z-index: 110;
			padding: calc(var(--left-rail-content-padding) + 0.22rem);
		}

		.left-rail.collapsed {
			width: min(300px, 85vw);
			min-width: min(300px, 85vw);
			max-width: min(300px, 85vw);
		}

		.left-rail.mobile-open {
			transform: translateX(0);
		}

		.left-rail:not(.mobile-open) {
			pointer-events: none;
		}

		.left-rail:not(.mobile-open) .rail-content {
			overflow: hidden;
		}

		.left-rail.mobile-open .rail-content {
			overflow: auto;
		}

		.left-rail.collapsed .rail-content,
		.left-rail.collapsed .rail-card,
		.left-rail.collapsed .brand {
			width: auto;
			max-width: none;
			min-width: 0;
		}

		.left-rail.collapsed .brand,
		.left-rail.collapsed .rail-card {
			display: block;
		}

		.left-rail.collapsed .rail-label {
			display: inline;
		}

		.left-rail.collapsed .rail-actions {
			gap: 0.45rem;
		}

		.left-rail.collapsed .rail-actions button,
		.left-rail .rail-actions button {
			width: 100%;
			display: flex;
			align-items: center;
			justify-content: flex-start;
			gap: 0.55rem;
			min-height: 40px;
			max-width: none;
			padding-inline: 0.7rem;
			margin-inline: 0;
		}

		.left-rail:not(.collapsed) .rail-toggle,
		.left-rail.collapsed .rail-toggle {
			align-self: flex-start;
			justify-self: end;
			width: 34px;
			height: 34px;
			min-width: 34px;
			min-height: 34px;
			padding: 0;
			border-radius: 999px;
			margin-inline-end: auto;
			margin-bottom: 0.22rem;
		}

		.left-rail:not(.collapsed) .rail-toggle {
			margin-left: auto;
			margin-bottom: 0.25rem;
		}

		.left-rail.collapsed .rail-toggle {
			margin-inline: 0;
		}

		.app-shell,
		.chat-column,
		.left-rail,
		.context-column {
			--control-gap: 0.45rem;
			--small-pad-x: 0.58rem;
		}

		.starter-grid {
			grid-template-columns: 1fr;
		}

		.chat-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.55rem;
		}

		.chat-toolbar {
			width: 100%;
			justify-content: flex-start;
			align-items: stretch;
			gap: 0.28rem;
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
			gap: 0.5rem;
		}

		.composer-foot p {
			font-size: 0.76rem;
			color: color-mix(in srgb, var(--muted) 88%, var(--text));
		}

		.composer-actions {
			width: 100%;
			justify-content: flex-end;
		}

		.retrieval-grid {
			grid-template-columns: 1fr;
		}

		.settings-drawer-backdrop,
		.settings-drawer-backdrop.modal {
			justify-content: stretch;
			align-items: stretch;
			padding: 0;
		}

		.settings-drawer {
			width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			transform: translateY(100%);
		}

		.settings-drawer.open {
			transform: translateY(0);
		}

		.settings-drawer.modal {
			width: 100%;
			height: 100dvh;
			max-height: 100dvh;
			transform: translateY(100%);
		}

		.settings-drawer.modal.open {
			transform: translateY(0) scale(1);
		}

		.tab-row {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0.35rem;
			padding: 0.55rem;
		}

		.tab-row button {
			min-height: 34px;
			padding-inline: 0.55rem;
		}

		.tab-panel {
			padding: 0.75rem 0.75rem 0.9rem;
		}

		.drawer-head {
			padding: 0.7rem 0.75rem;
		}

		.context-column,
		.chat-column,
		.left-rail {
			min-height: 0;
		}

		.context-column {
			display: none;
			background: var(--panel-backplate);
			z-index: 110;
			position: fixed;
			left: var(--shell-gutter);
			right: var(--shell-gutter);
			top: 12dvh;
			bottom: calc(0.5rem + env(safe-area-inset-bottom));
			border: 1px solid color-mix(in srgb, var(--surface-border) 74%, transparent);
			border-radius: var(--radius-lg);
			box-shadow: var(--panel-shadow);
			overflow: auto;
			grid-template-rows: auto minmax(0, 1fr) auto;
			max-height: min(74dvh, 620px);
			padding: 0;
		}

		.context-column.mobile-open {
			display: grid;
		}

		.context-column .context-card {
			border-radius: 0;
			border-inline: none;
			border-left: none;
			border-right: none;
			box-shadow: none;
			background: transparent;
		}

		.context-column .context-card:not(:last-child) {
			border-bottom: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
		}

		.context-sheet-backdrop {
			pointer-events: auto;
			background: var(--modal-backdrop);
			z-index: 109;
		}

		.context-column:not(.mobile-open) + .context-sheet-backdrop {
			display: none;
		}

		.mobile-context-head {
			position: sticky;
			top: 0;
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.72rem 0.75rem 0.5rem;
			border-bottom: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
			background: linear-gradient(180deg, color-mix(in srgb, var(--panel-backplate) 94%, transparent) 0%, var(--panel-backplate) 100%);
			z-index: 2;
		}

		.mobile-context-head h3 {
			font-size: 0.96rem;
		}

		.mobile-context-head .icon-btn {
			width: 30px;
			height: 30px;
			min-width: 30px;
			min-height: 30px;
		}

		.chat-pill {
			padding: 0.22rem 0.44rem;
			font-size: 0.68rem;
		}

		.mobile-pill-btn {
			max-height: 32px;
		}
	}
</style>
