// Example: a per-chat quest journal. Shows a panel plus a script whose `context` hook feeds quests into the prompt.

import type { ExtensionBundle } from '../manifest'

const PANEL = String.raw`<div class="rp-stack">
  <div class="rp-row"><input class="rp-input rp-grow" id="q" placeholder="A new quest…" maxlength="120"><button class="rp-btn primary" id="add">Add</button></div>
  <div class="rp-stack" id="list"></div>
  <p class="rp-muted" id="empty" style="margin:0">No quests yet. Whatever you add here, the character will keep in mind.</p>
</div>
<style>
  .quest{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:12px;background:rgb(var(--c-bg-sunken))}
  .quest.done span{text-decoration:line-through;opacity:.55}
  .quest span{flex:1;min-width:0;overflow-wrap:anywhere}
  .x{opacity:.45;cursor:pointer;background:none;border:0;color:inherit;font-size:16px}
  .x:hover{opacity:1}
</style>
<script>
(async function () {
  var info = await rp.ready;
  var quests = [];
  var $ = function (id) { return document.getElementById(id); };
  var canRemember = info.permissions.indexOf('lore.write') >= 0;

  async function load() { try { quests = (await rp.storage.get('quests', 'chat')) || []; } catch (e) { quests = []; $('empty').textContent = 'Open a chat to keep a quest journal.'; } render(); }
  async function save() { try { await rp.storage.set('quests', quests, 'chat'); } catch (e) { rp.notify(e.message, 'error'); } }

  function render() {
    var list = $('list');
    list.innerHTML = '';
    quests.forEach(function (q) {
      var row = document.createElement('div');
      row.className = 'quest' + (q.done ? ' done' : '');
      var box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!q.done;
      var text = document.createElement('span'); text.textContent = q.text;
      var x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
      box.onchange = async function () {
        q.done = box.checked;
        if (q.done) {
          rp.notify('Quest complete: ' + q.text, 'success');
          if (canRemember) { try { await rp.facts.add('The player completed the quest: ' + q.text, 0.7); } catch (e) { rp.log(e.message); } }
        }
        await save(); render();
      };
      x.onclick = async function () { quests = quests.filter(function (o) { return o !== q; }); await save(); render(); };
      row.append(box, text, x);
      list.appendChild(row);
    });
    $('empty').style.display = quests.length ? 'none' : 'block';
  }
  async function add() {
    var v = $('q').value.trim();
    if (!v) return;
    quests.unshift({ text: v, done: false });
    $('q').value = '';
    await save(); render();
  }
  $('add').onclick = add;
  $('q').onkeydown = function (e) { if (e.key === 'Enter') add(); };
  rp.on('chat', load);
  load();
})();
</script>`

const SCRIPT = String.raw`// Runs in a background worker. The context hook adds open quests to the prompt each turn.
rp.hook('context', async function () {
  var quests;
  try { quests = await rp.storage.get('quests', 'chat'); } catch (e) { return null; }
  var open = (quests || []).filter(function (q) { return !q.done; }).map(function (q) { return '- ' + q.text; });
  if (!open.length) return null;
  return { label: 'quests', text: 'Quests the player is pursuing (bring them up naturally, only when relevant):\n' + open.join('\n') };
});
`

export const questJournal: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'quest-journal',
    name: 'Quest Journal',
    version: '1.0.0',
    description: 'Track quests per chat. Open quests are added to the prompt, and finishing one is remembered as a fact.',
    author: 'rp',
    glyph: '✦',
    api: 1,
    permissions: ['hooks', 'lore.write'],
    panels: [{ id: 'journal', title: 'Quests', glyph: '✦', entry: 'panel.html', slots: ['chat', 'view'] }],
    script: 'main.js',
    hooks: ['context'],
    tools: [],
    settings: [],
  },
  files: { 'panel.html': PANEL, 'main.js': SCRIPT },
}
