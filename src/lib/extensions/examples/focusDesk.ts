// Example: a focus timer with notes and a checklist. Roleplay-free on purpose: rp is a place to build any small app.

import type { ExtensionBundle } from '../manifest'

const PANEL = String.raw`<div class="rp-stack" style="max-width:520px;margin:0 auto">
  <div class="rp-card rp-center" style="flex-direction:column;gap:10px;padding:22px">
    <div class="rp-label" id="mode">Focus</div>
    <div class="rp-big" id="clock" style="font-size:3.4rem">25:00</div>
    <div class="rp-bar" style="width:100%"><i id="bar" style="width:0%"></i></div>
    <div class="rp-row">
      <button class="rp-btn primary round" id="go" style="min-width:96px">Start</button>
      <button class="rp-btn ghost round" id="reset">Reset</button>
    </div>
    <div class="rp-muted" id="count" style="font-size:12px"></div>
  </div>
  <div class="rp-card rp-stack">
    <div class="rp-label">Today's tasks</div>
    <div class="rp-row"><input class="rp-input rp-grow" id="t" placeholder="Add a task…" maxlength="120"><button class="rp-btn" id="addT">Add</button></div>
    <div class="rp-stack" id="tasks"></div>
  </div>
  <div class="rp-card rp-stack">
    <div class="rp-label">Scratchpad</div>
    <textarea class="rp-input" id="notes" rows="6" placeholder="Notes, ideas, anything…" style="resize:vertical"></textarea>
    <div class="rp-muted" id="saved" style="font-size:12px;min-height:16px"></div>
  </div>
</div>
<style>
  .task{display:flex;align-items:center;gap:10px;padding:7px 4px}
  .task.done span{text-decoration:line-through;opacity:.5}
  .task span{flex:1;overflow-wrap:anywhere}
  .x{opacity:.4;cursor:pointer;background:none;border:0;color:inherit;font-size:16px}
  .x:hover{opacity:1}
</style>
<script>
(async function () {
  var info = await rp.ready;
  var $ = function (id) { return document.getElementById(id); };
  var focusSec = function () { return Math.max(1, Number(info.settings.focusMinutes) || 25) * 60; };
  var breakSec = function () { return Math.max(1, Number(info.settings.breakMinutes) || 5) * 60; };
  var st = { onBreak: false, left: focusSec(), total: focusSec(), running: false, done: 0 };
  var tasks = [], timer = null, noteTimer = null;

  function fmt(s) { var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  function paint() {
    $('clock').textContent = fmt(st.left);
    $('mode').textContent = st.onBreak ? 'Break' : 'Focus';
    $('bar').style.width = (100 * (1 - st.left / st.total)) + '%';
    $('go').textContent = st.running ? 'Pause' : 'Start';
    $('count').textContent = st.done ? st.done + ' focus session' + (st.done > 1 ? 's' : '') + ' today' : '';
  }
  function tick() {
    st.left--;
    if (st.left <= 0) {
      if (!st.onBreak) { st.done++; saveDone(); rp.notify('Focus session complete. Time for a break.', 'success'); }
      else rp.notify('Break over. Ready for another round?', 'info');
      st.onBreak = !st.onBreak; st.total = st.left = st.onBreak ? breakSec() : focusSec();
      stop();
    }
    paint();
  }
  function stop() { st.running = false; clearInterval(timer); timer = null; }
  $('go').onclick = function () { if (st.running) stop(); else { st.running = true; timer = setInterval(tick, 1000); } paint(); };
  $('reset').onclick = function () { stop(); st.onBreak = false; st.total = st.left = focusSec(); paint(); };

  function today() { return new Date().toISOString().slice(0, 10); }
  async function saveDone() { try { await rp.storage.set('done', { day: today(), n: st.done }); } catch (e) {} }
  async function saveTasks() { try { await rp.storage.set('tasks', tasks); } catch (e) { rp.notify(e.message, 'error'); } }
  function drawTasks() {
    var box = $('tasks'); box.innerHTML = '';
    tasks.forEach(function (t) {
      var row = document.createElement('div'); row.className = 'task' + (t.done ? ' done' : '');
      var c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!t.done;
      var s = document.createElement('span'); s.textContent = t.text;
      var x = document.createElement('button'); x.className = 'x'; x.textContent = '×';
      c.onchange = function () { t.done = c.checked; saveTasks(); drawTasks(); };
      x.onclick = function () { tasks = tasks.filter(function (o) { return o !== t; }); saveTasks(); drawTasks(); };
      row.append(c, s, x); box.appendChild(row);
    });
  }
  function addTask() { var v = $('t').value.trim(); if (!v) return; tasks.push({ text: v, done: false }); $('t').value = ''; saveTasks(); drawTasks(); }
  $('addT').onclick = addTask;
  $('t').onkeydown = function (e) { if (e.key === 'Enter') addTask(); };
  $('notes').oninput = function () {
    $('saved').textContent = 'Saving…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async function () { try { await rp.storage.set('notes', $('notes').value); $('saved').textContent = 'Saved'; } catch (e) { $('saved').textContent = e.message; } }, 600);
  };
  rp.on('settings', function (s) { info.settings = s; if (!st.running) { st.total = st.left = st.onBreak ? breakSec() : focusSec(); paint(); } });

  try {
    tasks = (await rp.storage.get('tasks')) || [];
    $('notes').value = (await rp.storage.get('notes')) || '';
    var d = await rp.storage.get('done');
    if (d && d.day === today()) st.done = d.n;
  } catch (e) {}
  drawTasks(); paint();
})();
</script>`

export const focusDesk: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'focus-desk',
    name: 'Focus Desk',
    version: '1.0.0',
    description: 'A pomodoro timer, a task list and a scratchpad. Nothing to do with roleplay: a sign that rp can host any small app.',
    author: 'rp',
    glyph: '◔',
    api: 1,
    permissions: [],
    panels: [{ id: 'desk', title: 'Focus Desk', glyph: '◔', entry: 'panel.html', slots: ['view'] }],
    hooks: [],
    tools: [],
    settings: [
      { key: 'focusMinutes', type: 'number', label: 'Focus minutes', default: 25 },
      { key: 'breakMinutes', type: 'number', label: 'Break minutes', default: 5 },
    ],
  },
  files: { 'panel.html': PANEL },
}
