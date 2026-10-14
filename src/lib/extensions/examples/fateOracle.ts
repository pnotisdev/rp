// Example: solo-GM tools. A yes/no oracle with a chaos factor, random events, scene checks, thread and cast lists, and a hook that works events into the next reply.

import type { ExtensionBundle } from '../manifest'

/** Odds, tables and rolling. Runs in both the background script and the panel. */
export const FATE_LIB = String.raw`
var Fate = (function () {
  var ODDS = ['Impossible', 'Very unlikely', 'Unlikely', 'Somewhat unlikely', '50/50', 'Somewhat likely', 'Likely', 'Very likely', 'Near certain'];
  var BASE = [3, 10, 25, 40, 50, 60, 75, 90, 97];
  var ACTIONS = ['Abandon', 'Befriend', 'Betray', 'Bring', 'Challenge', 'Conceal', 'Deceive', 'Defend', 'Delay', 'Demand', 'Destroy', 'Discover', 'Endanger', 'Escape', 'Expose', 'Gather', 'Guard', 'Hunt', 'Imprison', 'Invite', 'Lose', 'Mislead', 'Oppose', 'Plead', 'Pursue', 'Repair', 'Rescue', 'Return', 'Reveal', 'Sacrifice', 'Search', 'Seize', 'Steal', 'Summon', 'Threaten', 'Trade', 'Trap', 'Warn', 'Withdraw', 'Wound'];
  var SUBJECTS = ['Alliance', 'Ambition', 'Ancestry', 'Bargain', 'Blood', 'Burden', 'Celebration', 'Contest', 'Debt', 'Disguise', 'Duty', 'Enemy', 'Fear', 'Fire', 'Gift', 'Guilt', 'Hunger', 'Journey', 'Law', 'Letter', 'Map', 'Memory', 'Message', 'Oath', 'Omen', 'Passage', 'Plague', 'Prize', 'Rumor', 'Secret', 'Shadow', 'Storm', 'Stranger', 'Tool', 'Treasure', 'Trust', 'Vow', 'Weapon', 'Weather', 'Witness'];
  var FOCUS = [[7, 'Remote event'], [28, 'NPC action'], [35, 'New NPC'], [45, 'Move toward a thread'], [52, 'Move away from a thread'], [55, 'Close a thread'], [67, 'Player character negative'], [75, 'Player character positive'], [83, 'Ambiguous event'], [92, 'NPC negative'], [100, 'NPC positive']];

  function d(n) { return 1 + Math.floor(Math.random() * n); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function chance(odds, chaos) { return clamp(BASE[odds] + (chaos - 5) * 4, 3, 97); }

  // Answers a yes/no question. Doubles (11, 22 ...) whose digit is within the chaos factor also trigger a random event.
  function ask(odds, chaos) {
    var p = chance(odds, chaos), r = d(100);
    var yes = r <= p;
    var strong = yes ? r <= Math.floor(p / 5) : r > 100 - Math.floor((100 - p) / 5);
    return { p: p, r: r, yes: yes, strong: strong, answer: (yes ? 'Yes' : 'No') + (strong ? ' (exceptional)' : ''), event: r % 11 === 0 && r / 11 <= chaos };
  }

  // A random event: a focus, two meaning words, and a thread or character from the lists when the focus calls for one.
  function event(state) {
    var roll = d(100), focus = FOCUS.filter(function (f) { return roll <= f[0]; })[0][1];
    var who = '';
    var threads = state.threads.filter(function (t) { return !t.done; });
    if (/thread/i.test(focus) && threads.length) who = pick(threads).text;
    else if (/NPC/.test(focus) && !/New/.test(focus) && state.npcs.length) who = pick(state.npcs).text;
    var a = pick(ACTIONS), s = pick(SUBJECTS);
    return { focus: focus, action: a, subject: s, who: who, text: focus + (who ? ' (' + who + ')' : '') + ': ' + a + ' / ' + s };
  }

  // Does the next scene go as planned? A d10 at or under the chaos factor changes it: odd alters it, even interrupts it.
  function scene(chaos) {
    var r = d(10);
    if (r > chaos) return { r: r, kind: 'expected', text: 'The scene goes as expected.' };
    return r % 2 ? { r: r, kind: 'altered', text: 'Altered scene: change one thing about what was expected.' } : { r: r, kind: 'interrupted', text: 'Interrupted scene: something unexpected takes its place.' };
  }

  function blank() { return { chaos: 5, threads: [], npcs: [], log: [], pending: null, injected: false }; }
  function normalize(f) {
    var b = blank(), o = f || {};
    b.chaos = clamp(parseInt(o.chaos, 10) || 5, 1, 9);
    b.threads = (Array.isArray(o.threads) ? o.threads : []).filter(function (t) { return t && t.text; }).slice(0, 30);
    b.npcs = (Array.isArray(o.npcs) ? o.npcs : []).filter(function (t) { return t && t.text; }).slice(0, 30);
    b.log = (Array.isArray(o.log) ? o.log : []).slice(-30);
    b.pending = o.pending && o.pending.text ? { kind: String(o.pending.kind || 'event'), text: String(o.pending.text).slice(0, 300) } : null;
    b.injected = !!o.injected;
    return b;
  }
  async function load() { return normalize(await rp.storage.get('fate', 'chat')); }
  function save(f) { return rp.storage.set('fate', f, 'chat'); }
  function say(f, text) { f.log.push({ t: Date.now(), text: text }); f.log = f.log.slice(-30); }
  function uid() { return Math.random().toString(36).slice(2, 9); }

  // What the AI is told about a queued result.
  function instruction(p) {
    if (p.kind === 'oracle') return 'The player asked the oracle a question. ' + p.text + ' Treat that as true in the story and continue from it.';
    if (p.kind === 'scene') return 'For the coming scene: ' + p.text + ' Let the story reflect that.';
    return 'A random event shakes up the story now: ' + p.text + '. Work it into your next reply naturally, inside the fiction, without naming it as an event or explaining mechanics.';
  }
  return { ODDS: ODDS, ask: ask, event: event, scene: scene, chance: chance, load: load, save: save, say: say, uid: uid, instruction: instruction, normalize: normalize };
})();
`

