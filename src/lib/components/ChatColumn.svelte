<script lang="ts">
	import { PanelLeftClose, Menu, Send } from 'lucide-svelte';
	import type { UIMessage, SettingsTab } from '$lib/types/ui';
	import type { RagDoc } from '$lib/rag/types';

	export let mobileLeftRailOpen: boolean;
	export let activeSessionTitle: string;
	export let payloadTitle: string;
	export let hasApiKey: boolean;
	export let providerLabel: string;
	export let hasConversation: boolean;
	export let chatMessages: UIMessage[] = [];
	export let canSend = false;
	export let loading = false;
	export let prompt = '';
	export let mobileContextOpen = false;
	export let ragDocs: RagDoc[] = [];

	export let formatMessageTime: (value: number) => string;

	export let onToggleLeftRail: () => void;
	export let onClearChat: () => void;
	export let onToggleContext: () => void;
	export let onOpenSettings: (tab: SettingsTab) => void;
	export let onSubmit: (event: SubmitEvent) => void;
	export let onPromptInput: (event: Event) => void;
	export let onPromptKeydown: (event: KeyboardEvent) => void;
	export let onStopGeneration: () => void;
	export let bindComposerTextarea: HTMLTextAreaElement | null;
</script>

<section class="chat-column">
	<header class="chat-header">
		<button
			type="button"
			class="icon-btn mobile-menu-btn"
			on:click={onToggleLeftRail}
			aria-label="Toggle side menu"
		>
			{#if mobileLeftRailOpen}
				<PanelLeftClose size={18} />
			{:else}
				<Menu size={18} />
			{/if}
		</button>

		<div class="chat-title">
			<p class="kicker">Conversation</p>
			<h2>{activeSessionTitle}</h2>
			<p class="chat-subtitle">
				{payloadTitle} · {hasApiKey ? 'API key loaded' : 'API key required'} · {hasConversation ? `${chatMessages.length} messages` : 'empty conversation'}
			</p>
		</div>
		<div class="chat-toolbar">
			<span class="chat-pill {hasApiKey ? 'chat-pill-ok' : 'chat-pill-warn'}">
				{hasApiKey ? 'API Connected' : 'API Missing'}
			</span>
			<span class="chat-pill">{providerLabel}</span>
			<button type="button" class="chat-pill ghost mobile-pill-btn mobile-toolbar-btn" on:click={onClearChat}>New</button>
			<button type="button" class="chat-pill ghost mobile-pill-btn mobile-toolbar-btn" on:click={onToggleContext}>
				{mobileContextOpen ? 'Close Context' : 'Context'}
			</button>
		</div>
	</header>

	{#if !hasApiKey}
		<div class="notice warning">
			<span>You must enter an API key before sending messages.</span>
			<button type="button" on:click={() => onOpenSettings('connection')}>Open Settings</button>
		</div>
	{/if}

		<div class="message-stream" aria-live="polite">
		{#if !hasConversation}
			<section class="empty-state">
				<h3>Loaded documents in Static Rag Chat</h3>
				<p>These documents are embedded in the current payload and available for retrieval in this session.</p>
				<div class="starter-grid">
					{#if ragDocs.length > 0}
						{#each ragDocs as doc, index}
							<article class="starter-card">
								<span>{index + 1}. {doc.title}</span>
								<small>{doc.content.slice(0, 240)}{doc.content.length > 240 ? '…' : ''}</small>
							</article>
						{/each}
					{:else}
						<p>There are currently no documents in this Static Rag Chat payload.</p>
					{/if}
				</div>
			</section>
		{/if}

		{#each chatMessages as message}
			<article class="message-row {message.role} {message.isError ? 'message-error' : ''}">
				<div class="message-avatar">{message.role === 'user' ? 'ME' : 'AI'}</div>
				<div class="message-bubble">
					<div class="message-meta">
						<strong>{message.role === 'user' ? 'You' : (message.isError ? 'System Error' : 'Assistant')}</strong>
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

	<form class="composer" on:submit={onSubmit}>
		<textarea
			bind:this={bindComposerTextarea}
			value={prompt}
			on:input={onPromptInput}
			on:compositionend={onPromptInput}
			rows="3"
			placeholder="Ask about this shared Static Rag Chat context... (Enter send / Shift+Enter newline)"
			on:keydown={onPromptKeydown}
		></textarea>
		<div class="composer-foot">
			<p>Context-aware responses combine multi-turn history with retrieved chunks.</p>
			<div class="composer-actions">
				{#if loading}
					<button type="button" class="danger" on:click={onStopGeneration}>Stop</button>
				{/if}
				<button type="submit" class="send-btn" disabled={!canSend}>
					<span>{loading ? 'Sending...' : 'Send Message'}</span>
					<Send size={16} />
				</button>
			</div>
		</div>
	</form>
</section>
