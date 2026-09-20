const floor = document.getElementById('floor');
const chosenAgent = document.getElementById('chosen-agent');
const taskInput = document.getElementById('task-input');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const resultPanel = document.getElementById('result-panel');
const resultAgent = document.getElementById('result-agent');
const transcript = document.getElementById('transcript');
const replyBox = document.getElementById('reply-box');
const replyInput = document.getElementById('reply-input');
const replyBtn = document.getElementById('reply-btn');
const replyStatus = document.getElementById('reply-status');
const resultFile = document.getElementById('result-file');
const notePath = document.getElementById('note-path');
const noteGone = document.getElementById('note-gone');
const resultNotes = document.getElementById('result-notes');
const notesList = document.getElementById('notes-list');
const verdictBar = document.getElementById('verdict-bar');
const verdictStatus = document.getElementById('verdict-status');
const correctionBox = document.getElementById('correction-box');
const correctionInput = document.getElementById('correction-input');
const correctionSave = document.getElementById('correction-save');

// The note currently on screen, so the verdict buttons know what they apply to.
let currentFile = null;
// The open conversation, if there is one. A thread lives on the server; the
// browser only holds its id and a copy of the turns to draw. null means this
// result can't be continued — a networked agent, or a reload since it ran.
let currentThreadId = null;
let currentAgentName = '';
let currentTurns = [];
// Who is handling the open conversation. Taken from the response rather than
// from the desk that was clicked, because an auto-routed task is handled by
// somebody the browser never picked.
let currentAgentId = null;

// The desk you have picked. 'auto' is the front desk, which is the server's
// sentinel for "route it" as well as the reception tile's id on the floor.
const RECEPTION = 'auto';
// Where agents with no placement sit. Not a department, so it is drawn last.
const UNPLACED = 'Unassigned';
let selectedAgentId = RECEPTION;

// Built as DOM nodes rather than innerHTML: every turn is either text a stranger
// might have written or text a model produced, and neither belongs in markup.
function renderTranscript() {
  transcript.replaceChildren();
  for (const turn of currentTurns) {
    const block = document.createElement('div');
    block.className = `turn ${turn.role}`;
    const who = document.createElement('span');
    who.className = 'turn-who';
    who.textContent = turn.role === 'user' ? 'You' : currentAgentName;
    const body = document.createElement('pre');
    body.textContent = turn.text;
    block.append(who, body);
    transcript.append(block);
  }
}

async function loadAgents() {
  renderFloor(await (await fetch('/api/agents')).json());
}

// Departments in the order the roster first mentions them, so the floor is
// arranged by editing agents.json and nothing else. Agents with no placement
// are a loose end rather than a department, so they go last whatever the order.
function groupIntoRooms(agents) {
  const rooms = new Map();
  for (const agent of agents) {
    const name = agent.department || UNPLACED;
    if (!rooms.has(name)) rooms.set(name, []);
    rooms.get(name).push(agent);
  }
  const unplaced = rooms.get(UNPLACED);
  if (unplaced && rooms.size > 1) {
    rooms.delete(UNPLACED);
    rooms.set(UNPLACED, unplaced);
  }
  return [...rooms];
}

// Desks are buttons so the floor works from a keyboard, and are built as nodes
// rather than markup for the same reason the transcript is: every string here
// was authored somewhere else, in agents.json or in a shipped prebuilt file.
function makeDesk({ id, name, role, does, reportsTo }, byId) {
  const desk = document.createElement('button');
  desk.type = 'button';
  desk.className = 'desk';
  desk.dataset.agent = id;
  if (does) desk.title = does;

  const nameEl = document.createElement('span');
  nameEl.className = 'desk-name';
  nameEl.textContent = name;

  const roleEl = document.createElement('span');
  roleEl.className = 'desk-role';
  roleEl.textContent = role;
  desk.append(nameEl, roleEl);

  // The reporting line is written on the desk instead of drawn as position,
  // because the two structures disagree: an agent can sit in one department and
  // report into another, and a layout cannot show both at once.
  const boss = reportsTo && byId.get(reportsTo);
  if (boss) {
    const reportsEl = document.createElement('span');
    reportsEl.className = 'desk-reports';
    reportsEl.textContent = `reports to ${boss.name}`;
    desk.dataset.reportsTo = boss.id;
    desk.append(reportsEl);
  }
  return desk;
}

function makeReception() {
  const desk = document.createElement('button');
  desk.type = 'button';
  desk.className = 'desk reception';
  desk.dataset.agent = RECEPTION;
  desk.title = 'Let the office decide who takes it';
  const name = document.createElement('span');
  name.className = 'desk-name';
  name.textContent = 'Front desk';
  const role = document.createElement('span');
  role.className = 'desk-role';
  role.textContent = 'Hands it to whoever fits best';
  desk.append(name, role);
  return desk;
}

