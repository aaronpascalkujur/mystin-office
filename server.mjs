import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const NOTES_DIR = path.join(__dirname, 'notes');
const AGENTS_FILE = path.join(__dirname, 'agents.json');
const PORT = process.env.PORT || 4521;
const HOST = '127.0.0.1';
// Only these hosts/origins may talk to the server. Checking Host blocks DNS
// rebinding; checking Origin blocks other websites posting tasks.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));
const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

async function loadAgents() {
  const raw = await fs.readFile(AGENTS_FILE, 'utf-8');
  return JSON.parse(raw).agents;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Runs the agent's task through the Claude Code CLI in one-shot print mode and
// returns the plain-text result. The agent gets no tools and no MCP servers
// (text out only) — this MVP only ever writes files itself, on the server side.
// The task goes in on stdin, not argv, so it can't be parsed as a CLI flag and
// isn't bound by the per-argument size limit. The process is killed if it runs
// past AGENT_TIMEOUT_MS or if `signal` aborts (the browser went away).
function runAgent({ systemPrompt, task, model, signal }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--system-prompt', systemPrompt,
      '--tools', '',
      '--strict-mcp-config',
      '--no-session-persistence'
    ];
    if (model) args.push('--model', model);

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal,
      timeout: AGENT_TIMEOUT_MS
    });
    child.stdin.on('error', () => {}); // surfaced via 'close'/'error' below
    child.stdin.end(task);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => {
      if (err.name === 'AbortError') reject(new Error('task cancelled'));
      else reject(new Error(`could not start claude CLI: ${err.message}`));
    });
    child.on('close', (code, killedBy) => {
      if (killedBy) {
        reject(new Error(signal?.aborted
          ? 'task cancelled'
          : `claude took longer than ${AGENT_TIMEOUT_MS / 60000} minutes and was stopped`));
        return;
      }
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) {
          reject(new Error(parsed.result || 'claude reported an error'));
          return;
        }
        resolve(parsed.result || '');
      } catch {
        reject(new Error('could not parse claude CLI output'));
      }
    });
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'task';
}

async function saveNote({ agent, task, result }) {
  await fs.mkdir(NOTES_DIR, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}--${agent.id}--${slugify(task)}.md`;
  const body = [
    '---',
    `agent: ${agent.name}`,
    `agentId: ${agent.id}`,
    `date: ${now.toISOString()}`,
    '---',
    '',
    `## Task`,
    '',
    task,
    '',
    `## Result`,
    '',
    result.trim(),
    ''
  ].join('\n');
  await fs.writeFile(path.join(NOTES_DIR, filename), body, 'utf-8');
  return filename;
}

async function listNotes() {
  await fs.mkdir(NOTES_DIR, { recursive: true });
  const files = (await fs.readdir(NOTES_DIR)).filter((f) => f.endsWith('.md'));
  files.sort().reverse();
  const notes = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(NOTES_DIR, file), 'utf-8');
    const agentMatch = raw.match(/^agent: (.*)$/m);
    const dateMatch = raw.match(/^date: (.*)$/m);
    const taskMatch = raw.match(/## Task\n\n([\s\S]*?)\n\n## Result/);
    notes.push({
      file,
      agent: agentMatch ? agentMatch[1] : '',
      date: dateMatch ? dateMatch[1] : '',
      task: taskMatch ? taskMatch[1].trim() : ''
    });
  }
  return notes;
}

async function serveStatic(req, res) {
  let reqPath;
  try {
    reqPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    if (url.pathname === '/api/agents' && req.method === 'GET') {
      sendJSON(res, 200, await loadAgents());
      return;
    }

    if (url.pathname === '/api/notes' && req.method === 'GET') {
      sendJSON(res, 200, await listNotes());
      return;
    }

    if (url.pathname === '/api/task' && req.method === 'POST') {
      const origin = req.headers.origin;
      const contentType = req.headers['content-type'] || '';
      if ((origin && !ALLOWED_ORIGINS.has(origin)) || !contentType.startsWith('application/json')) {
        sendJSON(res, 403, { error: 'forbidden' });
        return;
      }
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJSON(res, 400, { error: 'request body must be valid JSON' });
        return;
      }
      const task = typeof body.text === 'string' ? body.text.trim() : '';
      if (!task) {
        sendJSON(res, 400, { error: 'text is required' });
        return;
      }
      const agents = await loadAgents();
      const agent = agents.find((a) => a.id === body.agentId);
      if (!agent) {
        sendJSON(res, 400, { error: `unknown agent: ${body.agentId}` });
        return;
      }

      const systemPrompt = [
        `You are ${agent.name}, ${agent.role} at a small office of AI agents called Mystin Office.`,
        `What you do: ${agent.does}`,
        agent.brief ? `Standing instructions: ${agent.brief}` : '',
        'Do the task the user gives you directly. Write only the finished deliverable, no preamble like "Sure, here is...".'
      ].filter(Boolean).join('\n');

      // Stop the agent if the browser disconnects before we answer.
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      let result;
      try {
        result = await runAgent({ systemPrompt, task, model: agent.model, signal: controller.signal });
      } catch (err) {
        if (!controller.signal.aborted) sendJSON(res, 502, { error: err.message });
        return;
      }

      const file = await saveNote({ agent, task, result });
      sendJSON(res, 200, { agent: agent.name, result, file });
      return;
    }

    if (req.method === 'GET') {
      await serveStatic(req, res);
      return;
    }

    res.writeHead(404).end('not found');
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mystin Office listening on http://localhost:${PORT}`);
});
