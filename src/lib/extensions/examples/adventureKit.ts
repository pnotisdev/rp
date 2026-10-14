// Example: a tabletop-style character sheet the AI can update. Panels, a HUD, and context + output hooks that read and write [HP -3] style tags.

import type { ExtensionBundle } from '../manifest'
import { DICE_LIB } from './diceLib'

/** Sheet rules shared by the script (tags from the AI) and the panels (buttons). Every change returns short event strings. */
const SHEET_LIB = String.raw`
var Sheet = (function () {
  var STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function make(name) {
    return { name: name || 'Adventurer', cls: 'Wanderer', level: 1, xp: 0, hp: { cur: 20, max: 20 }, mp: { cur: 5, max: 5 }, gold: 0,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, items: [], conds: [] };
  }
  function normalize(s) {
    var d = make(s && s.name);
    var o = s || {};
    d.cls = String(o.cls || d.cls).slice(0, 40);
    d.level = clamp(parseInt(o.level, 10) || 1, 1, 99);
    d.xp = Math.max(0, parseInt(o.xp, 10) || 0);
    ['hp', 'mp'].forEach(function (k) {
      var v = o[k] || {};
      d[k].max = Math.max(1, parseInt(v.max, 10) || d[k].max);
      d[k].cur = clamp(v.cur === undefined ? d[k].max : parseInt(v.cur, 10) || 0, 0, d[k].max);
    });
    d.gold = Math.max(0, parseInt(o.gold, 10) || 0);
    STATS.forEach(function (k) { d.stats[k] = clamp(parseInt((o.stats || {})[k], 10) || 10, 1, 30); });
    d.items = (Array.isArray(o.items) ? o.items : []).filter(function (i) { return i && i.name; }).map(function (i) { return { name: String(i.name).slice(0, 60), qty: Math.max(1, parseInt(i.qty, 10) || 1) }; }).slice(0, 60);
    d.conds = (Array.isArray(o.conds) ? o.conds : []).map(function (c) { return String(c).slice(0, 30); }).slice(0, 20);
    return d;
  }
  function mod(score) { return Math.floor((score - 10) / 2); }
  function xpNeeded(level) { return level * 100; }
  function has(list, v) { return list.some(function (c) { return c.toLowerCase() === v.toLowerCase(); }); }

  function addCond(s, name) {
    name = name.trim().slice(0, 30);
    if (!name || has(s.conds, name)) return [];
    s.conds.push(name); return ['+' + name];
  }
  function removeCond(s, name) {
    var n = s.conds.length;
    s.conds = s.conds.filter(function (c) { return c.toLowerCase() !== name.trim().toLowerCase(); });
    return s.conds.length < n ? ['-' + name.trim()] : [];
  }
  function hp(s, d) {
    var before = s.hp.cur;
    s.hp.cur = clamp(before + d, 0, s.hp.max);
    var ev = s.hp.cur === before ? [] : ['HP ' + (s.hp.cur > before ? '+' : '') + (s.hp.cur - before)];
    if (s.hp.cur === 0) ev = ev.concat(addCond(s, 'Downed'));
    else if (has(s.conds, 'Downed')) removeCond(s, 'Downed');
    return ev;
  }
  function mp(s, d) {
    var before = s.mp.cur;
    s.mp.cur = clamp(before + d, 0, s.mp.max);
    return s.mp.cur === before ? [] : ['MP ' + (s.mp.cur > before ? '+' : '') + (s.mp.cur - before)];
  }
  function gold(s, d) {
    var before = s.gold;
    s.gold = Math.max(0, before + d);
    return s.gold === before ? [] : ['Gold ' + (s.gold > before ? '+' : '') + (s.gold - before)];
  }
  function xp(s, d) {
    if (d <= 0) return [];
    var ev = ['XP +' + d];
    s.xp += d;
    while (s.xp >= xpNeeded(s.level) && s.level < 99) {
      s.xp -= xpNeeded(s.level); s.level++;
      s.hp.max += 5; s.hp.cur = Math.min(s.hp.max, s.hp.cur + 5); s.mp.max += 1;
      ev.push('Level up! Now level ' + s.level);
    }
    return ev;
  }
  function addItem(s, name, qty) {
    name = name.trim().slice(0, 60); qty = Math.max(1, qty || 1);
    if (!name) return [];
    var found = s.items.filter(function (i) { return i.name.toLowerCase() === name.toLowerCase(); })[0];
    if (found) found.qty += qty; else s.items.push({ name: name, qty: qty });
    return ['+' + (qty > 1 ? qty + ' ' : '') + name];
  }
  function removeItem(s, name, qty) {
    name = name.trim(); qty = Math.max(1, qty || 1);
    var found = s.items.filter(function (i) { return i.name.toLowerCase() === name.toLowerCase(); })[0];
    if (!found) return [];
    found.qty -= qty;
    if (found.qty <= 0) s.items = s.items.filter(function (i) { return i !== found; });
    return ['-' + name];
  }

  var TAG = /\[\s*(HP|MP|XP|GOLD|ITEM|COND)\s*:?\s*([+-])\s*([^\]\n]{1,60}?)\s*\]/gi;
  // Applies [HP -3] [GOLD +5] [ITEM +2 Torch] [COND +Poisoned] tags found in text, and returns the text without them.
  function applyTags(s, text) {
    var events = [], seen = false;
    var clean = text.replace(TAG, function (_m, kind, sign, arg) {
      seen = true;
      kind = kind.toUpperCase();
      var sgn = sign === '-' ? -1 : 1;
      if (kind === 'ITEM') {
        var q = /^(\d{1,3})\s+(.+)$/.exec(arg);
        var qty = q ? parseInt(q[1], 10) : 1, name = q ? q[2] : arg;
        events = events.concat(sgn > 0 ? addItem(s, name, qty) : removeItem(s, name, qty));
      } else if (kind === 'COND') {
        events = events.concat(sgn > 0 ? addCond(s, arg) : removeCond(s, arg));
      } else {
        var n = parseInt(arg, 10);
        if (!isNaN(n) && n >= 0) events = events.concat(kind === 'HP' ? hp(s, sgn * n) : kind === 'MP' ? mp(s, sgn * n) : kind === 'GOLD' ? gold(s, sgn * n) : xp(s, sgn * n));
      }
      return '';
    });
    clean = clean.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text: clean, events: events, changed: seen };
  }

  function describe(s) {
    var items = s.items.map(function (i) { return i.name + (i.qty > 1 ? ' x' + i.qty : ''); }).join(', ') || 'nothing';
    var stats = STATS.map(function (k) { var m = mod(s.stats[k]); return k + ' ' + s.stats[k] + (m ? ' (' + (m > 0 ? '+' : '') + m + ')' : ''); }).join(', ');
    return 'Player character sheet: ' + s.name + ', level ' + s.level + ' ' + s.cls + '. HP ' + s.hp.cur + '/' + s.hp.max + ', MP ' + s.mp.cur + '/' + s.mp.max + ', XP ' + s.xp + '/' + xpNeeded(s.level) + ', gold ' + s.gold + '. ' + stats + '. Carrying: ' + items + '. Conditions: ' + (s.conds.join(', ') || 'none') + '.';
  }
  var TONE = {
    casual: 'Be forgiving: damage is modest and a downed hero is rescued, never killed.',
    normal: 'Keep risk fair: damage follows the fiction and low stats make hard things hard.',
    gritty: 'Be harsh: injuries linger, supplies matter, and bad choices cost real HP.'
  };
  function rules(difficulty) {
    return 'Track the sheet honestly. When the story changes it, start your reply with one line of tags and nothing else on that line, for example: [HP -3] [GOLD +5] [ITEM +Rusty key] [COND +Poisoned]. HP, MP, XP and GOLD take a whole number; ITEM and COND take a name (ITEM +2 Torch for a count). Award XP for real achievements (5-20 small, 50+ big). Do not mention the tags or the sheet in the story. ' + (TONE[difficulty] || TONE.normal);
  }
  return { STATS: STATS, make: make, normalize: normalize, mod: mod, xpNeeded: xpNeeded, hp: hp, mp: mp, gold: gold, xp: xp, addItem: addItem, removeItem: removeItem, addCond: addCond, removeCond: removeCond, applyTags: applyTags, describe: describe, rules: rules };
})();
`