function renderFloor(agents) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const rooms = document.createElement('div');
  rooms.className = 'rooms';
  for (const [department, members] of groupIntoRooms(agents)) {
    const room = document.createElement('div');
    room.className = 'room';
    const label = document.createElement('div');
    label.className = 'room-name';
    label.textContent = department;
    const desks = document.createElement('div');
    desks.className = 'desks';
    desks.append(...members.map((a) => makeDesk(a, byId)));
    room.append(label, desks);
    rooms.append(room);
  }
  floor.replaceChildren(makeReception(), rooms);
  // A roster can lose the agent you had picked, since agents.json is re-read on
  // every request. Falling back to the front desk beats posting a stale id.
  if (selectedAgentId !== RECEPTION && !byId.has(selectedAgentId)) {
    selectedAgentId = RECEPTION;
  }
  drawSelection();
}

function drawSelection() {
  let picked = 'the front desk';
  for (const desk of floor.querySelectorAll('.desk')) {
    const chosen = desk.dataset.agent === selectedAgentId;
    desk.classList.toggle('chosen', chosen);
    desk.setAttribute('aria-pressed', String(chosen));
    if (chosen && desk.dataset.agent !== RECEPTION) {
      picked = desk.querySelector('.desk-name').textContent;
    }
  }
  chosenAgent.textContent = `Going to: ${picked}`;
}

// Lights one desk, or clears the floor when given null. The front desk lights
// for an unrouted task because that is honestly what is happening: nobody has
// been chosen yet.
function setBusy(agentId) {
  for (const desk of floor.querySelectorAll('.desk')) {
    desk.classList.toggle('busy', Boolean(agentId) && desk.dataset.agent === agentId);
  }
}

function highlightManager(agentId) {
  for (const desk of floor.querySelectorAll('.desk')) {
    desk.classList.toggle('is-manager', Boolean(agentId) && desk.dataset.agent === agentId);
  }
}

const managerOf = (target) => target.closest?.('.desk')?.dataset.reportsTo || null;

floor.addEventListener('click', (event) => {
  const desk = event.target.closest('.desk');
  if (!desk) return;
  selectedAgentId = desk.dataset.agent;
  drawSelection();
});

// Pointing at or tabbing to a desk shows you who that agent answers to.
floor.addEventListener('mouseover', (event) => highlightManager(managerOf(event.target)));
floor.addEventListener('mouseleave', () => highlightManager(null));
floor.addEventListener('focusin', (event) => highlightManager(managerOf(event.target)));
floor.addEventListener('focusout', () => highlightManager(null));

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

// One path for both the first task and every reply after it. The only
// difference is threadId: sending one continues a conversation, omitting one
// starts a fresh task and a fresh note.
async function runTask({ text, threadId, statusTarget, button }) {
  button.disabled = true;
  statusTarget.textContent = 'Working…';
  // A reply goes to whoever owns the thread, which is not necessarily the desk
  // still highlighted — the first turn may have been routed.
  setBusy(threadId ? currentAgentId : selectedAgentId);

  try {
    const body = threadId ? { threadId, text } : { agentId: selectedAgentId, text };
    const res = await fetch('/api/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'something went wrong');

    if (threadId) {
      currentTurns.push({ role: 'user', text }, { role: 'agent', text: data.result });
    } else {
      currentAgentName = data.agent;
      currentAgentId = data.agentId;
      currentTurns = [{ role: 'user', text }, { role: 'agent', text: data.result }];
      resultAgent.textContent = data.routed ? `${data.agent} picked this up` : data.agent;
    }
    renderTranscript();

    // No file means the note was tidied away mid-run. The reply still came
    // back, so it is shown — there is just nothing on disk behind it, and
    // nothing to rate.
    resultFile.textContent = data.file || '';
    notePath.hidden = !data.file;
    noteGone.hidden = Boolean(data.file);
    verdictBar.hidden = !data.file;
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
    currentThreadId = data.threadId || null;
    // No threadId means the server won't take a follow-up for this one — a
    // networked agent, which stays one-shot on purpose.
    replyBox.hidden = !currentThreadId;
    replyInput.value = '';
    replyStatus.textContent = '';
    // Every turn rewrites the note's result, so a verdict from the turn before
    // is a judgement on text that is no longer there. Start the bar clean.
    resetVerdictBar();
    resultPanel.hidden = false;
    statusTarget.textContent = '';
    await loadNotes();
    return true;
  } catch (err) {
    statusTarget.textContent = `Error: ${err.message}`;
    return false;
  } finally {
    button.disabled = false;
    // Nobody is working once the answer is back. The desk is not left lit to
    // show who answered — the result panel already says that, and a glowing
    // desk would claim work still in progress.
    setBusy(null);
  }
}

submitBtn.addEventListener('click', async () => {
  const text = taskInput.value.trim();
  if (!text) return;
  resultPanel.hidden = true;
  currentThreadId = null;
  const ok = await runTask({ text, statusTarget: statusEl, button: submitBtn });
  if (ok) taskInput.value = '';
});

replyBtn.addEventListener('click', async () => {
  const text = replyInput.value.trim();
  if (!text || !currentThreadId) return;
  await runTask({
    text,
    threadId: currentThreadId,
    statusTarget: replyStatus,
    button: replyBtn
  });
});

loadAgents();
loadNotes();
