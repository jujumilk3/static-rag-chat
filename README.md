# Static Rag Chat

SvelteKit-based, fully static RAG chat app for GitHub Pages.

Users open one shared URL, paste their own API key (OpenAI / Claude / Gemini), and chat with the same RAG context encoded in the URL hash.

## Features

- 100% static frontend (no backend server)
- URL-packed payload (`#r=...`) with compressed JSON
- Browser-side retrieval with chunking + BM25-style ranking
- Multi-provider direct API calls:
  - OpenAI Chat Completions API
  - Anthropic Messages API
  - Gemini GenerateContent API
- Builder UX for:
  - title/system prompt/retrieval controls
  - adding/removing documents
  - importing files (`.txt`, `.md`, `.json`)
  - importing payload from shared URL/hash
- Advanced JSON editor for full payload control
- URL length risk indicator
- API keys and payload draft saved only in local browser storage

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

To avoid entering keys each time, set provider keys in `.env.local`:

```bash
VITE_OPENAI_API_KEY=
VITE_ANTHROPIC_API_KEY=
VITE_GEMINI_API_KEY=
```

The app loads these values at startup while still keeping your typed keys in `localStorage` when you opt in to saving.

## Build (GitHub Pages)

Project pages (for example `https://<user>.github.io/<repo>/`) require a base path:

```bash
BASE_PATH=/static-rag-chat npm run build
```

The static site is generated at `build/`.

## GitHub Actions Deploy

This repository already includes a workflow: `.github/workflows/deploy.yml`.

Deployment behavior:

- Trigger: push to `main` or manual run
- Build env: `BASE_PATH=/${{ github.event.repository.name }}`
- Output: uploads `build/` to GitHub Pages

To use it:

1. Push this repo to GitHub.
2. In repository settings, open **Pages**.
3. Set source to **GitHub Actions**.
4. Push to `main`.

## Payload Format

You can edit/import payloads with this shape:

```json
{
  "v": 1,
  "title": "Static Rag Chat",
  "systemPrompt": "Answer using provided context first.",
  "docs": [
    {
      "id": "doc-1",
      "title": "Guide",
      "content": "Your long text here"
    }
  ],
  "retrieval": {
    "topK": 4,
    "chunkSize": 800,
    "overlap": 120
  }
}
```

When applied, the payload is compressed and written to URL hash (`#r=...`) so it can be shared as a single link.

## Usage Notes

- URL length limits still apply. Very large corpora are not suitable for hash-based sharing.
- Some providers may block direct browser calls depending on CORS policy changes.
- Browser-stored API keys should be low-scope and replaceable.
- If a shared URL is too long, use **Download JSON** and import it locally.

## Scripts

- `npm run dev`: local dev server
- `npm run check`: type + Svelte checks
- `npm run build`: production static build
- `npm run preview`: preview built app