const SCRIPT = SHEET_LIB + String.raw`
async function load() {
  var raw = await rp.storage.get('sheet', 'chat');
  return raw ? Sheet.normalize(raw) : null;
}

rp.hook('context', async function () {
  var sheet = await load();
  if (!sheet) return null;
  var settings = await rp.settings.all();
  var out = [{ label: 'character sheet', text: Sheet.describe(sheet) }];
  if (settings.aiUpdates !== false) out.push({ label: 'tracking rules', text: Sheet.rules(settings.difficulty) });
  return out;
});

rp.hook('output', async function (p) {
  var settings = await rp.settings.all();
  if (settings.aiUpdates === false) return null;
  var sheet = await load();
  if (!sheet) return null;
  var r = Sheet.applyTags(sheet, p.text);
  if (!r.changed) return null;
  await rp.storage.set('sheet', sheet, 'chat');
  if (r.events.length) rp.notify(r.events.join(', '));
  return r.text || null;
});
`

const SHEET_PANEL = String.raw`<div class="rp-stack" id="root"></div>
<style>
  .grid{display:grid;gap:8px}
  .stats{grid-template-columns:repeat(3,1fr)}
  .stat{border:1px solid rgb(var(--c-border));border-radius:8px;padding:8px;text-align:center}
  .stat b{display:block;font-size:11px;letter-spacing:.06em;color:rgb(var(--c-text-muted))}
  .stat input{width:100%;text-align:center;font-size:18px;font-weight:600;background:transparent;border:0;outline:0;color:inherit}
  .mod{font-size:12px;color:rgb(var(--c-text-muted))}
  .bar-row{display:flex;align-items:center;gap:8px}
  .bar-row .lab{width:34px;font-size:12px;font-weight:600;color:rgb(var(--c-text-muted))}
  .bar-row .rp-bar{flex:1;height:10px}
  .bar-row .num{min-width:54px;text-align:right;font-variant-numeric:tabular-nums;font-size:13px}
  .step{padding:3px 8px;font-size:12px}
  .chip-x{cursor:pointer;margin-left:6px;opacity:.6}
  .item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:rgb(var(--c-bg-sunken))}
  .item span{flex:1;overflow-wrap:anywhere}
  .res{padding:10px;border-radius:8px;background:rgb(var(--c-bg-sunken));font-size:13px;min-height:42px}
  .good{color:rgb(var(--c-success))}.bad{color:rgb(var(--c-danger))}
  .x{opacity:.45;cursor:pointer;background:none;border:0;color:inherit;font-size:16px}
  .x:hover{opacity:1}
  .small{width:96px}
</style>
<script>
` + DICE_LIB + SHEET_LIB + String.raw`
(async function () {
  var info = await rp.ready;
  var root = document.getElementById('root');
  var sheet = null, adv = '', dc = '', result = '', saveTimer = null, armedReset = false;

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
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { rp.storage.set('sheet', sheet, 'chat').catch(function (e) { rp.notify(e.message, 'error'); }); }, 250);
  }
  function apply(events) { if (events.length) rp.notify(events.join(', ')); save(); render(); }

  async function load() {
    try {
      var raw = await rp.storage.get('sheet', 'chat');
      if (!raw) {
        var name = 'Adventurer';
        try { var ci = await rp.chat.info(); if (ci && ci.personaName) name = ci.personaName; } catch (e) {}
        raw = Sheet.make(name);
        await rp.storage.set('sheet', raw, 'chat');
      }
      sheet = Sheet.normalize(raw);
    } catch (e) { sheet = null; }
    render();
  }

  function postsRolls() { return info.settings.postRolls !== false; }
  function check(stat) {
    var m = Sheet.mod(sheet.stats[stat]);
    var r = Dice.roll(Dice.parse('d20' + (m ? (m > 0 ? '+' : '-') + Math.abs(m) : '') + (adv ? ' ' + adv : '')));
    var need = parseInt(dc, 10), verdict = '';
    if (need) verdict = r.total >= need ? 'success vs DC ' + need : 'failure vs DC ' + need;
    result = stat + ' check: ' + r.text + (verdict ? ' - ' + verdict : '');
    render();
    if (postsRolls()) {
      var line = '*attempts a ' + stat + ' check* (' + r.text.replace(/= (-?\d+)/, '= **$1**') + (verdict ? ', ' + verdict : '') + ')';
      rp.chat.send(line).catch(function (e) { rp.notify(e.message, 'error'); });
    }
  }

  function steps(deltas, fn) {
    return h('div', { class: 'rp-row', style: 'justify-content:flex-end;gap:4px' }, deltas.map(function (d) { return h('button', { class: 'rp-btn step', text: (d > 0 ? '+' : '') + d, onclick: function () { apply(fn(d)); } }); }));
  }
  function bar(label, cur, max, fn) {
    var pct = Math.max(0, Math.min(100, 100 * cur / max));
    var fill = h('i'); fill.style.width = pct + '%';
    return h('div', { class: 'rp-stack', style: 'gap:6px' }, [
      h('div', { class: 'bar-row' }, [h('span', { class: 'lab', text: label }), h('div', { class: 'rp-bar' }, [fill]), h('span', { class: 'num', text: cur + '/' + max })]),
      steps([-5, -1, 1, 5], fn)]);
  }
  function field(value, onchange, attrs) {
    var i = h('input', Object.assign({ class: 'rp-input' }, attrs || {}));
    i.value = value; i.onchange = function () { onchange(i.value); save(); render(); };
    return i;
  }

  function render() {
    root.innerHTML = '';
    if (!sheet) { root.appendChild(h('p', { class: 'rp-muted', text: 'Open a chat to use the adventure kit.' })); return; }
    var s = sheet;

    var goldRow = h('div', { class: 'rp-stack', style: 'gap:6px' }, [
      h('div', { class: 'rp-row' }, [h('span', { class: 'rp-label', text: 'Gold' }), h('span', { class: 'rp-grow', text: String(s.gold) })]),
      steps([-10, -1, 1, 10], function (d) { return Sheet.gold(s, d); })]);
    var need = Sheet.xpNeeded(s.level), xpFill = h('i'); xpFill.style.width = Math.min(100, 100 * s.xp / need) + '%';
    root.appendChild(h('div', { class: 'rp-card rp-stack' }, [
      h('div', { class: 'rp-row' }, [field(s.name, function (v) { s.name = v.slice(0, 40) || 'Adventurer'; }, { maxlength: '40' }), field(s.cls, function (v) { s.cls = v.slice(0, 40); }, { maxlength: '40' })]),
      h('div', { class: 'rp-row' }, [h('span', { class: 'rp-label', text: 'Level ' + s.level }), h('div', { class: 'rp-bar rp-grow' }, [xpFill]), h('span', { class: 'rp-muted', style: 'font-size:12px', text: s.xp + '/' + need + ' XP' })]),
      bar('HP', s.hp.cur, s.hp.max, function (d) { return Sheet.hp(s, d); }),
      bar('MP', s.mp.cur, s.mp.max, function (d) { return Sheet.mp(s, d); }),
      goldRow,
    ]));

    var grid = h('div', { class: 'grid stats' });
    Sheet.STATS.forEach(function (k) {
      var m = Sheet.mod(s.stats[k]);
      var inp = h('input', { type: 'number', min: '1', max: '30' }); inp.value = s.stats[k];
      inp.onchange = function () { s.stats[k] = Math.max(1, Math.min(30, parseInt(inp.value, 10) || 10)); save(); render(); };
      grid.appendChild(h('div', { class: 'stat' }, [h('b', { text: k }), inp, h('div', { class: 'mod', text: (m >= 0 ? '+' : '') + m }),
        h('button', { class: 'rp-btn step', text: 'Check', onclick: function () { check(k); } })]));
    });
    var advSel = h('select', { class: 'rp-input small' }, [h('option', { value: '', text: 'Normal' }), h('option', { value: 'adv', text: 'Advantage' }), h('option', { value: 'dis', text: 'Disadvantage' })]);
    advSel.value = adv; advSel.onchange = function () { adv = advSel.value; };
    var dcIn = h('input', { class: 'rp-input small', type: 'number', placeholder: 'DC', min: '1', max: '40' }); dcIn.value = dc; dcIn.onchange = function () { dc = dcIn.value; };
    var resBox = h('div', { class: 'res', text: result || 'Pick a stat to roll a d20 check.' });
    if (/success/.test(result)) resBox.classList.add('good'); else if (/failure/.test(result)) resBox.classList.add('bad');
    root.appendChild(h('div', { class: 'rp-card rp-stack' }, [h('div', { class: 'rp-row' }, [h('span', { class: 'rp-label rp-grow', text: 'Checks' }), advSel, dcIn]), grid, resBox]));

    var items = h('div', { class: 'rp-stack', style: 'gap:6px' });
    s.items.forEach(function (it) {
      items.appendChild(h('div', { class: 'item' }, [h('span', { text: it.name }),
        h('button', { class: 'rp-btn step', text: '-', onclick: function () { apply(Sheet.removeItem(s, it.name, 1)); } }), h('span', { text: 'x' + it.qty, style: 'flex:0 0 auto;font-size:12px' }),
        h('button', { class: 'rp-btn step', text: '+', onclick: function () { apply(Sheet.addItem(s, it.name, 1)); } })]));
    });
    if (!s.items.length) items.appendChild(h('div', { class: 'rp-muted', style: 'font-size:13px', text: 'Nothing yet. The AI can add things with [ITEM +name].' }));
    var newItem = h('input', { class: 'rp-input rp-grow', placeholder: 'Add an item…', maxlength: '60' });
    var addItem = function () { if (newItem.value.trim()) apply(Sheet.addItem(s, newItem.value, 1)); };
    newItem.onkeydown = function (e) { if (e.key === 'Enter') addItem(); };
    root.appendChild(h('div', { class: 'rp-card rp-stack' }, [h('div', { class: 'rp-label', text: 'Inventory' }), items, h('div', { class: 'rp-row' }, [newItem, h('button', { class: 'rp-btn', text: 'Add', onclick: addItem })])]));

    var conds = h('div', { class: 'rp-row rp-wrap' });
    s.conds.forEach(function (c) { conds.appendChild(h('span', { class: 'rp-chip' }, [document.createTextNode(c), h('span', { class: 'chip-x', text: '×', onclick: function () { apply(Sheet.removeCond(s, c)); } })])); });
    if (!s.conds.length) conds.appendChild(h('span', { class: 'rp-muted', style: 'font-size:13px', text: 'None.' }));
    var newCond = h('input', { class: 'rp-input rp-grow', placeholder: 'Add a condition…', maxlength: '30' });
    var addCond = function () { if (newCond.value.trim()) apply(Sheet.addCond(s, newCond.value)); };
    newCond.onkeydown = function (e) { if (e.key === 'Enter') addCond(); };
    root.appendChild(h('div', { class: 'rp-card rp-stack' }, [h('div', { class: 'rp-label', text: 'Conditions' }), conds, h('div', { class: 'rp-row' }, [newCond, h('button', { class: 'rp-btn', text: 'Add', onclick: addCond })])]));

    root.appendChild(h('div', { class: 'rp-row' }, [h('button', { class: 'rp-btn ghost', text: armedReset ? 'Click again to reset the sheet' : 'Reset sheet', onclick: function () {
      if (!armedReset) { armedReset = true; render(); return; }
      armedReset = false; sheet = Sheet.make(s.name); save(); render();
    } })]));
  }

  rp.on('turn', function (e) { if (e && e.phase === 'end') load(); });
  rp.on('chat', load);
  rp.on('settings', function (v) { info.settings = v; });
  load();
})();
</script>`

