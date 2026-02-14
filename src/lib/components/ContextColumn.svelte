<script lang="ts">
	import { X } from 'lucide-svelte';
	import type { RetrievedChunk } from '$lib/rag/retrieval';
	import type { SettingsTab } from '$lib/types/ui';

	export let isNarrowViewport: boolean;
	export let mobileContextOpen: boolean;
	export let retrievedChunks: RetrievedChunk[] = [];
	export let showRetrievedContext: boolean;
	export let providerLabel: string;
	export let model: string;
	export let hasApiKey: boolean;
	export let payloadError: string;
	export let status: string;

	export let onClose: () => void;
	export let onToggleRetrievedContext: () => void;
	export let onOpenSettings: (tab: SettingsTab) => void;
</script>

{#if isNarrowViewport && mobileContextOpen}
	<button type="button" class="context-sheet-backdrop" on:click={onClose} aria-label="Close context"></button>
{/if}

<aside class="context-column" class:mobile-open={mobileContextOpen && isNarrowViewport}>
	{#if isNarrowViewport}
		<div class="mobile-context-head">
			<h3>Session Context</h3>
			<button type="button" class="icon-btn" on:click={onClose} aria-label="Close context sheet">
				<X size={16} />
			</button>
		</div>
	{/if}
	<section class="context-card">
		<h3>Session</h3>
		<p>Provider: <strong>{providerLabel}</strong></p>
		<p>Model: <strong>{model}</strong></p>
		<p>API Key: <strong>{hasApiKey ? 'Loaded' : 'Missing'}</strong></p>
		<div class="rail-inline-actions">
			<button type="button" class="ghost" on:click={() => onOpenSettings('connection')}>Manage</button>
		</div>
	</section>

	<section class="context-card">
		<div class="card-head">
			<h3>Retrieved Context</h3>
			{#if retrievedChunks.length > 0}
				<button type="button" class="ghost mini-btn" on:click={onToggleRetrievedContext}>
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
