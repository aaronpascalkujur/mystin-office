// Exercises multi-turn conversations against a running server: what the agent
// is actually sent on a follow-up, what the note on disk turns into, and which
// agents are allowed a second turn at all.
//
// The Claude CLI is replaced with a stub that writes both its --system-prompt
// and its stdin to files, so a test can read exactly what the agent was told
// without needing a logged-in CLI. The stub numbers its replies, which is how
// a test tells turn 2's answer from turn 1's.
//
// Run: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = path.join(ROOT, 'notes');
const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}`;
// Has to match THREAD_CHARS in server.mjs; the trimming test is meaningless if
// it drifts, so it is asserted against rather than just assumed.
const THREAD_CHARS = 8000;

let server;
let stubDir;
let promptFile;
let inputFile;
// Every note this file creates, so the archive is left as it was found.
const created = new Set();

async function post(pathname, body, headers = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Sends one message and hands back the response plus what the agent was given.
//
// Cleanup claims the exact filename the API returned rather than diffing the
// directory. Test files run in parallel and share notes/, so a diff would let
// one file's cleanup adopt — and then delete — another file's note.
async function send(body) {
  await fs.writeFile(promptFile, '', 'utf-8');
  await fs.writeFile(inputFile, '', 'utf-8');
  const res = await post('/api/task', body);
  if (res.body?.file) created.add(res.body.file);
  if (res.status !== 200) return { ...res, prompt: '', input: '' };
  return {
    ...res,
    prompt: await fs.readFile(promptFile, 'utf-8'),
    input: await fs.readFile(inputFile, 'utf-8')
  };
}

const readNote = (file) => fs.readFile(path.join(NOTES_DIR, file), 'utf-8');

before(async () => {
  await fs.mkdir(NOTES_DIR, { recursive: true });
  stubDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mystin-thread-stub-'));
  promptFile = path.join(stubDir, 'system-prompt.txt');
  inputFile = path.join(stubDir, 'input.txt');
  const countFile = path.join(stubDir, 'count.txt');
  const stub = path.join(stubDir, 'claude');
  await fs.writeFile(stub, [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do',
    '  if [ "$1" = "--system-prompt" ]; then printf %s "$2" > "$STUB_PROMPT_FILE"; fi',
    '  shift',
    'done',
    'cat > "$STUB_INPUT_FILE"',
    'n=$(cat "$STUB_COUNT_FILE" 2>/dev/null || echo 0)',
    'n=$((n+1))',
    'printf %s "$n" > "$STUB_COUNT_FILE"',
    'printf \'{"result":"AGENT-REPLY-%s"}\' "$n"'
  ].join('\n'), 'utf-8');
  await fs.chmod(stub, 0o755);

  server = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(PORT),
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_PROMPT_FILE: promptFile,
      STUB_INPUT_FILE: inputFile,
      STUB_COUNT_FILE: countFile
    }
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (c) => String(c).includes('listening') && resolve());
    server.stderr.on('data', (c) => reject(new Error(`server failed: ${c}`)));
    setTimeout(() => reject(new Error('server did not start')), 10_000).unref();
  });
});

after(async () => {
  server?.kill();
  for (const file of created) await fs.rm(path.join(NOTES_DIR, file), { force: true });
  if (stubDir) await fs.rm(stubDir, { recursive: true, force: true });
});

// The safety net under the whole feature: adding threads must not change what a
// plain one-shot task looks like. If turn 1 grows a transcript preamble, every
// existing agent's behaviour shifts underneath it.
test('the first turn sends the task and nothing else', async () => {
  const text = 'draft a blurb about grommet bearings';
  const { status, body, input } = await send({ agentId: 'writer', text });
  assert.equal(status, 200);
  assert.equal(input.trim(), text);
  assert.ok(body.threadId, 'a non-networked agent should open a thread');
  assert.equal(body.turn, 1);
});

test('a reply replays the conversation and reuses the same brief', async () => {
  const first = await send({ agentId: 'writer', text: 'write about widget flanges' });
  const second = await send({ threadId: first.body.threadId, text: 'now make it shorter' });

  assert.equal(second.status, 200);
  assert.equal(second.body.turn, 2);
  // The agent is told what it already said, since the CLI keeps nothing.
  assert.match(second.input, /write about widget flanges/);
  assert.match(second.input, new RegExp(first.body.result));
  assert.match(second.input, /now make it shorter/);
  // Same standing brief: the personal layer and past notes are composed once,
  // at the top of the thread, not re-retrieved per turn.
  assert.equal(second.prompt, first.prompt);
});

test('a thread keeps writing to one note, newest reply as the result', async () => {
  const first = await send({ agentId: 'writer', text: 'plan the sprocket launch' });
  const second = await send({ threadId: first.body.threadId, text: 'add a budget line' });

  assert.equal(second.body.file, first.body.file, 'a thread is one note, not one per turn');
  const raw = await readNote(second.body.file);
  // The result is what the agent last said — that is the deliverable.
  assert.match(raw, /## Result\n\nAGENT-REPLY-\d+/);
  assert.doesNotMatch(raw.split('## Result')[1].split('## Thread')[0], /plan the sprocket launch/);
  // Everything before it is kept as the transcript, so the note records how the
  // deliverable was arrived at and not just where it landed.
  assert.match(raw, /## Thread\n\n/);
  assert.match(raw, /plan the sprocket launch/);
  assert.match(raw, /^## Task\n\nplan the sprocket launch$/m);
});

// Filing a verdict rewrites a note from its parsed form, so a section the
// parser misses is silently deleted. The transcript is the expensive one to
// lose: it is the only record of how a multi-turn deliverable was reached.
test('rating a thread note keeps its transcript', async () => {
  const first = await send({ agentId: 'writer', text: 'outline the flange memo' });
  const second = await send({ threadId: first.body.threadId, text: 'tighten the opening' });

  const res = await post('/api/notes/verdict', { file: second.body.file, verdict: 'kept' });
  assert.equal(res.status, 200);
  const raw = await readNote(second.body.file);
  assert.match(raw, /^verdict: kept$/m);
  assert.match(raw, /## Thread\n\n/);
  assert.match(raw, /outline the flange memo/);
});

// Researcher can reach the network, so it is deliberately starved of context:
// no personal layer, no past notes, and now no conversation either. A thread is
// a context window that grows, which is exactly what must not happen next to a
// tool that can open sockets.
test('a networked agent gets no thread to continue', async () => {
  const { status, body } = await send({ agentId: 'researcher', text: 'summarise a page' });
  assert.equal(status, 200);
  assert.equal(body.threadId, null);
  assert.deepEqual(body.usedNotes, []);
});

test('an unknown thread id is refused rather than silently starting over', async () => {
  const { status, body } = await post('/api/task', { threadId: 'deadbeefdeadbeef', text: 'hello' });
  assert.equal(status, 400);
  assert.match(body.error, /no longer open/);
});

// Threads are held in memory and resent whole each turn, so an unbounded one is
// both a cost and a context problem. Trimming drops from the middle: the
// opening exchange sets the task and the recent turns are the live thread.
test('a long conversation drops the middle and keeps the opening', async () => {
  const filler = 'x'.repeat(3000);
  const first = await send({ agentId: 'writer', text: `OPENER-MARKER ${filler}` });
  const id = first.body.threadId;
  await send({ threadId: id, text: `MIDDLE-MARKER ${filler}` });
  await send({ threadId: id, text: `THIRD-MARKER ${filler}` });
  const last = await send({ threadId: id, text: 'and finally, wrap it up' });

  assert.equal(last.status, 200);
  assert.ok(last.input.length < THREAD_CHARS * 2, 'the replayed conversation should be bounded');
  assert.match(last.input, /OPENER-MARKER/, 'the opening turn anchors the task');
  assert.match(last.input, /THIRD-MARKER/, 'the most recent turns are the live conversation');
  assert.match(last.input, /and finally, wrap it up/);
  assert.doesNotMatch(last.input, /MIDDLE-MARKER/);
  // Said out loud rather than quietly elided, so the agent knows the record it
  // is reading has a hole in it.
  assert.match(last.input, /earlier turns? dropped/);

  // The note still holds the whole conversation. Trimming is about what the
  // agent is sent, not about what gets written down.
  const raw = await readNote(last.body.file);
  assert.match(raw, /MIDDLE-MARKER/);
});

test('a thread refuses a cross-site post like everything else', async () => {
  const res = await post('/api/task', { agentId: 'writer', text: 'hi' }, {
    Origin: 'https://evil.test'
  });
  assert.equal(res.status, 403);
});
