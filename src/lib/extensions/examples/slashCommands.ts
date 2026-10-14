// Example: slash commands in the message box (/roll, /me, /ooc, /gm, /time, /remember, /note). An input hook plus a context hook.

import type { ExtensionBundle } from '../manifest'
import { DICE_LIB } from './diceLib'

const COMMANDS: [string, string][] = [
  ['/roll 2d6+3 [why]', 'Roll dice (d20, 4d6kh3, d20 adv). The result goes to the story as part of your message.'],
  ['/me text', 'Write an action: *text*.'],
  ['/ooc text', 'Speak out of character: (OOC: text).'],
  ['/gm text', 'Give the AI a direction for its next reply without a character saying it.'],
  ['/time 3 hours later', 'Mark a time skip.'],
  ['/remember text', 'Save a fact to this chat\'s memory. Nothing is sent.'],
  ['/note text', 'Add a standing note the AI sees every turn. /note clear, /note remove 2.'],
  ['/help', 'Show this list.'],
]

const SCRIPT = DICE_LIB + String.raw`
var LIST = ${JSON.stringify(COMMANDS.map((c) => c[0]))};

async function getNotes() {
  try { return (await rp.storage.get('notes', 'chat')) || []; } catch (e) { return []; }
}

rp.hook('input', async function (p) {
  var m = /^\/([a-z]+)\b[ \t]*([\s\S]*)$/i.exec(p.text.trim());
  if (!m) return null;
  var cmd = m[1].toLowerCase(), arg = m[2].trim();

  if (cmd === 'roll' || cmd === 'r') {
    var parsed = Dice.parse(arg || 'd20');
    if (!parsed) return { cancel: true, reason: 'Could not read "' + arg + '". Try /roll 2d6+3 or /roll d20 adv.' };
    var r = Dice.roll(parsed);
    return '*rolls' + (parsed.rest ? ' ' + parsed.rest : '') + '* (' + r.text.replace(/= (-?\d+)/, '= **$1**') + ')';
  }
  if (cmd === 'me') return arg ? '*' + arg.replace(/^\*+|\*+$/g, '') + '*' : { cancel: true, reason: 'Say what you do: /me smiles and waves.' };
  if (cmd === 'ooc') return arg ? '(OOC: ' + arg + ')' : { cancel: true, reason: 'Add your out-of-character message: /ooc brb.' };
  if (cmd === 'gm') return arg ? '[Direction for the next reply, not spoken by anyone in the story: ' + arg + ']' : { cancel: true, reason: 'Tell the AI what should happen: /gm a storm rolls in.' };
  if (cmd === 'time' || cmd === 'skip') return '*(Time passes: ' + (arg || 'a little while') + '.)*';

  if (cmd === 'remember' || cmd === 'mem') {
    if (!arg) return { cancel: true, reason: 'Say what to remember: /remember she is allergic to cats.' };
    await rp.facts.add(arg, 0.8);
    return { cancel: true, reason: 'Remembered: ' + arg };
  }

  if (cmd === 'note' || cmd === 'notes') {
    var notes = await getNotes();
    var rm = /^remove\s+(\d+)$/i.exec(arg);
    if (/^clear$/i.test(arg)) { await rp.storage.set('notes', [], 'chat'); return { cancel: true, reason: 'Notes cleared.' }; }
    if (rm) {
      var i = parseInt(rm[1], 10) - 1;
      if (!notes[i]) return { cancel: true, reason: 'No note number ' + rm[1] + '.' };
      var gone = notes.splice(i, 1)[0];
      await rp.storage.set('notes', notes, 'chat');
      return { cancel: true, reason: 'Removed: ' + gone };
    }
    if (!arg) return { cancel: true, reason: notes.length ? notes.map(function (n, k) { return (k + 1) + '. ' + n; }).join('  ') : 'No notes yet. /note the party is hiding from the guards.' };
    notes.push(arg.slice(0, 300));
    await rp.storage.set('notes', notes.slice(-12), 'chat');
    return { cancel: true, reason: 'Noted (' + Math.min(notes.length, 12) + '): ' + arg };
  }

  if (cmd === 'help') return { cancel: true, reason: LIST.join('   ') };

  var settings = await rp.settings.all();
  if (settings.warnUnknown === false) return null;
  return { cancel: true, reason: 'Unknown command /' + cmd + '. Try /help.' };
});

rp.tool('roll_dice', function (a) {
  var p = Dice.parse(String((a && a.notation) || 'd20'));
  if (!p) throw new Error('Not a dice expression: ' + (a && a.notation));
  var r = Dice.roll(p);
  return { total: r.total, detail: r.text };
});

rp.hook('context', async function () {
  var notes = await getNotes();
  if (!notes.length) return null;
  return { label: 'notes', text: 'Standing notes from the player for this story (follow them):\n' + notes.map(function (n) { return '- ' + n; }).join('\n') };
});
`