const HUD_PANEL = String.raw`<div class="wrap" id="wrap"></div>
<style>
  body{padding:6px}
  .wrap{display:none;flex-direction:column;gap:5px;padding:9px 11px;border-radius:8px;background:rgb(var(--c-bg-elevated)/.92);border:1px solid rgb(var(--c-border));font-size:12px}
  .nm{display:flex;justify-content:space-between;gap:8px;font-weight:600}
  .nm span:last-child{color:rgb(var(--c-text-muted));font-weight:500}
  .row{display:flex;align-items:center;gap:7px}
  .row b{width:20px;font-size:10px;color:rgb(var(--c-text-muted))}
  .row .rp-bar{flex:1;height:7px}
  .row span{width:46px;text-align:right;font-variant-numeric:tabular-nums}
  .hp i{background:rgb(var(--c-danger))}
  .conds{display:flex;flex-wrap:wrap;gap:4px}
</style>
<script>
` + SHEET_LIB + String.raw`
(async function () {
  await rp.ready;
  var wrap = document.getElementById('wrap');
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function bar(label, cls, cur, max) {
    var fill = h('i'); fill.style.width = Math.max(0, Math.min(100, 100 * cur / max)) + '%';
    var track = h('div', 'rp-bar'); track.appendChild(fill);
    var row = h('div', 'row ' + cls); row.append(h('b', '', label), track, h('span', '', cur + '/' + max));
    return row;
  }
  async function refresh() {
    var s = null;
    try { var raw = await rp.storage.get('sheet', 'chat'); s = raw ? Sheet.normalize(raw) : null; } catch (e) {}
    wrap.innerHTML = '';
    if (!s) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    var nm = h('div', 'nm'); nm.append(h('span', '', s.name), h('span', '', 'Lv ' + s.level + ' · ' + s.gold + 'g'));
    wrap.append(nm, bar('HP', 'hp', s.hp.cur, s.hp.max), bar('MP', 'mp', s.mp.cur, s.mp.max));
    if (s.conds.length) { var c = h('div', 'conds'); s.conds.forEach(function (x) { c.appendChild(h('span', 'rp-chip', x)); }); wrap.appendChild(c); }
  }
  rp.on('turn', refresh);
  rp.on('chat', refresh);
  setInterval(refresh, 3000);
  refresh();
})();
</script>`

