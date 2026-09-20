// Exercises the org chart: the placements map in agents.json that says which
// department an agent sits in and who it reports to.
//
// The refusal cases are the point. A placement that quietly does nothing is the
// bad outcome here, because a typo'd manager id draws a floor that looks
// deliberate and is wrong. So every malformed placement has to be a loud error
// rather than a field the server shrugs at.
//
// Each case runs a real server against its own roster. server.mjs reads
// agents.json from beside itself and imports nothing but node builtins, so a
// copy of it in a temp directory next to a crafted agents.json is a complete,
// isolated office — no shared state with the other test files, and no need for
// an environment knob that exists only for tests.
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

let tmpDir;
let nextPort = 4610;

const AGENTS = [
  { id: 'writer', name: 'Writer', role: 'Writing Agent', does: 'Writes.' },
  { id: 'coder', name: 'Coder', role: 'Code Agent', does: 'Codes.' },
  { id: 'planner', name: 'Planner', role: 'Planning Agent', does: 'Plans.' }
];

// Starts an office whose roster is exactly what the test asked for, hands back
// the parsed /api/agents response, and shuts it down. The response is where a
// bad roster shows up: loadConfig runs per request rather than at boot, which
// is also why editing agents.json needs no restart.
async function withRoster(config, fn) {
  const dir = path.join(tmpDir, `office-${nextPort}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(path.join(ROOT, 'server.mjs'), path.join(dir, 'server.mjs'));
  await fs.cp(path.join(ROOT, 'prebuilt'), path.join(dir, 'prebuilt'), { recursive: true });
  await fs.writeFile(path.join(dir, 'agents.json'), JSON.stringify(config), 'utf-8');

  const port = nextPort++;
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (d) => String(d).includes('listening') && resolve());
      server.on('error', reject);
      setTimeout(() => reject(new Error('server did not start')), 10000).unref();
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/agents`);
    return await fn({ status: res.status, body: await res.json() });
  } finally {
    server.kill();
  }
}

// Every refusal case is the same shape, so they are a table: a roster, and the
// message its rejection has to carry.
const REFUSALS = [
  ['a manager who is not in the roster',
    { planner: { reportsTo: 'ceo' } }, /must name an agent in this roster/],
  ['a placement for an agent who does not exist',
    { ceo: { department: 'Corner Office' } }, /not an agent in this roster/],
  ['an agent reporting to itself',
    { writer: { reportsTo: 'writer' } }, /cannot report to itself/],
  ['a two-agent reporting loop',
    { writer: { reportsTo: 'coder' }, coder: { reportsTo: 'writer' } }, /reporting loop/],
  ['a loop that sits above the agent it is reached from',
    {
      writer: { reportsTo: 'coder' },
      coder: { reportsTo: 'planner' },
      planner: { reportsTo: 'coder' }
    }, /reporting loop/],
  ['a field invented later',
    { writer: { desk: 'by the window' } }, /unsupported field "desk"/],
  ['an empty department',
    { writer: { department: '   ' } }, /must be a non-empty string/],
  ['a department that is not a string',
    { writer: { department: 3 } }, /must be a non-empty string/],
  ['a placement that is not an object',
    { writer: 'Content' }, /must be an object/]
];

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mystin-placements-'));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('a placement reaches the roster the page is given', async () => {
  await withRoster({ agents: AGENTS, placements: {
    planner: { department: 'Operations' },
    writer: { department: 'Content', reportsTo: 'planner' }
  } }, ({ status, body }) => {
    assert.equal(status, 200);
    const byId = Object.fromEntries(body.map((a) => [a.id, a]));
    assert.equal(byId.writer.department, 'Content');
    assert.equal(byId.writer.reportsTo, 'planner');
    assert.equal(byId.planner.department, 'Operations');
    // Absent rather than empty: nobody is above the planner, and an unplaced
    // agent carries no placement fields at all for the floor to decide about.
    assert.equal('reportsTo' in byId.planner, false);
    assert.equal('department' in byId.coder, false);
  });
});

// The reason a shared map exists rather than fields on the agent record.
// prebuilt/*.json is policed by an allowlist that placement fields are
// deliberately not on, so this is the only way to seat a prebuilt agent.
test('a prebuilt agent is placed through the same map', async () => {
  await withRoster({
    prebuilt: ['linkedin'],
    agents: AGENTS,
    placements: { linkedin: { department: 'Content', reportsTo: 'writer' } }
  }, ({ status, body }) => {
    assert.equal(status, 200);
    const linkedin = body.find((a) => a.id === 'linkedin');
    assert.equal(linkedin.department, 'Content');
    assert.equal(linkedin.reportsTo, 'writer');
  });
});

test('a roster with no placements at all still works', async () => {
  await withRoster({ agents: AGENTS }, ({ status, body }) => {
    assert.equal(status, 200);
    assert.equal(body.length, 3);
    assert.equal(body.every((a) => !('department' in a)), true);
  });
});

for (const [name, placements, message] of REFUSALS) {
  test(`refuses ${name}`, async () => {
    await withRoster({ agents: AGENTS, placements }, ({ status, body }) => {
      assert.equal(status, 500);
      assert.match(body.error, message);
    });
  });
}

// Placement is description, not permission. Nothing above it in the file
// changes because of it, and this pins that: the fallback agent is still
// whoever is first in the roster, not whoever is at the top of the org chart.
test('the org chart does not move the routing fallback', async () => {
  await withRoster({ agents: AGENTS, placements: {
    writer: { reportsTo: 'planner' },
    coder: { reportsTo: 'planner' }
  } }, ({ status, body }) => {
    assert.equal(status, 200);
    assert.equal(body[0].id, 'writer');
  });
});