const PANEL = String.raw`<div class="rp-stack">
  <div class="rp-card rp-stack">
    <div class="rp-label">Quick roll</div>
    <div class="rp-row rp-wrap" id="presets"></div>
    <div class="rp-row"><input class="rp-input rp-grow" id="expr" placeholder="2d6+3 to pick the lock" maxlength="60"><button class="rp-btn primary" id="go">Roll</button></div>
    <div class="rp-muted" id="out" style="min-height:20px;font-size:13px"></div>
  </div>
  <div class="rp-card rp-stack">
    <div class="rp-label">Standing notes</div>
    <div class="rp-stack" id="notes"></div>
    <div class="rp-row"><input class="rp-input rp-grow" id="nt" placeholder="Something the AI should always keep in mind…" maxlength="300"><button class="rp-btn" id="addNote">Add</button></div>
  </div>
  <div class="rp-card rp-stack">
    <div class="rp-label">Commands</div>
    <div id="cmds" class="rp-stack" style="gap:6px"></div>
  </div>
</div>
<style>
  .cmd{display:flex;flex-direction:column;gap:1px;font-size:13px}
  .cmd code{color:rgb(var(--c-accent));font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
  .note{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;background:rgb(var(--c-bg-sunken))}
  .note span{flex:1;overflow-wrap:anywhere}
  .x{opacity:.45;cursor:pointer;background:none;border:0;color:inherit;font-size:16px}
  .x:hover{opacity:1}
</style>
<script>
` + DICE_LIB + String.raw`
(async function () {
  await rp.ready;
  var $ = function (id) { return document.getElementById(id); };
  var CMDS = ${JSON.stringify(COMMANDS.map((c) => [c[0], c[1]]))};
  var notes = [];

  CMDS.forEach(function (c) {
    var row = document.createElement('div'); row.className = 'cmd';
    var code = document.createElement('code'); code.textContent = c[0];
    var d = document.createElement('span'); d.className = 'rp-muted'; d.textContent = c[1];
    row.append(code, d); $('cmds').appendChild(row);
  });

  async function send(text) {
    try { await rp.chat.send(text); } catch (e) { rp.notify(e.message, 'error'); }
  }
  ['d20', 'd20 adv', 'd20 dis', 'd6', '2d6', 'd100'].forEach(function (p) {
    var b = document.createElement('button'); b.className = 'rp-btn'; b.textContent = p;
    b.onclick = function () { send('/roll ' + p); };
    $('presets').appendChild(b);
  });
  function roll() {
    var v = $('expr').value.trim() || 'd20';
    if (!Dice.parse(v)) { $('out').textContent = 'Could not read "' + v + '".'; return; }
    $('out').textContent = 'Sending…';
    send('/roll ' + v).then(function () { $('out').textContent = ''; });
  }
  $('go').onclick = roll;
  $('expr').onkeydown = function (e) { if (e.key === 'Enter') roll(); };

  async function loadNotes() { try { notes = (await rp.storage.get('notes', 'chat')) || []; } catch (e) { notes = []; } renderNotes(); }
  async function saveNotes() { try { await rp.storage.set('notes', notes, 'chat'); } catch (e) { rp.notify(e.message, 'error'); } }
  function renderNotes() {
    var box = $('notes'); box.innerHTML = '';
    if (!notes.length) { var p = document.createElement('div'); p.className = 'rp-muted'; p.style.fontSize = '13px'; p.textContent = 'None yet. The AI sees these every turn.'; box.appendChild(p); }
    notes.forEach(function (n, i) {
      var row = document.createElement('div'); row.className = 'note';
      var t = document.createElement('span'); t.textContent = n;
      var x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
      x.onclick = async function () { notes.splice(i, 1); await saveNotes(); renderNotes(); };
      row.append(t, x); box.appendChild(row);
    });
  }
  $('addNote').onclick = async function () {
    var v = $('nt').value.trim(); if (!v) return;
    notes.push(v.slice(0, 300)); notes = notes.slice(-12); $('nt').value = '';
    await saveNotes(); renderNotes();
  };
  $('nt').onkeydown = function (e) { if (e.key === 'Enter') $('addNote').onclick(); };
  rp.on('chat', loadNotes);
  loadNotes();
})();
</script>`

export const slashCommands: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'slash-commands',
    name: 'Slash Commands',
    version: '1.0.0',
    description: 'Type /roll, /me, /ooc, /gm, /time, /remember or /note in the message box. Includes standing notes the AI sees every turn.',
    author: 'rp',
    glyph: '/',
    api: 1,
    permissions: ['hooks', 'chat.write', 'lore.write', 'tools.provide'],
    panels: [{ id: 'commands', title: 'Commands', glyph: '/', entry: 'panel.html', slots: ['chat', 'view'] }],
    script: 'main.js',
    hooks: ['input', 'context'],
    tools: [
      {
        name: 'roll_dice',
        description: 'Roll dice in standard notation, for example 2d6+3, d20 adv or 4d6kh3.',
        parameters: { type: 'object', properties: { notation: { type: 'string', description: 'Dice expression, e.g. 2d6+3' } }, required: ['notation'] },
      },
    ],
    settings: [{ key: 'warnUnknown', type: 'boolean', label: 'Block unknown /commands', hint: 'Off sends them to the AI as ordinary text.', default: true }],
  },
  files: { 'panel.html': PANEL, 'main.js': SCRIPT },
}
