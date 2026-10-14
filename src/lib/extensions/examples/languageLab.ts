// Example: language practice inside a story. A context hook sets the language and level; the panel harvests vocabulary and runs spaced-repetition review.

import type { ExtensionBundle } from '../manifest'
import { JSON_LIB } from './jsonLib'

/** Leitner-style review scheduling. Cards are {id, word, reading, meaning, example, box, due}. */
export const DECK_LIB = String.raw`
var Deck = (function () {
  var DAY = 86400000;
  var STEPS = [10 * 60000, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function make(word, reading, meaning, example, now) {
    return { id: uid(), word: String(word).trim().slice(0, 80), reading: String(reading || '').trim().slice(0, 80), meaning: String(meaning || '').trim().slice(0, 160), example: String(example || '').trim().slice(0, 240), box: 0, due: now };
  }
  // again drops to the first box, good moves up one, easy up two.
  function grade(card, rating, now) {
    var box = rating === 'again' ? 0 : Math.min(STEPS.length - 1, card.box + (rating === 'easy' ? 2 : 1));
    card.box = box; card.due = now + STEPS[box];
    return card;
  }
  function due(cards, now) {
    return cards.filter(function (c) { return c.due <= now; }).sort(function (a, b) { return a.due - b.due; });
  }
  function has(cards, word) { return cards.some(function (c) { return c.word.toLowerCase() === String(word).trim().toLowerCase(); }); }
  function tsv(cards) {
    return cards.map(function (c) { return [c.word, c.reading, c.meaning, c.example].join('\t'); }).join('\n');
  }
  return { STEPS: STEPS, make: make, grade: grade, due: due, has: has, tsv: tsv };
})();
`

const SCRIPT = String.raw`
var MODES = {
  immersion: 'Write your replies entirely in {lang}.',
  dialogue: 'Write narration in English, but every line of spoken dialogue in {lang}.'
};
var GLOSS = {
  'inline translation': 'After a sentence with new or hard words, add a short English translation in parentheses.',
  'reading only': 'After uncommon words, add their reading or pronunciation in parentheses.',
  none: 'Do not add translations.'
};

rp.hook('context', async function () {
  var s = await rp.settings.all();
  if (s.enabled === false) return null;
  var lang = String(s.language || 'Japanese').slice(0, 40), level = String(s.level || 'Beginner').toLowerCase();
  var parts = [
    'Language practice: the player is learning ' + lang + ' at a ' + level + ' level.',
    (MODES[s.mode] || MODES.immersion).replace('{lang}', lang),
    'Use vocabulary and grammar suited to a ' + level + ' learner and keep sentences short.',
    GLOSS[s.glossing] || GLOSS['inline translation']
  ];
  if (s.corrections !== false) parts.push('If the player\'s ' + lang + ' has a mistake, end your reply with one short line starting with "Tip:" that gently corrects it in English.');
  parts.push('Stay in character while helping, and never lecture.');
  return { label: lang, text: parts.join(' ') };
});
`

