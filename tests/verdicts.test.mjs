// Exercises verdicts end-to-end against a running server: filing one, what it
// does to the note on disk, and — the part that actually matters — what it does
// to the brief the next agent gets.
//
// The Claude CLI is replaced with a stub that writes its --system-prompt to a
// file, so a test can read exactly what the agent was told without needing a
// logged-in CLI or spending a token.
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
const PORT = 4598;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let stubDir;
let promptFile;
// Everything this file creates in notes/, so the archive is left as it was found.
const created = new Set();

async function writeFixture(name, { task, result, verdict = '', correction = '', extra = [] }) {
  // A 2099 timestamp so readNotes, which reads the newest notes first, always
  // sees the fixture regardless of how many real notes are sitting there.
  const file = `2099-01-01T00-00-00-000Z--writer--${name}.md`;
  const lines = [
    '---',
    'agent: Writer',
    'agentId: writer',
    'date: 2099-01-01T00:00:00.000Z',
    ...extra,
    ...(verdict ? [`verdict: ${verdict}`] : []),
    '---',
    '',
    '## Task',
    '',
    task,
    '',
    '## Result',
    '',
    result,
    ''
  ];
  if (correction) lines.push('## Correction', '', correction, '');
  await fs.writeFile(path.join(NOTES_DIR, file), lines.join('\n'), 'utf-8');
  created.add(file);
  return file;
}

const readNote = (file) => fs.readFile(path.join(NOTES_DIR, file), 'utf-8');

