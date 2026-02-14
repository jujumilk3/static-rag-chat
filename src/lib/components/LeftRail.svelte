<script lang="ts">
	import { PanelLeftClose, Plus, Settings as SettingsIcon, Sun, Moon, Trash2 } from 'lucide-svelte';
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
	export let onCopyShareUrl: () => void;

	function handleRailToggle() {
		onCloseMobileRail();
	}
</script>

<aside class="left-rail" class:mobile-open={mobileOpen}>
	<button type="button" class="icon-btn rail-toggle" on:click={handleRailToggle} aria-label="Close side menu">
		<PanelLeftClose size={18} />
	</button>
	<div class="rail-content">
		<div class="brand">
			<p class="kicker">Static URL RAG</p>
			<h1 class="rail-label">RAG Chat Studio</h1>
			<p class="rail-note">Share the same URL context + API key so anyone can run identical RAG chat sessions.</p>
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
						<button
							type="button"
							class="icon-btn mini-btn session-delete danger"
							on:click={(event) => onDeleteSession(event, session.id)}
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
				<button type="button" class="ghost" on:click={onCopyShareUrl}>Copy URL</button>
				<button type="button" class="ghost" on:click={() => onOpenSettings('data')}>Data</button>
			</div>
			<p class="rail-meta">URL length {urlLength.toLocaleString()} / payload {encodedLength.toLocaleString()}</p>
		</section>

		<section class="rail-card">
			<h3>Quick Jump</h3>
			<div class="rail-inline-actions">
				<button type="button" class="ghost" on:click={() => onOpenSettings('rag')}>RAG Setup</button>
				<button type="button" class="ghost" on:click={() => onOpenSettings('connection')}>Provider</button>
			</div>
		</section>
	</div>
</aside>