const SCRIPT = FATE_LIB + String.raw`
async function logged(text, change) {
  var f = await Fate.load();
  Fate.say(f, text);
  if (change) change(f);
  await Fate.save(f);
}

rp.tool('ask_oracle', async function (a) {
  var f = await Fate.load();
  var want = String((a && a.likelihood) || '50/50').toLowerCase();
  var odds = Math.max(0, Fate.ODDS.map(function (o) { return o.toLowerCase(); }).indexOf(want));
  if (odds === 0 && want !== 'impossible') odds = 4;
  var r = Fate.ask(odds, f.chaos);
  var ev = r.event ? Fate.event(f) : null;
  await logged('Oracle (assistant): "' + String((a && a.question) || '') + '" - ' + r.answer);
  return { answer: r.answer, chancePercent: r.p, rolled: r.r, randomEvent: ev ? ev.text : null };
});

rp.tool('random_event', async function () {
  var f = await Fate.load();
  var ev = Fate.event(f);
  await logged('Event (assistant): ' + ev.text);
  return { event: ev.text };
});

rp.hook('context', async function () {
  var f = await Fate.load();
  var settings = await rp.settings.all();
  var out = [];
  if (f.pending) {
    out.push({ label: 'fate', text: Fate.instruction(f.pending) });
    if (!f.injected) { f.injected = true; await Fate.save(f); }
  }
  if (settings.injectLists !== false) {
    var threads = f.threads.filter(function (t) { return !t.done; }).map(function (t) { return t.text; });
    var cast = f.npcs.map(function (t) { return t.text; });
    var parts = [];
    if (threads.length) parts.push('Open plot threads: ' + threads.join('; ') + '.');
    if (cast.length) parts.push('Recurring characters: ' + cast.join('; ') + '.');
    if (parts.length) out.push({ label: 'story threads', text: parts.join(' ') });
  }
  return out.length ? out : null;
});

// A finished reply uses up a queued result; this is also where surprise events are rolled.
rp.hook('output', async function () {
  var f = await Fate.load();
  var settings = await rp.settings.all();
  var dirty = false;
  if (f.injected) { f.pending = null; f.injected = false; dirty = true; }
  var odds = Math.max(0, Math.min(100, parseInt(settings.eventChance, 10) || 0));
  if (odds && !f.pending && Math.random() * 100 < odds) {
    var ev = Fate.event(f);
    f.pending = { kind: 'event', text: ev.text };
    Fate.say(f, 'Surprise event queued: ' + ev.text);
    dirty = true;
    rp.notify('Fate stirs. Something is queued for the next reply.');
  }
  if (dirty) await Fate.save(f);
  return null;
});
`

