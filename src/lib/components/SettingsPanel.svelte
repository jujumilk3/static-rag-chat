<script lang="ts">
	import { Copy, Download, X } from 'lucide-svelte';
	import { PROVIDER_LABELS, type ProviderName } from '$lib/chat/providers';
	import type { RagDoc } from '$lib/rag/types';
	import type { SettingsTab, ThemeMode } from '$lib/types/ui';

	export let settingsOpen = false;
	export let settingsPresentation: 'drawer' | 'modal' = 'modal';
	export let settingsTab: SettingsTab = 'connection';
	export let providers: ProviderName[] = [];
	export let provider: ProviderName = 'openai';
	export let theme: ThemeMode = 'light';
	export let model = '';
	export let apiKey = '';
	export let persistApiKey = false;
	export let shareUrl = '';
	export let encodedLength = 0;
	export let urlLength = 0;
	export let urlRisk: 'ok' | 'warn' | 'danger' = 'ok';
	export let payloadError = '';
	export let status = '';
	export let titleInput = '';
	export let systemPromptInput = '';
	export let topKInput = 1;
	export let chunkSizeInput = 500;
	export let overlapInput = 100;
	export let newDocTitle = '';
	export let newDocContent = '';
	export let importUrl = '';
	export let payloadJson = '';
	export let docCount = 0;
	export let docChars = 0;
	export let docs: RagDoc[] = [];

	export let onClose: () => void;
	export let onSetTheme: (next: ThemeMode) => void;
	export let onSelectTab: (tab: SettingsTab) => void;
	export let onProviderChange: (event: Event) => void;
	export let onApiKeyInput: (event: Event) => void;
	export let onApiKeySaveToggle: (event: Event) => void;
	export let onModelInput: (event: Event) => void;
	export let onApplyBuilderSettings: () => void;
	export let onCopyShareUrl: () => void | Promise<void>;
	export let onDownloadPayload: () => void;
	export let onAddDocument: () => void;
	export let onRemoveDocument: (docId: string) => void;
	export let onFileInput: (event: Event) => void;
	export let onApplyImportUrl: () => void;
	export let onApplyPayloadJson: () => void;
	export let onResetPayload: () => void;

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}
</script>

<div
	class="settings-drawer-backdrop"
	class:open={settingsOpen}
	class:modal={settingsPresentation === 'modal'}
	role="presentation"
	on:click={handleBackdropClick}
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
			<button type="button" class="icon-btn" on:click={onClose} aria-label="Close settings">
				<X size={18} />
			</button>
		</header>

		<nav class="tab-row" aria-label="settings tabs">
			<button
				type="button"
				class:selected={settingsTab === 'connection'}
				on:click={() => onSelectTab('connection')}
			>
				Connection
			</button>
			<button type="button" class:selected={settingsTab === 'rag'} on:click={() => onSelectTab('rag')}>
				RAG
			</button>
			<button type="button" class:selected={settingsTab === 'data'} on:click={() => onSelectTab('data')}>
				Data
			</button>
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
								on:click={() => onSetTheme('light')}
							>
								Light
							</button>
							<button
								type="button"
								class="ghost theme-option"
								class:selected-theme={theme === 'dark'}
								on:click={() => onSetTheme('dark')}
							>
								Dark
							</button>
						</div>
					</div>
					<label>
						Provider
						<select value={provider} on:change={onProviderChange}>
							{#each providers as providerOption}
								<option value={providerOption}>{PROVIDER_LABELS[providerOption]}</option>
							{/each}
						</select>
					</label>
					<label>
						API key (saved in localStorage)
						<input
							type="password"
							value={apiKey}
							on:input={onApiKeyInput}
							placeholder="Paste your API key"
						/>
					</label>
					<label class="toggle-field">
						<span>
							<input
								type="checkbox"
								checked={persistApiKey}
								on:change={onApiKeySaveToggle}
								aria-label="Save API key in this browser"
							/>
							Save API key in localStorage
						</span>
						<small class="caution">
							Notice: localStorage is stored only in this browser. Disable saving on shared computers and delete
							it after use.
						</small>
					</label>
					<label>
						Model
						<input type="text" value={model} on:input={onModelInput} />
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
						<button type="button" on:click={onApplyBuilderSettings}>Apply Settings</button>
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
						<button type="button" class="with-icon" on:click={onCopyShareUrl}>
							<Copy size={14} />
							<span>Copy URL</span>
						</button>
						<button type="button" class="with-icon ghost" on:click={onDownloadPayload}>
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
						{#each docs as doc, index}
							<article>
								<div class="doc-head">
									<strong>{index + 1}. {doc.title}</strong>
									<button type="button" class="danger" on:click={() => onRemoveDocument(doc.id)}>Remove</button>
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
						<button type="button" on:click={onAddDocument}>Add Document</button>
					</div>

					<label>
						Import files (.txt, .md, .json)
						<input type="file" multiple accept=".txt,.md,.json" on:change={onFileInput} />
					</label>
					<label>
						Import from shared URL/hash
						<input type="text" bind:value={importUrl} placeholder="https://.../#r=... or #r=..." />
					</label>
					<div class="actions">
						<button type="button" class="ghost" on:click={onApplyImportUrl}>Import URL Payload</button>
					</div>
				</div>

				<div class="panel-block">
					<h3>Advanced JSON</h3>
					<textarea bind:value={payloadJson} rows="12" spellcheck="false"></textarea>
					<div class="actions">
						<button type="button" on:click={onApplyPayloadJson}>Apply JSON</button>
						<button type="button" class="ghost" on:click={onResetPayload}>Reset Sample</button>
					</div>
				</div>
			{/if}

	{#if payloadError}
		<p class="error">{payloadError}</p>
	{:else if status}
				<p class="status status-inline">{status}</p>
	{/if}
</div>
	</div>
</div>
