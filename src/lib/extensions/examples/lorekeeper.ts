// Example: an automatic story codex. Reads the chat every few replies, proposes new people/places/lore, and feeds relevant entries back into the prompt.

import type { ExtensionBundle } from '../manifest'
import { JSON_LIB } from './jsonLib'

/** Codex storage, model extraction and keyword matching. Runs in both the background script and the panel. */
const CODEX_LIB = JSON_LIB + String.raw`
var Codex = (function () {
  var KINDS = ['person', 'place', 'faction', 'item', 'lore'];
  function uid() { return Math.random().toString(36).slice(2, 9); }
  async function load() {
    var c = await rp.storage.get('codex', 'chat');
    return c && Array.isArray(c.entries) ? c : { entries: [], turns: 0, last: 0 };
  }
  function save(c) { return rp.storage.set('codex', c, 'chat'); }
  function words(list) { return list.map(function (s) { return String(s).trim().slice(0, 40); }).filter(Boolean).slice(0, 8); }

  // Turns the model's raw list into entries we do not already have.
  function fresh(list, known, status) {
    var have = {};
    known.forEach(function (e) { have[e.name.toLowerCase()] = true; });
    var out = [];
    (Array.isArray(list) ? list : []).slice(0, 6).forEach(function (r) {
      if (!r || typeof r.name !== 'string' || typeof r.text !== 'string') return;
      var name = r.name.trim().slice(0, 60), text = r.text.trim().slice(0, 400);
      if (!name || !text || have[name.toLowerCase()]) return;
      have[name.toLowerCase()] = true;
      out.push({ id: uid(), name: name, kind: KINDS.indexOf(r.kind) >= 0 ? r.kind : 'lore', text: text, keys: words(Array.isArray(r.keys) ? r.keys : []), status: status, pinned: false, at: Date.now() });
    });
    return out;
  }

  var SYSTEM = 'You keep a codex for an ongoing story. From the excerpt, extract NEW named people, places, factions, notable items, or established rules and facts that will matter later. Skip anything already in the codex, anything generic, and the two main speakers themselves. Reply with ONLY a JSON array of at most 6 objects like {"name":"...","kind":"person|place|faction|item|lore","text":"one or two factual sentences","keys":["alias"]}. Reply [] if nothing is new.';

  async function extract(opts) {
    opts = opts || {};
    var msgs = await rp.chat.messages(opts.window || 14);
    if (msgs.length < 2) return { added: 0 };
    var known = (await load()).entries.map(function (e) { return e.name; });
    var convo = msgs.map(function (m) { return m.name + ': ' + String(m.text).slice(0, 700); }).join('\n\n').slice(-7000);
    var reply = await rp.generate('Story excerpt:\n\n' + convo + '\n\nAlready in the codex: ' + (known.join(', ') || 'nothing') + '\n\nJSON array of new entries only:', { system: SYSTEM, maxTokens: 700, temperature: 0.3 });
    var list = parseLoose(reply);
    if (!Array.isArray(list)) throw new Error('The model did not return a list. Try again.');
    var c = await load();
    var added = fresh(list, c.entries, opts.autoApprove ? 'active' : 'pending');
    c.entries = c.entries.concat(added);
    c.last = Date.now();
    await save(c);
    return { added: added.length };
  }

  function esc(s) { return s.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&'); }
  // Active entries whose name or keys appear in the text (plus pinned ones), best matches first, within a character budget.
  function relevant(entries, haystack, budget) {
    var text = haystack.toLowerCase();
    var scored = [];
    entries.forEach(function (e) {
      if (e.status !== 'active') return;
      var score = e.pinned ? 0.5 : 0;
      [e.name].concat(e.keys || []).forEach(function (k) {
        if (k && new RegExp('(^|[^a-z0-9])' + esc(k.toLowerCase()) + '($|[^a-z0-9])').test(text)) score += 1;
      });
      if (score > 0) scored.push({ e: e, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score || b.e.at - a.e.at; });
    var lines = [], used = 0;
    for (var i = 0; i < scored.length; i++) {
      var e2 = scored[i].e, line = '- ' + e2.name + ' (' + e2.kind + '): ' + e2.text;
      if (used + line.length > budget) break;
      lines.push(line); used += line.length + 1;
    }
    return lines;
  }
  return { KINDS: KINDS, uid: uid, load: load, save: save, extract: extract, relevant: relevant, fresh: fresh, words: words };
})();
`