const PANEL = String.raw`<div class="rp-stack" id="root"></div>
<style>
  .tabs{display:flex;gap:4px;flex-wrap:wrap}
  .tab{border:1px solid rgb(var(--c-border));background:transparent;color:rgb(var(--c-text-muted));border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px}
  .tab.on{background:rgb(var(--c-bg-sunken));color:rgb(var(--c-text))}
  .res{border:1px solid rgb(var(--c-border));border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:6px}
  .res .big{font-size:1.4rem;font-weight:600}
  .yes{color:rgb(var(--c-success))}.no{color:rgb(var(--c-danger))}
  .li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:rgb(var(--c-bg-sunken))}
  .li span{flex:1;overflow-wrap:anywhere}
  .li.done span{text-decoration:line-through;opacity:.5}
  .x{opacity:.45;cursor:pointer;background:none;border:0;color:inherit;font-size:16px}
  .x:hover{opacity:1}
  .log{font-size:12px;color:rgb(var(--c-text-muted));display:flex;flex-direction:column;gap:4px}
  .chaos{display:flex;align-items:center;gap:6px}
  .chaos b{min-width:18px;text-align:center}
</style>
<script>
` + FATE_LIB + String.raw`
(async function () {
  await rp.ready;
  var root = document.getElementById('root');
  var f = null, tab = 'oracle', odds = 4, question = '', sceneText = '', result = null;

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e[k] = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  async function reload() { try { f = await Fate.load(); } catch (e) { f = null; } render(); }
  async function change(fn) {
    try { var cur = await Fate.load(); fn(cur); await Fate.save(cur); f = cur; } catch (e) { rp.notify(e.message, 'error'); }
    render();
  }

  function rollOracle() {
    var r = Fate.ask(odds, f.chaos);
    var ev = r.event ? Fate.event(f) : null;
    var q = question.trim() || 'The oracle was asked';
    var line = '"' + q + '" - ' + r.answer + ' (' + Fate.ODDS[odds].toLowerCase() + ', ' + r.p + '% at chaos ' + f.chaos + ', rolled ' + r.r + ')' + (ev ? '. Random event: ' + ev.text : '');
    result = { kind: 'oracle', title: r.answer, tone: r.yes ? 'yes' : 'no', detail: line, ai: 'The answer to "' + q + '" is ' + r.answer.toLowerCase() + '.' + (ev ? ' Also, a random event occurs: ' + ev.text + '.' : ''), event: ev };
    change(function (c) { Fate.say(c, 'Oracle: ' + line); });
  }
  function rollEvent() {
    var ev = Fate.event(f);
    result = { kind: 'event', title: ev.focus, detail: ev.action + ' / ' + ev.subject + (ev.who ? ' - ' + ev.who : ''), ai: ev.text, event: ev };
    change(function (c) { Fate.say(c, 'Event: ' + ev.text); });
  }
  function rollScene() {
    var r = Fate.scene(f.chaos);
    var label = sceneText.trim();
    result = { kind: 'scene', title: r.kind === 'expected' ? 'As expected' : r.kind === 'altered' ? 'Altered scene' : 'Interrupted scene', tone: r.kind === 'expected' ? 'yes' : 'no', detail: r.text + (label ? ' (planned: ' + label + ')' : '') + ' Rolled ' + r.r + ' vs chaos ' + f.chaos + '.', ai: r.text + (label ? ' Planned scene: ' + label + '.' : '') };
    change(function (c) { Fate.say(c, 'Scene: ' + r.kind + (label ? ' - ' + label : '')); });
  }

  function shareRow() {
    if (!result) return null;
    var say = function () { return '(Fate: ' + result.detail + ')'; };
    return h('div', { class: 'rp-row rp-wrap' }, [
      h('button', { class: 'rp-btn primary', text: 'Queue for the AI', title: 'The AI is told this on its next reply', onclick: function () { change(function (c) { c.pending = { kind: result.kind, text: result.ai }; c.injected = false; }); rp.notify('Queued for the next reply.', 'success'); } }),
      h('button', { class: 'rp-btn', text: 'Add to chat', title: 'Posts it as an out-of-character note without a reply', onclick: function () { rp.chat.append(say(), { as: 'user' }).catch(function (e) { rp.notify(e.message, 'error'); }); } }),
      h('button', { class: 'rp-btn', text: 'Send and reply', onclick: function () { rp.chat.send(say()).catch(function (e) { rp.notify(e.message, 'error'); }); } })
    ]);
  }
  function resultCard() {
    if (!result) return null;
    var big = h('div', { class: 'big ' + (result.tone || ''), text: result.title });
    return h('div', { class: 'res' }, [big, h('div', { class: 'rp-muted', style: 'font-size:13px;overflow-wrap:anywhere', text: result.detail }), shareRow()]);
  }

  function listTab(key, placeholder, withDone) {
    var items = f[key];
    var box = h('div', { class: 'rp-stack', style: 'gap:6px' });
    items.forEach(function (it) {
      var row = h('div', { class: 'li' + (it.done ? ' done' : '') });
      if (withDone) { var cb = h('input', { type: 'checkbox' }); cb.checked = !!it.done; cb.onchange = function () { change(function (c) { c[key].filter(function (x) { return x.id === it.id; })[0].done = cb.checked; }); }; row.appendChild(cb); }
      row.append(h('span', { text: it.text }), h('button', { class: 'x', text: '×', title: 'Remove', onclick: function () { change(function (c) { c[key] = c[key].filter(function (x) { return x.id !== it.id; }); }); } }));
      box.appendChild(row);
    });
    if (!items.length) box.appendChild(h('div', { class: 'rp-muted', style: 'font-size:13px', text: withDone ? 'No threads yet. A thread is a goal or mystery the story is pursuing.' : 'No one yet. Add recurring characters so events can involve them.' }));
    var input = h('input', { class: 'rp-input rp-grow', placeholder: placeholder, maxlength: '80' });
    var add = function () { var v = input.value.trim(); if (v) change(function (c) { c[key].push({ id: Fate.uid(), text: v.slice(0, 80), done: false }); }); };
    input.onkeydown = function (e) { if (e.key === 'Enter') add(); };
    return h('div', { class: 'rp-stack' }, [box, h('div', { class: 'rp-row' }, [input, h('button', { class: 'rp-btn', text: 'Add', onclick: add })])]);
  }

  function render() {
    root.innerHTML = '';
    if (!f) { root.appendChild(h('p', { class: 'rp-muted', text: 'Open a chat to use the oracle.' })); return; }
    var chaos = h('div', { class: 'chaos', title: 'Chaos factor: higher means more surprises and more yes answers' }, [
      h('span', { class: 'rp-label', text: 'Chaos' }),
      h('button', { class: 'rp-btn step', text: '-', onclick: function () { change(function (c) { c.chaos = Math.max(1, c.chaos - 1); }); } }),
      h('b', { text: String(f.chaos) }),
      h('button', { class: 'rp-btn step', text: '+', onclick: function () { change(function (c) { c.chaos = Math.min(9, c.chaos + 1); }); } })]);
    var tabs = h('div', { class: 'tabs rp-grow' }, [['oracle', 'Oracle'], ['scene', 'Scene'], ['threads', 'Threads'], ['cast', 'Cast'], ['log', 'Log']].map(function (t) {
      return h('button', { class: 'tab' + (tab === t[0] ? ' on' : ''), text: t[1], onclick: function () { tab = t[0]; render(); } });
    }));
    root.appendChild(h('div', { class: 'rp-row rp-wrap', style: 'justify-content:space-between' }, [tabs, chaos]));
    if (f.pending) root.appendChild(h('div', { class: 'rp-chip', style: 'align-self:flex-start', text: 'Queued: ' + f.pending.text.slice(0, 70) }));

    if (tab === 'oracle') {
      var q = h('input', { class: 'rp-input rp-grow', placeholder: 'Is the door locked?', maxlength: '120' }); q.value = question; q.oninput = function () { question = q.value; };
      q.onkeydown = function (e) { if (e.key === 'Enter') rollOracle(); };
      var sel = h('select', { class: 'rp-input rp-grow', style: 'min-width:140px' }, Fate.ODDS.map(function (o, i) { return h('option', { value: String(i), text: o + ' (' + Fate.chance(i, f.chaos) + '%)' }); }));
      sel.value = String(odds); sel.onchange = function () { odds = parseInt(sel.value, 10); };
      root.appendChild(h('div', { class: 'rp-stack' }, [h('div', { class: 'rp-row' }, [q]), h('div', { class: 'rp-row' }, [sel]), h('div', { class: 'rp-row rp-wrap' }, [h('button', { class: 'rp-btn primary', text: 'Ask the oracle', onclick: rollOracle }), h('button', { class: 'rp-btn', text: 'Random event', onclick: rollEvent })])]));
    } else if (tab === 'scene') {
      var sc = h('input', { class: 'rp-input rp-grow', placeholder: 'What do you expect to happen next?', maxlength: '120' }); sc.value = sceneText; sc.oninput = function () { sceneText = sc.value; };
      root.appendChild(h('div', { class: 'rp-stack' }, [h('div', { class: 'rp-row' }, [sc]), h('div', { class: 'rp-row rp-wrap' }, [h('button', { class: 'rp-btn primary', text: 'Check the scene', onclick: rollScene }),
        h('button', { class: 'rp-btn ghost', text: 'In control: chaos -1', onclick: function () { change(function (c) { c.chaos = Math.max(1, c.chaos - 1); }); } }),
        h('button', { class: 'rp-btn ghost', text: 'Out of control: chaos +1', onclick: function () { change(function (c) { c.chaos = Math.min(9, c.chaos + 1); }); } })])]));
    } else if (tab === 'threads') {
      root.appendChild(listTab('threads', 'Find the missing ledger…', true));
    } else if (tab === 'cast') {
      root.appendChild(listTab('npcs', 'Captain Voss, suspicious of the party…', false));
    } else {
      var log = h('div', { class: 'log' });
      f.log.slice().reverse().forEach(function (l) { log.appendChild(h('div', { text: new Date(l.t).toLocaleTimeString() + '  ' + l.text })); });
      if (!f.log.length) log.appendChild(h('div', { text: 'Nothing rolled yet.' }));
      root.appendChild(log);
    }
    if (tab === 'oracle' || tab === 'scene') root.appendChild(resultCard());
  }

  rp.on('chat', function () { result = null; reload(); });
  rp.on('turn', function (e) { if (e && e.phase === 'end') setTimeout(reload, 800); });
  reload();
})();
</script>`

