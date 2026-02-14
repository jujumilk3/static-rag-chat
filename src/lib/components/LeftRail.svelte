<script lang="ts">
	import { Check, Pencil, PanelLeftClose, Plus, Settings as SettingsIcon, Sun, Moon, Trash2, X } from 'lucide-svelte';
	import type { ChatSession, SettingsTab } from '$lib/types/ui';

	export let mobileOpen: boolean;
	export let payloadTitle: string;
	export let docCount: number;
	export let docChars: number;
	export let providerLabel: string;
	export let model: string;
	export let chatSessions: ChatSession[] = [];
	export let activeSessionId: string;
	export let urlRisk: 'ok' | 'warn' | 'danger' = 'ok';
	export let urlLength: number;
	export let encodedLength: number;
	export let theme: 'light' | 'dark';
	export let formatMessageTime: (value: number) => string;

	export let onStartNewSession: () => void;
	export let onCloseMobileRail: () => void;
	export let onOpenSettings: (tab: SettingsTab) => void;
	export let onToggleTheme: () => void;
	export let onSetActiveSession: (sessionId: string) => void;
	export let onDeleteSession: (event: MouseEvent, sessionId: string) => void;
	export let onRenameSession: (sessionId: string, nextTitle: string) => void;
	export let onCopyShareUrl: () => void;
	let renamingSessionId = '';
	let renamingTitle = '';

	function handleRailToggle() {
		onCloseMobileRail();
	}

	function startRename(event: MouseEvent, sessionId: string, title: string) {
		event.preventDefault();
		event.stopPropagation();
		renamingSessionId = sessionId;
		renamingTitle = title;
	}

	function cancelRename(event?: Event) {
		if (event) {
			event.preventDefault();
			event.stopPropagation();
		}
		renamingSessionId = '';
		renamingTitle = '';
	}

	function saveRename(event: Event, sessionId: string) {
		event.preventDefault();
		event.stopPropagation();
		if (renamingSessionId !== sessionId) {
			return;
		}
		const nextTitle = renamingTitle.trim();
		if (!nextTitle) {
			cancelRename();
			return;
		}
		onRenameSession(sessionId, nextTitle);
		renamingSessionId = '';
		renamingTitle = '';
	}

	function handleRenameKeydown(
		event: KeyboardEvent,
		sessionId: string
	) {
		if (event.key === 'Enter') {
			event.preventDefault();
			saveRename(event, sessionId);
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelRename();
		}
	}
</script>

<aside class="left-rail" class:mobile-open={mobileOpen}>
	<button type="button" class="icon-btn rail-toggle" on:click={handleRailToggle} aria-label="Close side menu">
		<PanelLeftClose size={18} />
	</button>
	<div class="rail-content">
		<div class="brand">
			<p class="kicker">Static Rag Chat</p>
			<h1 class="rail-label">Static Rag Chat</h1>
			<p class="rail-note">
				Share one URL + your own API key so anyone can run the same Static Rag Chat session.
			</p>
		</div>

		<div class="rail-actions">
			<button type="button" on:click={onStartNewSession}>
				<span class="rail-icon" aria-hidden="true"><Plus size={16} /></span>
				<span class="rail-label">New Chat</span>
			</button>
			<button type="button" class="ghost" on:click={() => onOpenSettings('connection')}>
				<span class="rail-icon" aria-hidden="true"><SettingsIcon size={16} /></span>
				<span class="rail-label">Settings</span>
			</button>
			<button type="button" class="ghost" on:click={onToggleTheme}>
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
			<h2>{payloadTitle}</h2>
			<p>{docCount} docs · {docChars.toLocaleString()} chars</p>
			<div class="chip-row">
				<span>{providerLabel}</span>
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
						<div class="session-item {activeSessionId === session.id ? 'active' : ''}">
							{#if renamingSessionId === session.id}
								<div class="session-edit">
									<input
										type="text"
										class="session-title-input"
										bind:value={renamingTitle}
										on:focus={(event) => (event.currentTarget as HTMLInputElement).select()}
										on:keydown={(event) => handleRenameKeydown(event, session.id)}
										on:focusout={(event) => saveRename(event, session.id)}
									/>
									<button
										type="button"
										class="icon-btn mini-btn session-rename-confirm"
										on:click={(event) => saveRename(event, session.id)}
										aria-label="Save title"
									>
										<Check size={13} />
									</button>
									<button
										type="button"
										class="icon-btn mini-btn"
										on:click={cancelRename}
										aria-label="Cancel rename"
									>
										<X size={13} />
									</button>
								</div>
							{:else}
								<button
									type="button"
									class="session-btn"
									on:click={() => onSetActiveSession(session.id)}
								>
									<span class="session-title">{session.title}</span>
									<span class="session-meta">
										{session.messages.length} msgs · {formatMessageTime(session.updatedAt)}
									</span>
								</button>
								<div class="session-actions">
									<button
										type="button"
										class="icon-btn mini-btn"
										on:click={(event) => startRename(event, session.id, session.title)}
										aria-label="Rename chat"
									>
										<Pencil size={13} />
									</button>
									<button
										type="button"
										class="icon-btn mini-btn session-delete danger"
										on:click={(event) => onDeleteSession(event, session.id)}
										aria-label="Delete chat"
									>
										<Trash2 size={14} />
									</button>
								</div>
							{/if}
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
				<button type="button" class="ghost" on:click={onCopyShareUrl}>Copy URL</button>
				<button type="button" class="ghost" on:click={() => onOpenSettings('data')}>RAG</button>
			</div>
			<p class="rail-meta">URL length {urlLength.toLocaleString()} / payload {encodedLength.toLocaleString()}</p>
		</section>

	</div>
</aside>