const PANEL = String.raw`<div class="rp-stack" id="root"></div>
<style>
  .tabs{display:flex;gap:4px;flex-wrap:wrap}
  .tab{border:1px solid rgb(var(--c-border));background:transparent;color:rgb(var(--c-text-muted));border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px}
  .tab.on{background:rgb(var(--c-bg-sunken));color:rgb(var(--c-text))}
  .card{border:1px solid rgb(var(--c-border));border-radius:8px;padding:18px;text-align:center;display:flex;flex-direction:column;gap:8px;min-height:150px;justify-content:center}
  .word{font-size:1.9rem;font-weight:600;overflow-wrap:anywhere}
  .li{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:6px;background:rgb(var(--c-bg-sunken))}
  .li .t{flex:1;overflow-wrap:anywhere}
  .li .t small{display:block;color:rgb(var(--c-text-muted))}
  .box{display:inline-block;width:6px;height:6px;border-radius:50%;background:rgb(var(--c-border));margin-right:2px}
  .box.on{background:rgb(var(--c-accent))}
  .x{opacity:.45;cursor:pointer;background:none;border:0;color:inherit;font-size:16px}
  .x:hover{opacity:1}
  .err{color:rgb(var(--c-danger));font-size:13px}
</style>
<script>
` + JSON_LIB + DECK_LIB + String.raw`
(async function () {
  var info = await rp.ready;
  var root = document.getElementById('root');
  var cards = [], tab = 'review', candidates = null, busy = false, error = '', shown = false, source = 'last';

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
  async function load() { try { cards = (await rp.storage.get('deck', 'global')) || []; } catch (e) { cards = []; } render(); }
  async function save() { try { await rp.storage.set('deck', cards, 'global'); } catch (e) { error = e.message; } }

  async function harvest() {
    busy = true; error = ''; candidates = null; render();
    try {
      var msgs = await rp.chat.messages(12);
      var pool = msgs.filter(function (m) { return m.role === 'char'; });
      if (source === 'last') pool = pool.slice(-1); else pool = pool.slice(-4);
      if (!pool.length) throw new Error('No replies to read yet.');
      var lang = info.settings.language || 'Japanese', level = info.settings.level || 'Beginner';
      var text = pool.map(function (m) { return m.text; }).join('\n\n').slice(0, 5000);
      var out = await rp.generate('Text:\n\n' + text + '\n\nJSON array:', { maxTokens: 700, temperature: 0.3,
        system: 'You help a ' + level + ' ' + lang + ' learner. From the text, pick up to 8 useful words or short phrases written in ' + lang + ' that are worth learning (skip names and very basic words). Reply with ONLY a JSON array of {"word":"...","reading":"pronunciation, or empty","meaning":"short English meaning","example":"the sentence it appeared in"}.' });
      var list = parseLoose(out);
      if (!Array.isArray(list)) throw new Error('The model did not return a list. Try again.');
      candidates = list.filter(function (c) { return c && typeof c.word === 'string' && c.word.trim() && !Deck.has(cards, c.word); }).slice(0, 8).map(function (c) { c.on = true; return c; });
      if (!candidates.length) error = 'Nothing new to learn in that text.';
    } catch (e) { error = e.message; }
    busy = false; render();
  }

  function reviewTab() {
    var now = Date.now(), queue = Deck.due(cards, now), box = h('div', { class: 'rp-stack' });
    if (!cards.length) return h('p', { class: 'rp-muted', text: 'Your deck is empty. Harvest words from a reply, or add your own.' });
    if (!queue.length) return h('p', { class: 'rp-muted', text: 'All caught up. ' + cards.length + ' cards in the deck.' });
    var c = queue[0];
    var card = h('div', { class: 'card' }, [h('div', { class: 'word', text: c.word })]);
    if (shown) {
      if (c.reading) card.appendChild(h('div', { text: c.reading }));
      card.appendChild(h('div', { text: c.meaning || '(no meaning saved)' }));
      if (c.example) card.appendChild(h('div', { class: 'rp-muted', style: 'font-size:13px', text: c.example }));
    }
    box.appendChild(h('div', { class: 'rp-muted', style: 'font-size:12px', text: queue.length + ' due' }));
    box.appendChild(card);
    var grade = function (r) { return function () { Deck.grade(c, r, Date.now()); shown = false; save().then(render); }; };
    box.appendChild(shown
      ? h('div', { class: 'rp-row' }, [h('button', { class: 'rp-btn rp-grow', text: 'Again', onclick: grade('again') }), h('button', { class: 'rp-btn primary rp-grow', text: 'Good', onclick: grade('good') }), h('button', { class: 'rp-btn rp-grow', text: 'Easy', onclick: grade('easy') })])
      : h('div', { class: 'rp-row' }, [h('button', { class: 'rp-btn primary rp-grow', text: 'Show answer', onclick: function () { shown = true; render(); } })]));
    return box;
  }

  function harvestTab() {
    var box = h('div', { class: 'rp-stack' });
    var sel = h('select', { class: 'rp-input', style: 'width:auto' }, [h('option', { value: 'last', text: 'Last reply' }), h('option', { value: 'recent', text: 'Last few replies' })]);
    sel.value = source; sel.onchange = function () { source = sel.value; };
    var go = h('button', { class: 'rp-btn primary', text: busy ? 'Reading…' : 'Find words', onclick: harvest }); if (busy) go.disabled = true;
    box.appendChild(h('div', { class: 'rp-row' }, [sel, go]));
    if (candidates && candidates.length) {
      candidates.forEach(function (c) {
        var cb = h('input', { type: 'checkbox' }); cb.checked = c.on; cb.onchange = function () { c.on = cb.checked; };
        box.appendChild(h('label', { class: 'li' }, [cb, h('div', { class: 't' }, [document.createTextNode(c.word + (c.reading ? '  (' + c.reading + ')' : '')), h('small', { text: c.meaning || '' })])]));
      });
      box.appendChild(h('button', { class: 'rp-btn primary', text: 'Add selected to the deck', onclick: function () {
        var now = Date.now();
        candidates.filter(function (c) { return c.on && !Deck.has(cards, c.word); }).forEach(function (c) { cards.push(Deck.make(c.word, c.reading, c.meaning, c.example, now)); });
        candidates = null; save().then(function () { tab = 'review'; render(); });
      } }));
    } else if (!busy) box.appendChild(h('p', { class: 'rp-muted', text: 'The model reads a reply and suggests words worth learning at your level (' + (info.settings.level || 'Beginner') + ' ' + (info.settings.language || 'Japanese') + ').' }));
    return box;
  }

  function deckTab() {
    var box = h('div', { class: 'rp-stack' });
    var word = h('input', { class: 'rp-input', placeholder: 'Word', maxlength: '80' }), meaning = h('input', { class: 'rp-input', placeholder: 'Meaning', maxlength: '160' }), reading = h('input', { class: 'rp-input', placeholder: 'Reading (optional)', maxlength: '80' });
    var add = function () { if (!word.value.trim() || Deck.has(cards, word.value)) return; cards.push(Deck.make(word.value, reading.value, meaning.value, '', Date.now())); save().then(render); };
    box.appendChild(h('div', { class: 'rp-stack', style: 'gap:6px' }, [word, reading, meaning, h('div', { class: 'rp-row' }, [h('button', { class: 'rp-btn', text: 'Add card', onclick: add })])]));
    cards.slice().sort(function (a, b) { return a.due - b.due; }).forEach(function (c) {
      var dots = h('div'); for (var i = 0; i < Deck.STEPS.length; i++) dots.appendChild(h('span', { class: 'box' + (i <= c.box ? ' on' : '') }));
      box.appendChild(h('div', { class: 'li' }, [h('div', { class: 't' }, [document.createTextNode(c.word + (c.reading ? '  (' + c.reading + ')' : '')), h('small', { text: c.meaning })]), dots,
        h('button', { class: 'x', text: '×', title: 'Remove', onclick: function () { cards = cards.filter(function (x) { return x.id !== c.id; }); save().then(render); } })]));
    });
    if (cards.length) {
      var ta = h('textarea', { class: 'rp-input', rows: '4', readonly: 'readonly' }); ta.value = Deck.tsv(cards); ta.onfocus = function () { ta.select(); };
      box.appendChild(h('div', { class: 'rp-label', text: 'Export (tab separated, for Anki or a spreadsheet)' })); box.appendChild(ta);
    }
    return box;
  }

  function render() {
    root.innerHTML = '';
    var dueNow = Deck.due(cards, Date.now()).length;
    root.appendChild(h('div', { class: 'tabs' }, [['review', 'Review' + (dueNow ? ' (' + dueNow + ')' : '')], ['harvest', 'Find words'], ['deck', 'Deck (' + cards.length + ')']].map(function (t) {
      return h('button', { class: 'tab' + (tab === t[0] ? ' on' : ''), text: t[1], onclick: function () { tab = t[0]; shown = false; render(); } });
    })));
    if (error) root.appendChild(h('div', { class: 'err', text: error }));
    root.appendChild(tab === 'review' ? reviewTab() : tab === 'harvest' ? harvestTab() : deckTab());
  }

  rp.on('settings', function (v) { info.settings = v; render(); });
  load();
})();
</script>`

