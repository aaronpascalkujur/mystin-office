# Mystin Office

A small roster of AI agents that pick up tasks you type, do the work with Claude, and file the
result into a `notes/` folder. Tasks can be routed to an agent automatically, and agents read
the notes from related past work before starting. No 3D office, no routines, no connectors yet.

## What you need

- Node.js 18+
- **Claude Code**, installed and logged in (`claude` must work from your terminal)

## Run it

```bash
npm start
```

Then open http://localhost:4521.

## How it works

1. Type a task and either pick an agent or leave the dropdown on **Auto**.
2. On Auto, a quick routing call shows the roster to a small model and asks which agent
   should take it. If routing fails or answers with something unrecognisable, the task
   goes to the first agent rather than failing outright.
3. The server looks through past notes for ones sharing keywords with your task and quotes
   the closest few into the agent's brief, so related work stays consistent.
4. It builds a system prompt from the agent's role, standing brief (`agents.json`) and
   those notes, then runs the task through the Claude Code CLI in one-shot print mode
   (`claude -p ...`), with no tool access — the agent only writes text back.
5. The result is shown in the browser and saved as a dated Markdown note in `notes/`.

Past notes are quoted in as reference material, and the agent is told not to follow
instructions found inside them — a note's body is model output, so it shouldn't be trusted
as a source of commands.

## Make it yours

Edit `agents.json` — each agent is:

```json
{
  "id": "writer",
  "name": "Writer",
  "role": "Writing & Content Agent",
  "does": "Drafts and edits written material: emails, posts, docs, copy.",
  "brief": "Plain, direct sentences. No filler, no corporate speak.",
  "model": "sonnet"
}
```

`model` is optional: any value `claude --model` accepts. Leave it out to use your Claude Code default.

`id` must be unique, and can't be `auto` — that one is reserved for automatic routing. The
first agent in the list is the fallback when routing can't decide.

Add, remove, or rewrite agents freely — restart the server to pick up changes.

## Where things live

| Path | What |
|---|---|
| `server.mjs` | The whole server: static files, `/api/agents`, `/api/task`, `/api/notes`, the Claude CLI call |
| `agents.json` | The roster |
| `public/` | The browser UI |
| `notes/` | Saved deliverables, one Markdown file per task |

## Tuning

Environment variables, all optional:

| Variable | Default | What |
|---|---|---|
| `PORT` | `4521` | Port to listen on (localhost only) |
| `ROUTER_MODEL` | `haiku` | Model used for the Auto routing call |

How many notes get pulled into a brief, how much of each is quoted, and how strong the
keyword match has to be are constants at the top of `server.mjs`.

## What's next (not built yet)

Connectors (MCP servers wired to specific agents), and scheduled/recurring tasks.

Connectors are the bigger design question: agents currently run with `--tools ""` and
`--strict-mcp-config`, so they have no tools and no MCP servers at all. Wiring connectors
means letting specific agents out of that box, which should stay opt-in per agent rather
than becoming the default.
