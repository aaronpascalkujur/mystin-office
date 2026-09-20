# Mystin Office

A small roster of AI agents that pick up tasks you type, do the work with Claude, and file the
result into a `notes/` folder. Tasks can be routed to an agent automatically, agents read the
notes from related past work before starting, and individual agents can be given connectors.
No 3D office and no routines yet.

## What you need

- Node.js 18+
- **Claude Code**, installed and logged in (`claude` must work from your terminal)

## Run it

```bash
npm install
npm start
```

Then open http://localhost:4521.

The one dependency is the MCP SDK, which `connectors/fetch.mjs` is built on. Skip the install
and the server still starts and ordinary agents still work — nothing in `server.mjs` imports
it — but the fetch connector can't launch, so Researcher loses the web. `npm test` fails for
the same reason.

## How it works

1. Type a task and either pick an agent or leave the dropdown on **Auto**.
2. On Auto, a quick routing call shows the roster to a small model and asks which agent
   should take it. If routing fails or answers with something unrecognisable, the task
   goes to the first agent rather than failing outright.
3. The server looks through past notes for ones sharing keywords with your task and quotes
   the closest few into the agent's brief, so related work stays consistent.
4. It builds a system prompt from the agent's role, standing brief (`agents.json` or
   `prebuilt/`), your personal layer if you have one, and those notes, then runs the task
   through the Claude Code CLI in one-shot print mode (`claude -p ...`), with no tool
   access — the agent only writes text back.
5. The result is shown in the browser and saved as a dated Markdown note in `notes/`.

Past notes are quoted in as reference material, and the agent is told not to follow
instructions found inside them — a note's body is model output, so it shouldn't be trusted
as a source of commands.

## Saying something back

A first draft is rarely the one you send, so under each result there's a reply box. Say
*make it shorter* and the same agent picks up where it left off rather than starting cold.

The CLI is still one-shot — `claude -p`, nothing resumed, no session left on disk. The
conversation lives in the server's memory, and each turn the server composes the transcript
into the message it sends. That's the whole mechanism, and it buys three things:

- **The brief is composed once.** Routing, your personal layer and the past-notes lookup all
  happen on turn 1. Later turns reuse that same system prompt instead of re-running a
  retrieval against a reply like "shorter".
- **Tool output never enters the transcript.** The server only ever sees an agent's final
  text, so a page a connector fetched can't be replayed into the next turn. An injection is
  bounded to the one CLI run that fetched it.
- **The thread can't be forged.** The browser holds an id, not the history. A client can't
  invent something the agent supposedly said.

A conversation is **one note**, not one per turn. The latest reply is the `## Result` —
that's the deliverable — and the turns before it are kept underneath as `## Thread`, so the
note records how the result was arrived at. Rating the note rates the conversation, and a new
turn clears a verdict you filed earlier, since it was a judgement on text that's now been
replaced. A correction you typed is never cleared.

Two limits worth knowing:

- Threads are in memory. Restart the server and open conversations are gone — the notes stay,
  but you start a new task rather than adding to an old one. Replying to a thread the server
  has forgotten fails with that message rather than quietly starting over as a fresh task.
- Each turn resends the conversation, so a long one is trimmed to roughly 8,000 characters:
  the opening exchange is kept as the anchor, the most recent turns as the live thread, and
  the middle is dropped with a line saying so. The *note* still holds everything — trimming
  is about what the agent is sent, not what gets written down.

**Researcher doesn't get a reply box.** A networked agent stays one-shot, for the same reason
it gets no personal layer and no past notes: a thread is a context window that grows, and
that's exactly what shouldn't sit next to a tool that can open sockets.

## Telling it what was any good

Until you say otherwise, the office treats every past note as equally worth copying — a bad
draft gets quoted into the next brief as eagerly as a good one. So under each result there
are three buttons: **used it as-is**, **fixed it up**, **threw it away**. The verdict is
written into the note's own frontmatter, and you can rate older work from the notes list too.

What it changes:

- A **discarded** note is never quoted again. Dropped outright rather than ranked lower —
  and deliberately not shown to an agent as a labelled bad example either, since a model
  drifts toward whatever text is in front of it whatever the caption says.
- A **kept** note, or one you corrected, outranks work you never looked at.
- An **unrated** note scores exactly as it did before any of this existed. That's the point:
  you can rate three notes out of forty and the other thirty-seven still work normally.

On **fixed it up** you can paste what you actually sent. That text goes into a `## Correction`
section *beside* the result, never over it — the original stays as the record of what the
agent produced, and the pair is the useful part. From then on the brief quotes your version
rather than the draft, so a correction is a positive example, not a scolding.

Corrections are text you wrote, so they can hold detail you'd never publish. `notes/*.md` is
gitignored, which is why this is safe by default.

