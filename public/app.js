const agentSelect = document.getElementById('agent-select');
const taskInput = document.getElementById('task-input');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const resultPanel = document.getElementById('result-panel');
const resultAgent = document.getElementById('result-agent');
const resultText = document.getElementById('result-text');
const resultFile = document.getElementById('result-file');
const resultNotes = document.getElementById('result-notes');
const notesList = document.getElementById('notes-list');
const verdictBar = document.getElementById('verdict-bar');
const verdictStatus = document.getElementById('verdict-status');
const correctionBox = document.getElementById('correction-box');
const correctionInput = document.getElementById('correction-input');
const correctionSave = document.getElementById('correction-save');

// The note currently on screen, so the verdict buttons know what they apply to.
let currentFile = null;

async function loadAgents() {
  const agents = await (await fetch('/api/agents')).json();
  const auto = '<option value="auto" title="Let the office decide who takes it">Auto — pick the best fit</option>';
  agentSelect.innerHTML = auto + agents
    .map((a) => `<option value="${a.id}" title="${escapeHtml(a.does)}">${a.name} — ${a.role}</option>`)
    .join('');
}

async function loadNotes() {
  const notes = await (await fetch('/api/notes')).json();
  notesList.innerHTML = notes.map((n) => {
    const tag = n.verdict
      ? `<span class="verdict-tag ${n.verdict}">${n.verdict}${n.hasCorrection ? ' + correction' : ''}</span>`
      : '';
    return `<li data-file="${escapeHtml(n.file)}">
      <strong>${escapeHtml(n.agent)}</strong> · ${new Date(n.date).toLocaleString()} ${tag}
      <br>${escapeHtml(n.task)}
      <span class="verdict-row">
        <button type="button" class="verdict-btn" data-verdict="kept">kept</button>
        <button type="button" class="verdict-btn" data-verdict="edited">edited</button>
        <button type="button" class="verdict-btn" data-verdict="discarded">discarded</button>
      </span>
    </li>`;
  }).join('') || '<li class="empty">No notes yet.</li>';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The correction field is left out unless there is something to say, because an
// omitted field means "leave whatever is there alone" and an empty one clears it.
async function sendVerdict(file, verdict, correction) {
  const payload = { file, verdict };
  if (correction) payload.correction = correction;
  const res = await fetch('/api/notes/verdict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'could not file that verdict');
  return data;
}

function resetVerdictBar() {
  for (const btn of verdictBar.querySelectorAll('.verdict-btn')) btn.classList.remove('chosen');
  verdictStatus.textContent = '';
  correctionBox.hidden = true;
  correctionInput.value = '';
}

verdictBar.addEventListener('click', async (event) => {
  const btn = event.target.closest('.verdict-btn');
  if (!btn || !currentFile) return;
  const verdict = btn.dataset.verdict;
  for (const other of verdictBar.querySelectorAll('.verdict-btn')) {
    other.classList.toggle('chosen', other === btn);
  }
  correctionBox.hidden = verdict !== 'edited';
  try {
    await sendVerdict(currentFile, verdict, correctionInput.value.trim());
    verdictStatus.textContent = verdict === 'discarded'
      ? 'Filed — this one will not be quoted into later briefs.'
      : 'Filed.';
    await loadNotes();
  } catch (err) {
    verdictStatus.textContent = err.message;
  }
});

correctionSave.addEventListener('click', async () => {
  const correction = correctionInput.value.trim();
  if (!currentFile || !correction) return;
  try {
    await sendVerdict(currentFile, 'edited', correction);
    verdictStatus.textContent = 'Saved — later briefs will quote this, not the draft.';
    await loadNotes();
  } catch (err) {
    verdictStatus.textContent = err.message;
  }
});

// Rating from the list is verdict-only. A correction needs the result in front
// of you to write, and the list deliberately doesn't carry result text.
notesList.addEventListener('click', async (event) => {
  const btn = event.target.closest('.verdict-btn');
  const item = btn && btn.closest('li[data-file]');
  if (!item) return;
  try {
    await sendVerdict(item.dataset.file, btn.dataset.verdict);
    await loadNotes();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
});

submitBtn.addEventListener('click', async () => {
  const text = taskInput.value.trim();
  if (!text) return;
  const agentId = agentSelect.value;

  submitBtn.disabled = true;
  statusEl.textContent = 'Working…';
  resultPanel.hidden = true;

  try {
    const res = await fetch('/api/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'something went wrong');

    resultAgent.textContent = data.routed ? `${data.agent} picked this up` : data.agent;
    resultText.textContent = data.result;
    resultFile.textContent = data.file;
    const used = data.usedNotes || [];
    const connectors = data.usedConnectors || [];
    const lines = [];
    if (used.length) {
      lines.push(`Read ${used.length} earlier ${used.length === 1 ? 'note' : 'notes'} first: ${used.join(', ')}`);
    }
    if (connectors.length) lines.push(`Connectors available: ${connectors.join(', ')}`);
    resultNotes.textContent = lines.join('\n');
    resultNotes.hidden = lines.length === 0;
    currentFile = data.file;
    resetVerdictBar();
    resultPanel.hidden = false;
    statusEl.textContent = '';
    taskInput.value = '';
    await loadNotes();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

loadAgents();
loadNotes();