const SCRIPT = CODEX_LIB + String.raw`
var busy = false;

rp.on('turn', async function (e) {
  if (!e || e.phase !== 'end' || busy) return;
  var st = await rp.settings.all();
  var every = Math.max(0, parseInt(st.scanEvery, 10) || 0);
  if (!every) return;
  var c = await Codex.load();
  c.turns = (c.turns || 0) + 1;
  if (c.turns < every) { await Codex.save(c); return; }
  c.turns = 0;
  await Codex.save(c);
  busy = true;
  try {
    var r = await Codex.extract({ autoApprove: !!st.autoApprove });
    if (r.added) rp.notify('Found ' + r.added + ' new codex ' + (r.added === 1 ? 'entry' : 'entries') + (st.autoApprove ? '.' : ' to review.'));
  } catch (err) {
    rp.log('Codex scan failed: ' + err.message);
  } finally { busy = false; }
});

rp.hook('context', async function (p) {
  var c = await Codex.load();
  if (!c.entries.length) return null;
  var st = await rp.settings.all();
  var recent = [];
  try { recent = await rp.chat.messages(4); } catch (e) {}
  var haystack = (p.lastUserText || '') + '\n' + recent.map(function (m) { return m.text; }).join('\n');
  var lines = Codex.relevant(c.entries, haystack, Math.min(1100, Math.max(200, parseInt(st.budget, 10) || 1000)));
  if (!lines.length) return null;
  return { label: 'codex', text: 'Established facts about this story. Stay consistent with them:\n' + lines.join('\n') };
});
`

