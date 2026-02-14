<svelte:options runes={false} />
<script lang="ts">
	import '$lib/styles/chat-page.css';
import { onMount } from 'svelte';
	import {
		DEFAULT_MODELS,
		PROVIDER_LABELS,
		fetchModelCatalog,
		getDefaultApiKey,
		generateChatCompletion,
		type ProviderName
	} from '$lib/chat/providers';
	import ChatColumn from '$lib/components/ChatColumn.svelte';
	import ContextColumn from '$lib/components/ContextColumn.svelte';
	import LeftRail from '$lib/components/LeftRail.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import type { ChatSession, SettingsPresentation, SettingsTab, ThemeMode, UIMessage } from '$lib/types/ui';
	import {
		createDefaultPayload,
		encodePayload,
		normalizePayload,
		parsePayloadFromHash,
		payloadToHash,
		payloadToPrettyJson
	} from '$lib/rag/urlPayload';
	import {
		buildPayloadDigest,
		createRagIndexForPayload,
		formatMessageTime,
		getDefaultSettingsPresentation,
		nowId,
		systemTheme,
		toChatMessages
	} from '$lib/utils/chat-page';
	import {
		createChatTitleFromMessages,
		createSession,
		isUiMessage,
		normalizeSession,
		sanitizeSessionTitle
	} from '$lib/utils/chat-session';
	import {
		STORAGE_PREFIX,
		CHAT_SESSIONS_KEY,
		CHAT_SESSIONS_LIMIT,
		COMPACT_MEDIA_QUERY,
		LEFT_RAIL_COLLAPSED_KEY,
		MAX_CONTEXT_CHARS,
		NARROW_MEDIA_QUERY,
		PAYLOAD_DRAFT_KEY,
		PROVIDERS,
		RECENT_HISTORY_LIMIT,
		THEME_KEY
	} from '$lib/constants/chat-page';
	import { formatRetrievedContext, retrieveTopChunks, type RetrievedChunk } from '$lib/rag/retrieval';
	import type { RagDoc, RagPayload } from '$lib/rag/types';

	let provider: ProviderName = 'openai';
	let apiKey = '';
	let model = DEFAULT_MODELS.openai;
	let modelOptions: string[] = [];
	let isModelCatalogLoading = false;
	let modelCatalogError = '';
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
	let ragIndex = createRagIndexForPayload(payload);
	let activeRequestController: AbortController | null = null;
	let composerTextarea: HTMLTextAreaElement | null = null;

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
	let hasApiKey = false;
	let canSend = false;
	let hasConversation = false;
	let docCount = 0;
	let docChars = 0;
	let activeSessionTitle = 'New Conversation';

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
	let modelCatalogTimer: ReturnType<typeof setTimeout> | null = null;
	const modelCatalogCache: Record<ProviderName, { key: string; models: string[] } | null> = {
		openai: null,
		anthropic: null,
		gemini: null
	};

	$: ragIndex = createRagIndexForPayload(payload);
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
			document.body.style.overflow = settingsOpen || mobileLeftRailOpen || (isNarrowViewport && mobileContextOpen) ? 'hidden' : '';
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

	function chatStorageKey(forDigest: string): string {
		return `${CHAT_SESSIONS_KEY}:${forDigest}`;
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

	function focusComposer() {
		composerTextarea?.focus();
	}

	function openSettings(tab: SettingsTab = 'connection', presentation?: SettingsPresentation) {
		settingsTab = tab;
		settingsPresentation = presentation ?? getDefaultSettingsPresentation(isNarrowViewport, isCompactViewport);
		settingsOpen = true;
		mobileContextOpen = false;
		mobileLeftRailOpen = false;
		if (tab === 'connection') {
			void refreshModelCatalog();
		}
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

	function getCurrentApiKeyForModelLookup(providerName: ProviderName): string {
		const stored = persistApiKey ? window.localStorage.getItem(storageKeyForApi(providerName)) ?? '' : '';
		return (apiKey || stored || getDefaultApiKey(providerName)).trim();
	}

	function normalizeAndSelectModel(nextModel: string, options: string[], providerName: ProviderName) {
		const defaultModel = DEFAULT_MODELS[providerName];
		if (options.includes(nextModel)) {
			return nextModel;
		}
		if (defaultModel && options.includes(defaultModel)) {
			return defaultModel;
		}
		return options[0] || nextModel || defaultModel;
	}

	async function refreshModelCatalog() {
		if (typeof window === 'undefined') {
			return;
		}
		const key = getCurrentApiKeyForModelLookup(provider);
		if (!key) {
			modelOptions = [];
			model = model.trim() || DEFAULT_MODELS[provider];
			modelCatalogError = 'API key is required to load models.';
			return;
		}
		const cached = modelCatalogCache[provider];
		if (cached && cached.key === key) {
			modelOptions = cached.models;
			model = normalizeAndSelectModel(model, modelOptions, provider);
			saveProviderSettings();
			modelCatalogError = '';
			return;
		}

		isModelCatalogLoading = true;
		modelCatalogError = '';
		try {
			const models = await fetchModelCatalog(provider, key);
			modelCatalogCache[provider] = { key, models };
			modelOptions = models;
			model = normalizeAndSelectModel(model, modelOptions, provider);
			if (!model.trim()) {
				model = DEFAULT_MODELS[provider];
			}
			saveProviderSettings();
		} catch (error) {
			modelCatalogError = error instanceof Error ? error.message : 'Failed to fetch model list.';
		} finally {
			isModelCatalogLoading = false;
		}
	}

	function scheduleModelCatalogRefresh() {
		if (modelCatalogTimer) {
			clearTimeout(modelCatalogTimer);
		}
		modelCatalogTimer = setTimeout(() => {
			void refreshModelCatalog();
		}, 700);
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
		const storedApiKey = persistApiKey ? window.localStorage.getItem(storageKeyForApi(provider)) ?? '' : '';
		apiKey = storedApiKey.trim() || getDefaultApiKey(provider);
		void refreshModelCatalog();
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

	function renameSession(sessionId: string, nextTitle: string) {
		const index = chatSessions.findIndex((session) => session.id === sessionId);
		if (index < 0) {
			return;
		}
		const title = nextTitle.trim();
		if (!title) {
			status = 'Conversation title is empty. Keeping previous title.';
			return;
		}
		chatSessions[index] = {
			...chatSessions[index],
			title,
			updatedAt: Date.now()
		};
		chatSessions = [...chatSessions];
		saveChatSessions();
		status = 'Conversation renamed';
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
			const storedApiKey = persistApiKey ? window.localStorage.getItem(storageKeyForApi(provider)) ?? '' : '';
			apiKey = storedApiKey.trim() || getDefaultApiKey(provider);
		}
		saveProviderSettings();
		void refreshModelCatalog();
	}

	function handleApiKeyInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		apiKey = target.value;
		saveProviderSettings();
		scheduleModelCatalogRefresh();
	}

	function handleModelInput(event: Event) {
		const target = event.currentTarget as HTMLInputElement | HTMLSelectElement;
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

	function clearChat() {
		startNewSession();
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
				messages: toChatMessages(nextHistory, payload, context, RECENT_HISTORY_LIMIT),
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
			upsertActiveSessionMessages([
				...nextHistory,
				{
					id: nowId(),
					role: 'assistant',
					content: message,
					createdAt: Date.now(),
					isError: true
				}
			]);
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
		if (event.isComposing || event.key === 'Process' || event.keyCode === 229) {
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submitPrompt();
		}
	}

	function handlePromptInput(event: Event) {
		const target = event.currentTarget as HTMLTextAreaElement;
		prompt = target.value;
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
		if (isCompactViewport) {
			leftRailCollapsed = false;
		}
		if (!isNarrowViewport) {
			mobileContextOpen = false;
		}
		if (settingsOpen) {
			settingsPresentation = getDefaultSettingsPresentation(isNarrowViewport, isCompactViewport);
		}
	}

	function cancelGeneration() {
		if (activeRequestController) {
			activeRequestController.abort();
		}
	}

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

<div class="app-shell">
	{#if mobileLeftRailOpen}
		<button
			type="button"
			class="left-rail-backdrop"
			class:open
			on:click={closeMobileLeftRail}
			aria-label="Close side menu"
		></button>
	{/if}

	<LeftRail
		mobileOpen={mobileLeftRailOpen}
		payloadTitle={payload.title}
		docCount={docCount}
		docChars={docChars}
		providerLabel={PROVIDER_LABELS[provider]}
		model={model}
		chatSessions={chatSessions}
		activeSessionId={activeSessionId}
		urlRisk={urlRisk}
		urlLength={urlLength}
		encodedLength={encodedLength}
		theme={theme}
		formatMessageTime={formatMessageTime}
		onStartNewSession={startNewSessionFromRail}
		onCloseMobileRail={closeMobileLeftRail}
		onOpenSettings={openSettings}
		onToggleTheme={toggleTheme}
		onSetActiveSession={setActiveSession}
		onDeleteSession={deleteSession}
		onRenameSession={renameSession}
		onCopyShareUrl={copyShareUrl}
	/>

	<ChatColumn
		isNarrowViewport={isNarrowViewport}
		mobileLeftRailOpen={mobileLeftRailOpen}
		activeSessionTitle={activeSessionTitle}
		payloadTitle={payload.title}
		hasApiKey={hasApiKey}
		providerLabel={PROVIDER_LABELS[provider]}
		hasConversation={hasConversation}
		chatMessages={chatMessages}
		canSend={canSend}
		loading={loading}
		prompt={prompt}
		mobileContextOpen={mobileContextOpen}
		ragDocs={payload.docs}
		formatMessageTime={formatMessageTime}
		onToggleLeftRail={toggleMobileLeftRail}
		onClearChat={clearChat}
		onToggleContext={toggleMobileContext}
		onOpenSettings={openSettings}
		onSubmit={sendMessage}
		onPromptInput={handlePromptInput}
		onPromptKeydown={handlePromptKeydown}
		onStopGeneration={cancelGeneration}
		bindComposerTextarea={composerTextarea}
	/>

	<ContextColumn
		isNarrowViewport={isNarrowViewport}
		mobileContextOpen={mobileContextOpen}
		retrievedChunks={retrievedChunks}
		showRetrievedContext={showRetrievedContext}
		providerLabel={PROVIDER_LABELS[provider]}
		model={model}
		hasApiKey={hasApiKey}
		payloadError={payloadError}
		status={status}
		onClose={() => (mobileContextOpen = false)}
		onToggleRetrievedContext={() => {
			showRetrievedContext = !showRetrievedContext;
		}}
		onOpenSettings={openSettings}
	/>
</div>

<SettingsPanel
	settingsOpen={settingsOpen}
	settingsPresentation={settingsPresentation}
	settingsTab={settingsTab}
	providers={PROVIDERS}
	provider={provider}
	theme={theme}
	model={model}
	modelOptions={modelOptions}
	isModelCatalogLoading={isModelCatalogLoading}
	modelCatalogError={modelCatalogError}
	apiKey={apiKey}
	persistApiKey={persistApiKey}
	payloadError={payloadError}
	status={status}
	bind:titleInput
	bind:systemPromptInput
	bind:topKInput
	bind:chunkSizeInput
	bind:overlapInput
	bind:newDocTitle
	bind:newDocContent
	bind:importUrl
	bind:payloadJson
	docCount={docCount}
	docChars={docChars}
	docs={payload.docs}
	onClose={closeSettings}
	onSetTheme={setTheme}
	onSelectTab={openSettings}
	onProviderChange={handleProviderChange}
	onApiKeyInput={handleApiKeyInput}
	onApiKeySaveToggle={handleApiKeySaveToggle}
	onModelInput={handleModelInput}
	onRefreshModels={() => {
		void refreshModelCatalog();
	}}
	onApplyBuilderSettings={applyBuilderSettings}
	onAddDocument={addDocument}
	onRemoveDocument={removeDocument}
	onFileInput={handleFileInput}
	onApplyImportUrl={applyImportUrl}
	onApplyPayloadJson={applyPayloadJson}
	onResetPayload={resetPayload}
/>
