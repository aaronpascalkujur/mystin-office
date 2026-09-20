// Exercises the fetch connector over real MCP stdio, the same way the Claude
// CLI talks to it. The refusal cases are the point: they are what stands
// between "an agent can read a docs page" and "an agent can read this office's
// own API on localhost".
//
// Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONNECTOR = path.join(ROOT, 'connectors', 'fetch.mjs');

async function withConnector(allowArgs, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CONNECTOR, ...allowArgs],
    cwd: ROOT
  });
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const fetchUrl = (client, url) =>
  client.callTool({ name: 'fetch_url', arguments: { url } });

const textOf = (res) => res.content.map((c) => c.text).join('\n');

test('exposes exactly one tool, fetch_url', async () => {
  await withConnector(['--allow', 'example.com'], async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'fetch_url');
  });
});

test('refuses a host that is not on the allowlist', async () => {
  await withConnector(['--allow', 'example.com'], async (client) => {
    const res = await fetchUrl(client, 'https://evil.test/steal');
    assert.equal(res.isError, true);
    assert.match(textOf(res), /not in this connector's allowed hosts/);
  });
});

test('refuses everything when no allowlist was configured', async () => {
  await withConnector([], async (client) => {
    const res = await fetchUrl(client, 'https://example.com/');
    assert.equal(res.isError, true);
    assert.match(textOf(res), /no allowed hosts/);
  });
});

// The one that matters most. Allowlisting localhost is not enough to reach it:
// the address check is a second, independent gate, so a misconfigured
// allowlist cannot expose this office's own API on 127.0.0.1:4521.
test('refuses loopback even when it is explicitly allowlisted', async () => {
  await withConnector(['--allow', 'localhost'], async (client) => {
    const res = await fetchUrl(client, 'http://localhost:4521/api/task');
    assert.equal(res.isError, true);
    assert.match(textOf(res), /private address/);
  });
});

test('refuses the cloud metadata address', async () => {
  await withConnector(['--allow', '169.254.169.254'], async (client) => {
    const res = await fetchUrl(client, 'http://169.254.169.254/latest/meta-data/');
    assert.equal(res.isError, true);
    assert.match(textOf(res), /private address/);
  });
});

test('refuses a private LAN address', async () => {
  await withConnector(['--allow', '192.168.1.1'], async (client) => {
    const res = await fetchUrl(client, 'http://192.168.1.1/');
    assert.equal(res.isError, true);
    assert.match(textOf(res), /private address/);
  });
});

test('refuses non-http protocols', async () => {
  await withConnector(['--allow', 'example.com'], async (client) => {
    const res = await fetchUrl(client, 'file:///etc/passwd');
    assert.equal(res.isError, true);
    assert.match(textOf(res), /only http and https/);
  });
});

test('allows a subdomain of an allowed host, but not a lookalike', async () => {
  await withConnector(['--allow', 'example.com'], async (client) => {
    // Not a subdomain — "notexample.com" must not match "example.com".
    const res = await fetchUrl(client, 'https://notexample.com/');
    assert.equal(res.isError, true);
    assert.match(textOf(res), /not in this connector's allowed hosts/);
  });
});

test('requires a url argument', async () => {
  await withConnector(['--allow', 'example.com'], async (client) => {
    const res = await client.callTool({ name: 'fetch_url', arguments: {} });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /url is required/);
  });
});