const PANEL = String.raw`<div class="rp-stack" id="root"></div>
<style>
  .tabs{display:flex;gap:4px;flex-wrap:wrap}
  .tab{border:1px solid rgb(var(--c-border));background:transparent;color:rgb(var(--c-text-muted));border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px}
  .tab.on{background:rgb(var(--c-bg-sunken));color:rgb(var(--c-text))}
  .entry{border:1px solid rgb(var(--c-border));border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px}
  .entry.muted{opacity:.55}
  .top{display:flex;align-items:center;gap:8px}
  .top b{flex:1;overflow-wrap:anywhere}
  .keys{font-size:12px;color:rgb(var(--c-text-muted))}
  .ico{background:none;border:0;color:rgb(var(--c-text-muted));cursor:pointer;font-size:14px;padding:2px 4px}
  .ico:hover,.ico.on{color:rgb(var(--c-accent))}
  textarea.rp-input{resize:vertical;min-height:60px}
  .err{color:rgb(var(--c-danger));font-size:13px}
</style>
<script>
` + CODEX_LIB + String.raw`
(async function () {
  var info = await rp.ready;
  var root = document.getElementById('root');
  var codex = null, tab = 'review', kind = 'all', editing = null, scanning = false, error = '';

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
  async function reload() {
    try { codex = await Codex.load(); } catch (e) { codex = null; }
    render();
  }
  async function mutate(fn) {
    try { var c = await Codex.load(); fn(c); await Codex.save(c); codex = c; } catch (e) { error = e.message; }
    render();
  }
  function byId(c, id) { return c.entries.filter(function (e) { return e.id === id; })[0]; }

  async function scan() {
    scanning = true; error = ''; render();
    try {
      var r = await Codex.extract({ autoApprove: !!info.settings.autoApprove });
      if (!r.added) rp.notify('Nothing new found in the recent messages.');
    } catch (e) { error = e.message; }
    scanning = false; await reload();
  }

  function entryCard(e, mode) {
    var card = h('div', { class: 'entry' + (e.status === 'muted' ? ' muted' : '') });
    var top = h('div', { class: 'top' }, [h('b', { text: e.name }), h('span', { class: 'rp-chip', text: e.kind })]);
    if (mode === 'codex') {
      top.appendChild(h('button', { class: 'ico' + (e.pinned ? ' on' : ''), title: e.pinned ? 'Always in the prompt' : 'Pin: always include', text: '★', onclick: function () { mutate(function (c) { var x = byId(c, e.id); x.pinned = !x.pinned; }); } }));
      top.appendChild(h('button', { class: 'ico', title: e.status === 'muted' ? 'Turn on' : 'Mute', text: e.status === 'muted' ? '○' : '●', onclick: function () { mutate(function (c) { var x = byId(c, e.id); x.status = x.status === 'muted' ? 'active' : 'muted'; }); } }));
      top.appendChild(h('button', { class: 'ico', title: 'Edit', text: '✎', onclick: function () { editing = editing === e.id ? null : e.id; render(); } }));
      top.appendChild(h('button', { class: 'ico', title: 'Delete', text: '×', onclick: function () { mutate(function (c) { c.entries = c.entries.filter(function (x) { return x.id !== e.id; }); }); } }));
    }
    card.appendChild(top);
    if (editing === e.id) {
      var ta = h('textarea', { class: 'rp-input', maxlength: '400' }); ta.value = e.text;
      var ks = h('input', { class: 'rp-input', placeholder: 'Extra keywords, comma separated' }); ks.value = (e.keys || []).join(', ');
      card.append(ta, ks, h('div', { class: 'rp-row' }, [
        h('button', { class: 'rp-btn primary', text: 'Save', onclick: function () { mutate(function (c) { var x = byId(c, e.id); x.text = ta.value.trim().slice(0, 400) || x.text; x.keys = Codex.words(ks.value.split(',')); }); editing = null; } }),
        h('button', { class: 'rp-btn ghost', text: 'Cancel', onclick: function () { editing = null; render(); } })]));
    } else {
      card.appendChild(h('div', { text: e.text, style: 'font-size:13px;overflow-wrap:anywhere' }));
      if (e.keys && e.keys.length) card.appendChild(h('div', { class: 'keys', text: 'Also matches: ' + e.keys.join(', ') }));
    }
    if (mode === 'review') {
      card.appendChild(h('div', { class: 'rp-row' }, [
        h('button', { class: 'rp-btn primary', text: 'Keep', onclick: function () { mutate(function (c) { byId(c, e.id).status = 'active'; }); } }),
        h('button', { class: 'rp-btn ghost', text: 'Dismiss', onclick: function () { mutate(function (c) { c.entries = c.entries.filter(function (x) { return x.id !== e.id; }); }); } })]));
    }
    return card;
  }

  function render() {
    root.innerHTML = '';
    if (!codex) { root.appendChild(h('p', { class: 'rp-muted', text: 'Open a chat to keep a codex.' })); return; }
    var pending = codex.entries.filter(function (e) { return e.status === 'pending'; });
    var kept = codex.entries.filter(function (e) { return e.status !== 'pending'; });
    var scanBtn = h('button', { class: 'rp-btn', text: scanning ? 'Reading the story…' : 'Scan now', onclick: scan });
    if (scanning) scanBtn.disabled = true;
    var tabs = h('div', { class: 'tabs' }, [['review', 'Review' + (pending.length ? ' (' + pending.length + ')' : '')], ['codex', 'Codex (' + kept.length + ')'], ['add', 'Add']].map(function (t) {
      return h('button', { class: 'tab' + (tab === t[0] ? ' on' : ''), text: t[1], onclick: function () { tab = t[0]; render(); } });
    }));
    root.appendChild(h('div', { class: 'rp-row rp-wrap', style: 'justify-content:space-between' }, [tabs, scanBtn]));
    if (error) root.appendChild(h('div', { class: 'err', text: error }));
    var every = parseInt(info.settings.scanEvery, 10) || 0;
    root.appendChild(h('div', { class: 'rp-muted', style: 'font-size:12px', text: (every ? 'Scans every ' + every + ' replies' : 'Automatic scans are off') + (codex.last ? ' · last scan ' + new Date(codex.last).toLocaleTimeString() : '') + '. Matching entries are added to the prompt.' }));

    if (tab === 'review') {
      if (!pending.length) root.appendChild(h('p', { class: 'rp-muted', text: 'Nothing waiting. New people, places and facts from the story show up here.' }));
      else {
        root.appendChild(h('div', { class: 'rp-row' }, [h('button', { class: 'rp-btn', text: 'Keep all', onclick: function () { mutate(function (c) { c.entries.forEach(function (e) { if (e.status === 'pending') e.status = 'active'; }); }); } })]));
        pending.forEach(function (e) { root.appendChild(entryCard(e, 'review')); });
      }
    } else if (tab === 'codex') {
      var sel = h('select', { class: 'rp-input', style: 'width:auto' }, [h('option', { value: 'all', text: 'All kinds' })].concat(Codex.KINDS.map(function (k) { return h('option', { value: k, text: k }); })));
      sel.value = kind; sel.onchange = function () { kind = sel.value; render(); };
      root.appendChild(h('div', { class: 'rp-row' }, [sel]));
      var shown = kept.filter(function (e) { return kind === 'all' || e.kind === kind; });
      if (!shown.length) root.appendChild(h('p', { class: 'rp-muted', text: 'No entries yet.' }));
      shown.forEach(function (e) { root.appendChild(entryCard(e, 'codex')); });
    } else {
      var name = h('input', { class: 'rp-input', placeholder: 'Name', maxlength: '60' });
      var ksel = h('select', { class: 'rp-input' }, Codex.KINDS.map(function (k) { return h('option', { value: k, text: k }); }));
      var text = h('textarea', { class: 'rp-input', placeholder: 'What is established about it?', maxlength: '400' });
      var keys = h('input', { class: 'rp-input', placeholder: 'Extra keywords, comma separated (optional)' });
      root.appendChild(h('div', { class: 'rp-stack' }, [name, ksel, text, keys, h('div', { class: 'rp-row' }, [h('button', { class: 'rp-btn primary', text: 'Add to codex', onclick: function () {
        if (!name.value.trim() || !text.value.trim()) return;
        mutate(function (c) { c.entries = c.entries.concat(Codex.fresh([{ name: name.value, kind: ksel.value, text: text.value, keys: keys.value.split(',') }], c.entries, 'active')); });
        tab = 'codex';
      } })])]));
    }
  }

  rp.on('turn', function (e) { if (e && e.phase === 'end') setTimeout(reload, 1500); });
  rp.on('chat', reload);
  rp.on('settings', function (v) { info.settings = v; render(); });
  reload();
})();
</script>`

export const lorekeeper: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'lorekeeper',
    name: 'Lorekeeper',
    version: '1.0.0',
    description: 'Builds a codex of the people, places and facts your story invents. Every few replies the AI proposes new entries for you to approve; matching ones are fed back into the prompt.',
    author: 'rp',
    glyph: '❡',
    api: 1,
    permissions: ['hooks', 'chat.read', 'generate'],
    panels: [{ id: 'codex', title: 'Codex', glyph: '❡', entry: 'codex.html', slots: ['chat', 'view'] }],
    script: 'main.js',
    hooks: ['context'],
    tools: [],
    settings: [
      { key: 'scanEvery', type: 'number', label: 'Scan every N replies', hint: '0 turns automatic scanning off. Each scan uses one model call.', default: 8 },
      { key: 'autoApprove', type: 'boolean', label: 'Add found entries without review', default: false },
      { key: 'budget', type: 'number', label: 'Prompt budget (characters)', hint: 'The most codex text added to one turn. Up to 1100.', default: 1000 },
    ],
  },
  files: { 'codex.html': PANEL, 'main.js': SCRIPT },
}
