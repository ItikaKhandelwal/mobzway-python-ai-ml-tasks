# AskNova — AI-Powered Q&A Chatbot

A complete Level 1 full-stack assignment built with **Node.js + vanilla HTML/CSS/JavaScript + OpenAI API**. The chatbot securely calls OpenAI from a Vercel Function, streams the answer to the browser, remembers conversation history in local storage, and includes practical error handling.

## Features

- Secure server-side OpenAI authentication
- Role-based system, user, and assistant messages
- Streaming answers displayed as they are generated
- Multi-turn conversation history in local storage
- Responsive, accessible light/dark interface
- Editable system prompt
- Clear, copy, stop, export, and prompt-suggestion controls
- Character limits and backend request validation
- API health indicator and missing-key warning
- Basic per-instance rate limiting
- Offline and provider-error handling
- Security headers and no exposed browser API key
- Dependency-free frontend/backend plus validation tests

## Project structure

```text
ai-qna-chatbot/
├── api/
│   ├── chat.js
│   └── health.js
├── lib/
│   ├── errors.js
│   ├── openai-service.js
│   ├── sse.js
│   └── validation.js
├── tests/
│   └── validation.test.js
├── index.html
├── styles.css
├── app.js
├── vercel.json
├── .env.example
├── package.json
└── README.md
```

## Assignment task mapping

| Assignment task | Implementation |
|---|---|
| Task 1 — Project Setup | `package.json`, folders, environment example, Vercel config |
| Task 2 — OpenAI/Claude Service Layer | `lib/openai-service.js` securely calls OpenAI |
| Task 3 — Chat API Routes | `api/chat.js` and `api/health.js` |
| Task 4 — Frontend UI | `index.html` and `styles.css` |
| Task 5 — Frontend JavaScript Logic | `app.js` sends history and renders streamed tokens |
| Task 6 — Error Handling & Edge Cases | Validation, status mapping, offline state, abort, empty stream, rate limit |
| Task 7 — Bonus Features | Theme, history, settings, copy, export, stop, prompt suggestions |

## Local setup

### Requirements

- Node.js 20 or later
- An OpenAI API key
- Vercel CLI for local Functions

### 1. Configure environment variables

```bash
cp .env.example .env.local
```

Update `.env.local`:

```env
OPENAI_API_KEY=sk-your-real-key
OPENAI_MODEL=gpt-4o-mini
```

Never place the key in `app.js`, `index.html`, or another browser-side file.

### 2. Start locally

```bash
npx vercel dev
```

Open the local URL shown by Vercel, normally `http://localhost:3000`.

### 3. Run tests

```bash
npm test
```

## Deploy on Vercel

### Dashboard method

1. Upload this folder to a GitHub repository.
2. In Vercel, select **Add New → Project** and import the repository.
3. Keep the Framework Preset as **Other**.
4. Add Environment Variables for Production, Preview, and Development:
   - `OPENAI_API_KEY` — your real OpenAI secret key
   - `OPENAI_MODEL` — `gpt-4o-mini`
   - `DEFAULT_SYSTEM_PROMPT` — optional
5. Click **Deploy**.
6. After changing an Environment Variable, redeploy the project.
7. Open the generated `.vercel.app` URL and confirm the status says `gpt-4o-mini ready`.

### CLI method

```bash
npx vercel
```

Add the secret in **Vercel → Project Settings → Environment Variables**, then deploy production:

```bash
npx vercel --prod
```

## Verification checklist

- The live URL loads on desktop and mobile.
- The status changes to `gpt-4o-mini ready`.
- A question produces text progressively.
- A follow-up uses earlier conversation context.
- Refreshing preserves conversation history.
- Stop, copy, clear, theme, settings, and export work.
- Empty input cannot be sent.
- The OpenAI key is absent from browser source and request payloads.
- `.env.local` is not committed.

## Mentor submission template

```text
Subject: Level 1 Project Submission — AI-Powered Q&A Chatbot

Hello,

I have completed the Level 1 AI-Powered Q&A Chatbot assignment.

Live project: <PASTE_YOUR_VERCEL_LINK>
Source code: <PASTE_YOUR_GITHUB_LINK>

Implemented features include secure OpenAI API integration, streamed responses, multi-turn conversation history, system/user/assistant message handling, responsive UI, local history, validation, error handling, stop/copy/clear/export controls, and light/dark themes.

Regards,
<YOUR NAME>
```

## Technical notes

- The browser sends role/content history and the selected system prompt to `/api/chat`.
- The API validates and limits the payload before calling OpenAI.
- The service parses OpenAI Server-Sent Events and returns newline-delimited JSON to the frontend.
- Local storage is used instead of a database for this Level 1 version.
- The in-memory rate limiter is lightweight, not a distributed production rate limiter.