export const languageLab: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'language-lab',
    name: 'Language Lab',
    version: '1.0.0',
    description: 'Practice a language through the story. The AI writes at your level with glosses and gentle corrections; pull vocabulary out of replies into a spaced-repetition deck.',
    author: 'rp',
    glyph: '文',
    api: 1,
    permissions: ['hooks', 'chat.read', 'generate'],
    panels: [{ id: 'lab', title: 'Language Lab', glyph: '文', entry: 'lab.html', slots: ['chat', 'view'] }],
    script: 'main.js',
    hooks: ['context'],
    tools: [],
    settings: [
      { key: 'enabled', type: 'boolean', label: 'Practice mode on', hint: 'Turn off to chat normally and keep your deck.', default: true },
      { key: 'language', type: 'text', label: 'Language', default: 'Japanese' },
      { key: 'level', type: 'select', label: 'Level', options: ['Beginner', 'Elementary', 'Intermediate', 'Advanced'], default: 'Beginner' },
      { key: 'mode', type: 'select', label: 'Reply style', options: ['immersion', 'dialogue'], hint: 'immersion: everything in the language. dialogue: English narration, spoken lines in the language.', default: 'immersion' },
      { key: 'glossing', type: 'select', label: 'Help after hard words', options: ['inline translation', 'reading only', 'none'], default: 'inline translation' },
      { key: 'corrections', type: 'boolean', label: 'Correct my mistakes with a short tip', default: true },
    ],
  },
  files: { 'lab.html': PANEL, 'main.js': SCRIPT },
}
