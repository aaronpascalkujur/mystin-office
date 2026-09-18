# Mystin Office

A small roster of AI agents that pick up tasks you type, do the work with Claude, and file the
result into a `notes/` folder. This is the minimal core loop: no 3D office, no routines, no
connectors yet — just task in, agent picks it up, deliverable out and saved.

## What you need

- Node.js 18+
- **Claude Code**, installed and logged in (`claude` must work from your terminal)

## Run it

```bash
npm start
```

Then open http://localhost:4521.

## How it works

1. Pick an agent from the dropdown and type a task.
2. The server builds a system prompt from that agent's role and standing brief
   (`agents.json`), and runs your task through the Claude Code CLI in one-shot
   print mode (`claude -p ...`), with no tool access — the agent only writes text back.
3. The result is shown in the browser and saved as a dated Markdown note in `notes/`.

## Make it yours

Edit `agents.json` — each agent is:

```json
{
  "id": "writer",
  "name": "Writer",
  "role": "Writing & Content Agent",
  "does": "Drafts and edits written material: emails, posts, docs, copy.",
  "brief": "Plain, direct sentences. No filler, no corporate speak."
}
```

Add, remove, or rewrite agents freely — restart the server to pick up changes.

## Where things live

| Path | What |
|---|---|
| `server.mjs` | The whole server: static files, `/api/agents`, `/api/task`, `/api/notes`, the Claude CLI call |
| `agents.json` | The roster |
| `public/` | The browser UI |
| `notes/` | Saved deliverables, one Markdown file per task |

## What's next (not built yet)

Ideas for a v2, roughly in order of value: a notes-aware brief (feed the agent relevant past
notes instead of nothing), simple routing (let a task be assigned automatically instead of
picked from a dropdown), connectors (MCP servers wired to specific agents), and scheduled/
recurring tasks.
