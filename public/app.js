const agentSelect = document.getElementById('agent-select');
const taskInput = document.getElementById('task-input');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const resultPanel = document.getElementById('result-panel');
const resultAgent = document.getElementById('result-agent');
const resultText = document.getElementById('result-text');
const resultFile = document.getElementById('result-file');
const notesList = document.getElementById('notes-list');

async function loadAgents() {
  const agents = await (await fetch('/api/agents')).json();
  agentSelect.innerHTML = agents
    .map((a) => `<option value="${a.id}" title="${escapeHtml(a.does)}">${a.name} — ${a.role}</option>`)
    .join('');
}

async function loadNotes() {
  const notes = await (await fetch('/api/notes')).json();
  notesList.innerHTML = notes
    .map(
      (n) => `<li><strong>${escapeHtml(n.agent)}</strong> · ${new Date(n.date).toLocaleString()}<br>${escapeHtml(n.task)}</li>`
    )
    .join('') || '<li class="empty">No notes yet.</li>';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

    resultAgent.textContent = data.agent;
    resultText.textContent = data.result;
    resultFile.textContent = data.file;
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