export const fateOracle: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'fate-oracle',
    name: 'Fate Oracle',
    version: '1.0.0',
    description: 'Solo-GM tools: a yes/no oracle with odds and a chaos factor, random events, scene checks, plot threads and a cast list. Queue a result and the AI works it into its next reply.',
    author: 'rp',
    glyph: '☍',
    api: 1,
    permissions: ['hooks', 'chat.read', 'chat.write', 'tools.provide'],
    panels: [{ id: 'oracle', title: 'Fate Oracle', glyph: '☍', entry: 'oracle.html', slots: ['chat', 'view'] }],
    script: 'main.js',
    hooks: ['context', 'output'],
    tools: [
      {
        name: 'ask_oracle',
        description: 'Ask the story oracle a yes/no question. Returns yes or no (sometimes exceptional) and maybe a random event.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'A yes/no question about the story' },
            likelihood: { type: 'string', description: 'One of: impossible, very unlikely, unlikely, somewhat unlikely, 50/50, somewhat likely, likely, very likely, near certain' },
          },
          required: ['question'],
        },
      },
      { name: 'random_event', description: 'Draw a random story event (a focus plus two meaning words) to inspire a twist.', parameters: { type: 'object', properties: {} } },
    ],
    settings: [
      { key: 'eventChance', type: 'number', label: 'Surprise event chance per reply (%)', hint: '0 is off. A hit queues a random event for the next reply.', default: 0 },
      { key: 'injectLists', type: 'boolean', label: 'Tell the AI about open threads and the cast', default: true },
    ],
  },
  files: { 'oracle.html': PANEL, 'main.js': SCRIPT },
}