One asymmetry worth knowing: Researcher is networked, so it's given no past notes at all (see
[Reading the web](#reading-the-web)). Rating its work builds a record you can read, but not
one Researcher will ever benefit from. The other agents do.

Nothing here rewrites a brief or trains anything. It only changes which past work gets
quoted, and that's deliberate — the record has to be worth something before anything
automatic should read it.

## Tidying the archive

`notes/` is a plain folder of Markdown files and it's meant to be tidied. Delete anything in
it, with `rm` or your file manager, at any time — including while the office is running.
Nothing indexes it and nothing caches it; every task reads the directory fresh.

A deleted note is simply never quoted into a brief again. That's the difference from **threw
it away**: a `discarded` note stays on disk and stays readable, it just stops being quoted.
Deleting takes the record with it. Use the verdict when you want to remember that something
didn't work, and delete when you'd rather it weren't written down at all.

Two things happen if you delete at an awkward moment, both on purpose:

- A note that vanishes while a task is composing its brief is skipped, and the task carries on.
  Only a missing file is forgiven — a permissions or I/O error still fails loudly, rather than
  quietly handing the agent less to work with than you think it has.
- A note that vanishes while its conversation is still open **ends that conversation**. You're
  told so, and you start a new task. The note is deliberately not written back from the turns
  still held in memory: you may have deleted it precisely because of what was in it, and
  restoring it behind your back would undo that.

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

Add, remove, or rewrite agents freely. `agents.json` is read fresh on every request, so a
change is live as soon as you save it — reload the page to see it.

## Who sits where

The roster is a list; an office is a floor plan. `placements` is the org chart, a separate
block in `agents.json` keyed by agent id:

```json
"placements": {
  "planner": { "department": "Operations" },
  "writer":  { "department": "Content", "reportsTo": "planner" }
}
```

Both fields are optional. `department` is any string you like — the departments are whatever
you name, not a fixed set. `reportsTo` is another agent's id; leaving it out puts that agent
at the top, and you can have as many agents at the top as you want. An agent with no
placement at all is simply unplaced.

It's a separate block rather than two more fields on each agent because prebuilt agents need
placing too, and their files are shipped in the repo for anyone to use. Which department
*you* dropped the LinkedIn agent into isn't part of that shared agent — it's part of your
office. One map keeps both kinds of agent placed the same way.

Right now this is **description only**. It changes nothing about how the office behaves: the
routing fallback is still whoever is first in `agents.json`, not whoever is top of the chart,
and no agent is told who its manager is. It's the data the office floor will be drawn from,
and the thing a manager could later actually *do* something with.

What the server won't accept, because each one would silently draw the wrong picture:

- A placement for an agent who isn't in the roster, or a `reportsTo` naming one who isn't.
- An agent reporting to itself, or any reporting loop — someone has to be at the top.
- A field other than `department` and `reportsTo`, so one invented later can't arrive unnoticed.

## Prebuilt agents

Some agents are worth shipping with the repo: a platform like LinkedIn has a rulebook long
enough to be its own agent rather than a note on someone else's brief. Those live one file
per agent in `prebuilt/`, and you switch one on by naming it in `agents.json`:

```json
{ "prebuilt": ["linkedin"], "agents": [ "..." ] }
```

They join the roster after your own agents, so the routing fallback stays whichever agent
you put first. A prebuilt agent is an ordinary agent otherwise — same fields, same prompt.

Prebuilt files carry **no personal detail**, only the craft, which is what makes them safe
to share and to read in a diff. Anything about you goes in the personal layer below.

Two rules the server enforces when it loads one:

- Only known fields are allowed. An unrecognised field is an error, not something ignored.
- A prebuilt agent may **name** a connector it wants, but it may not **define** one. A
  connector definition is a command run with your privileges, so a shared agent file
  containing one would be a way to run code on your machine. Definitions come only from
  your own `agents.json`.

## Your personal layer

Agents write better when they know who they are writing for, but that detail must not end up
on GitHub — `agents.json` is tracked, so putting it in an agent's `brief` would publish it.

Instead, copy `profile.example.json` to `profile.local.json` and fill it in. Anything matching
`*.local.json` is gitignored. The file is a plain object of named sections:

```json
{
  "who I am": "...",
  "hard constraints": "...",
  "voice": "..."
}
```

Keys become headings and values are free text, so add whatever sections you want. The server
reads the file and composes it into the system prompt after the agent's standing brief.

If the file isn't there, everything still works — agents just have no personal context, which
is the right default for a fresh clone. If it *is* there but can't be parsed, tasks fail with
the reason rather than quietly falling back to generic output.

The server composes this in rather than letting an agent read it through a filesystem
connector, and that is deliberate: an agent that can both read your files and be fed text a
stranger wrote is one bad paste away from copying your notes into a draft you then publish.

## Third-party content

An agent whose job involves other people's writing — commenting on a post, replying to a
thread — sets `handlesThirdPartyContent: true`. The server then wraps the task in a boundary
telling the agent that everything inside is material to work on and never instructions to
follow, and to say so if the text tries. The fences carry a per-request random marker so
pasted text can't close the block early.

This lives in the server rather than in each agent's brief, so every agent that sets the flag
gets it and editing a roster can't accidentally remove it. Notes from these tasks are marked
`thirdPartyContent: true`, since a note can be quoted into another agent's brief later and it
should be obvious where the text came from.

## Where things live

| Path | What |
|---|---|
| `server.mjs` | The whole server: static files, `/api/agents`, `/api/task`, `/api/notes`, `/api/notes/verdict`, the Claude CLI call |
| `agents.json` | The roster: your agents, which prebuilt ones are on, the org chart, connector definitions |
| `prebuilt/` | Shipped agent rulebooks, one JSON file each. No personal detail |
| `profile.local.json` | Your personal layer. Gitignored, never committed |
| `public/` | The browser UI |
| `notes/` | Saved deliverables, one Markdown file per task or conversation, plus your verdict on each |

## Connectors (optional)

By default agents have no tools at all: they read a prompt and write text back. A connector
is an MCP server you hand to a specific agent, and only that agent.

Define the servers once at the top of `agents.json`, then opt an agent in by name:

```json
{
  "connectors": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/you/work"]
    }
  },
  "agents": [
    { "id": "researcher", "name": "Researcher", "connectors": ["filesystem"], "...": "..." }
  ]
}
```

An agent listing no connectors is unchanged — no tools, no MCP servers. An agent pointing at
a connector that isn't defined is a config error and its tasks fail loudly, rather than
quietly running without the tools it was supposed to have.

What stays locked down either way:

- Built-in tools (`Bash`, `Edit`, `WebFetch`…) are **always** off, connectors or not. A
  connector grants that server's tools and nothing else.
- MCP servers configured elsewhere on your machine are ignored, so only what's in
  `agents.json` can load.
- Anything outside the agent's own connectors is denied rather than prompting, since nobody
  is sitting at a terminal to answer.
- The routing call never gets connectors. It only picks a name.

**What this actually means:** an MCP server is a local process started with your privileges,
and the agent driving it is acting on a task typed into a web form. Give an agent the
narrowest connector that does the job — scope the filesystem server to one directory rather
than your home folder. Notes record which connectors were in play, so you can tell later
which deliverables came from an agent that had tool access.

## Reading the web

Researcher ships with `fetch`, a connector in this repo (`connectors/fetch.mjs`) that reads a
page and hands back its text. It is ours rather than a package off npm because the limits
below are the entire point of it, and those are not worth delegating to a dependency.

It can only read hosts named in its `--allow` list in `agents.json`:

```json
"fetch": {
  "network": true,
  "command": "node",
  "args": ["connectors/fetch.mjs", "--allow", "docs.anthropic.com,en.wikipedia.org"]
}
```

Add hosts as you need them. With no `--allow` at all it refuses everything, so a
half-configured connector fails closed instead of quietly opening the whole web. There is no
search: Researcher can read a URL you give it, not go looking for one.

Two things it will not do, whatever a task asks for:

- **Reach a private address.** The hostname is resolved before the request and refused if it
  lands on loopback, a LAN range, or link-local. This is a second gate independent of the
  allowlist — allowlisting `localhost` still will not let an agent read this office's own API
  on `127.0.0.1:4521`, or cloud metadata on `169.254.169.254`.
- **Follow a redirect out of bounds.** Every hop is re-checked against both gates.

Pages come back fenced and labelled as someone else's writing, the same way a pasted task
does.

### The rule that shapes the rest

**An agent cannot both handle third-party content and reach the network.** Marking a
connector `"network": true` and putting it on an agent with `handlesThirdPartyContent: true`
is refused at load, and the whole office refuses to answer until you fix it.

Either capability alone is fine. Together they are an exfiltration chain: text from a
stranger can carry instructions, and a fetch tool is a way to send things out, so an injected
comment could walk this office's context out inside a URL. That is why the LinkedIn agent
stays offline — paste the post text instead.

For the same reason, **an agent with a networked connector is told less about this office**.
A fetched page is also a stranger's writing arriving in the context window, and anything
sitting in the prompt can be asked for back out inside a URL. So a networked agent gets:

- no personal layer — `profile.local.json` is left out of its prompt
- no past notes — it doesn't get the usual continuity brief from earlier work, and its own
  note records `usedNotes: []`

It works from the task in front of it. Researcher loses voice, detail and continuity; an
injection finds nothing worth taking. Notes are still *written* as normal — the restriction
is on what gets read back in.

**The honest limit:** once a connector can open sockets, this boundary is advisory. It shrinks
what is worth stealing and who can be told to steal it. Enforcing it properly means the
operating system — a network namespace, or a proxy that only lets the allowlist through.

Run the checks with `npm test`.

## Tuning

Environment variables, all optional:

| Variable | Default | What |
|---|---|---|
| `PORT` | `4521` | Port to listen on (localhost only) |
| `ROUTER_MODEL` | `haiku` | Model used for the Auto routing call |

How many notes get pulled into a brief, how much of each is quoted, how strong the keyword
match has to be, and how much conversation is replayed on a later turn are constants at the
top of `server.mjs`.

## What's next (not built yet)

An office floor: the roster drawn as departments and desks instead of a dropdown, with each
agent visible at its own desk and lit up while it's working. `placements` above is the data
that page will be built from.

A hierarchy that does something — a manager that can hand a piece of its work to someone
below it, rather than an org chart that only describes.

Scheduled and recurring tasks — a standing brief that runs on its own each morning instead of
waiting for you to type it.