async function post(pathname, body, headers = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// Runs a task through the stub and hands back the system prompt the agent got.
//
// Cleanup claims the exact filename the API returned rather than diffing the
// directory. Test files run in parallel and share notes/, so a diff would let
// this file's cleanup adopt — and then delete — another file's note.
async function promptFor(text) {
  await fs.writeFile(promptFile, '', 'utf-8');
  const res = await post('/api/task', { agentId: 'writer', text });
  assert.equal(res.status, 200, `task failed: ${JSON.stringify(res.body)}`);
  if (res.body?.file) created.add(res.body.file);
  return fs.readFile(promptFile, 'utf-8');
}

before(async () => {
  await fs.mkdir(NOTES_DIR, { recursive: true });
  stubDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mystin-stub-'));
  promptFile = path.join(stubDir, 'system-prompt.txt');
  const stub = path.join(stubDir, 'claude');
  await fs.writeFile(stub, [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do',
    '  if [ "$1" = "--system-prompt" ]; then printf %s "$2" > "$STUB_PROMPT_FILE"; fi',
    '  shift',
    'done',
    'cat > /dev/null',
    'printf \'{"result":"stub reply"}\''
  ].join('\n'), 'utf-8');
  await fs.chmod(stub, 0o755);

  server = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(PORT),
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_PROMPT_FILE: promptFile
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

test('a verdict lands in the note and leaves the result alone', async () => {
  const file = await writeFixture('plain', { task: 'blorf pricing copy', result: 'the draft' });
  const res = await post('/api/notes/verdict', { file, verdict: 'kept' });
  assert.equal(res.status, 200);
  assert.equal(res.body.verdict, 'kept');

  const raw = await readNote(file);
  assert.match(raw, /^verdict: kept$/m);
  assert.match(raw, /^verdictDate: \d{4}-/m);
  assert.match(raw, /## Result\n\nthe draft/);
});

test('a correction is filed beside the result, never over it', async () => {
  const file = await writeFixture('corrected', { task: 'blorf pricing copy', result: 'the draft' });
  const res = await post('/api/notes/verdict', {
    file,
    verdict: 'edited',
    correction: 'what I actually sent'
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.hasCorrection, true);

  const raw = await readNote(file);
  // Both halves present: the pair is the signal, either one alone is not.
  assert.match(raw, /## Result\n\nthe draft/);
  assert.match(raw, /## Correction\n\nwhat I actually sent/);
});

test('re-rating without a correction keeps the correction already there', async () => {
  const file = await writeFixture('sticky', {
    task: 'blorf pricing copy',
    result: 'the draft',
    verdict: 'edited',
    correction: 'what I actually sent'
  });
  await post('/api/notes/verdict', { file, verdict: 'kept' });
  const raw = await readNote(file);
  assert.match(raw, /^verdict: kept$/m);
  assert.match(raw, /## Correction\n\nwhat I actually sent/);
});

// Filing a verdict rewrites the note from scratch, so anything already in the
// frontmatter has to survive the trip. Losing thirdPartyContent would be the
// expensive one: it is how you know later where a note's text came from.
test('rating a note preserves the rest of its frontmatter', async () => {
  const file = await writeFixture('provenance', {
    task: 'blorf pricing copy',
    result: 'the draft',
    extra: ['connectors: fetch', 'thirdPartyContent: true']
  });
  await post('/api/notes/verdict', { file, verdict: 'kept' });
  const raw = await readNote(file);
  assert.match(raw, /^connectors: fetch$/m);
  assert.match(raw, /^thirdPartyContent: true$/m);
  assert.match(raw, /^verdict: kept$/m);
});

test('rejects a verdict outside the three buckets', async () => {
  const file = await writeFixture('bogus', { task: 'blorf pricing copy', result: 'the draft' });
  const res = await post('/api/notes/verdict', { file, verdict: 'excellent' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /verdict must be one of/);
});

// The filename comes from the browser. It is matched against the directory
// listing rather than scrubbed, so there is nothing to escape past.
test('refuses to walk out of the notes folder', async () => {
  for (const file of ['../agents.json', '../../etc/passwd', 'notes/../agents.json', '']) {
    const res = await post('/api/notes/verdict', { file, verdict: 'kept' });
    assert.equal(res.status, 400, `accepted ${file}`);
    assert.match(res.body.error, /no such note/);
  }
  // And the file it was reaching for is untouched.
  const agents = await fs.readFile(path.join(ROOT, 'agents.json'), 'utf-8');
  assert.doesNotMatch(agents, /verdict:/);
});

test('refuses a cross-site post', async () => {
  const res = await post('/api/notes/verdict', { file: 'x', verdict: 'kept' }, {
    Origin: 'https://evil.test'
  });
  assert.equal(res.status, 403);
});

// The two tests the whole layer exists for.

test('a discarded note is never quoted into a later brief', async () => {
  const file = await writeFixture('binned', {
    task: 'zarquon quibble launch copy',
    result: 'DRAFTED-BY-AGENT-binned',
    verdict: 'discarded'
  });
  const prompt = await promptFor('rewrite the zarquon quibble headline');
  assert.doesNotMatch(prompt, /DRAFTED-BY-AGENT-binned/);
  assert.doesNotMatch(prompt, new RegExp(file));
});

test('a corrected note is quoted as the correction, not the draft', async () => {
  await writeFixture('fixed', {
    task: 'snorkle wibble launch copy',
    result: 'DRAFTED-BY-AGENT-fixed',
    verdict: 'edited',
    correction: 'SHIPPED-BY-HUMAN-fixed'
  });
  const prompt = await promptFor('rewrite the snorkle wibble headline');
  assert.match(prompt, /SHIPPED-BY-HUMAN-fixed/);
  assert.doesNotMatch(prompt, /DRAFTED-BY-AGENT-fixed/);
  assert.match(prompt, /the corrected version that was actually used/);
});

test('an unrated note is quoted exactly as before', async () => {
  await writeFixture('unrated', {
    task: 'flumph grebble launch copy',
    result: 'DRAFTED-BY-AGENT-unrated'
  });
  const prompt = await promptFor('rewrite the flumph grebble headline');
  assert.match(prompt, /DRAFTED-BY-AGENT-unrated/);
});