export const adventureKit: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'adventure-kit',
    name: 'Adventure Kit',
    version: '1.0.0',
    description: 'A tabletop character sheet for the story: HP and MP, stats and d20 checks, inventory and conditions. The AI sees the sheet and updates it with [HP -3] style tags.',
    author: 'rp',
    glyph: '⚔',
    api: 1,
    permissions: ['hooks', 'chat.read', 'chat.write'],
    panels: [
      { id: 'sheet', title: 'Adventure sheet', glyph: '⚔', entry: 'sheet.html', slots: ['chat', 'view'] },
      { id: 'vitals', title: 'Vitals', glyph: '♥', entry: 'hud.html', slots: ['hud'], anchor: 'bottom-left', width: 230 },
    ],
    script: 'main.js',
    hooks: ['context', 'output'],
    tools: [],
    settings: [
      { key: 'aiUpdates', type: 'boolean', label: 'Let the AI update the sheet', hint: 'It starts replies with a line of tags like [HP -3]; the tags are removed before you see them.', default: true },
      { key: 'difficulty', type: 'select', label: 'Difficulty', options: ['casual', 'normal', 'gritty'], default: 'normal' },
      { key: 'postRolls', type: 'boolean', label: 'Send check results to the chat', default: true },
    ],
  },
  files: { 'sheet.html': SHEET_PANEL, 'hud.html': HUD_PANEL, 'main.js': SCRIPT },
}
