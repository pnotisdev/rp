// Example: a dice tray for the chat dock. Shows panels, settings, scoped storage and posting to the chat.

import type { ExtensionBundle } from '../manifest'

const PANEL = String.raw`<style>
  .die{min-width:44px}
  .die.on{background:rgb(var(--c-accent));color:rgb(var(--c-accent-text))}
  #total{font-size:2.6rem;line-height:1;font-weight:700;font-variant-numeric:tabular-nums}
  #total.pop{animation:pop .35s ease}
  @keyframes pop{0%{transform:scale(.6);opacity:.2}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
  .step{width:34px;padding:7px 0}
  .hist{font-variant-numeric:tabular-nums}
</style>
<div class="rp-stack">
  <div class="rp-row rp-wrap" id="dice"></div>
  <div class="rp-row rp-wrap">
    <span class="rp-label">Dice</span>
    <button class="rp-btn step" id="cMinus">−</button><b id="count" style="min-width:1.4em;text-align:center">1</b><button class="rp-btn step" id="cPlus">+</button>
    <span class="rp-label" style="margin-left:10px">Bonus</span>
    <button class="rp-btn step" id="mMinus">−</button><b id="mod" style="min-width:1.8em;text-align:center">+0</b><button class="rp-btn step" id="mPlus">+</button>
  </div>
  <label class="rp-row rp-muted" id="advRow" style="display:none"><input type="checkbox" id="adv"> Roll twice, keep the higher (advantage)</label>
  <button class="rp-btn primary" id="roll" style="padding:10px 14px;font-size:15px">Roll</button>
  <div class="rp-card rp-center" style="min-height:110px;flex-direction:column;gap:6px">
    <div id="total">–</div>
    <div class="rp-muted" id="detail">Pick a die and roll.</div>
    <div id="flag"></div>
  </div>
  <div class="rp-row"><button class="rp-btn rp-grow" id="send" disabled>Send roll to the character</button></div>
  <div class="rp-stack" id="history"></div>
</div>
<script>
(async function () {
  var info = await rp.ready;
  var SIDES = [4, 6, 8, 10, 12, 20, 100];
  var state = { sides: 20, count: 1, mod: 0, last: null, history: [] };
  var $ = function (id) { return document.getElementById(id); };

  function roll(sides) {
    var buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] % sides) + 1;
  }
  function label() {
    var m = state.mod ? (state.mod > 0 ? '+' + state.mod : '' + state.mod) : '';
    return state.count + 'd' + state.sides + m;
  }
  function render() {
    $('dice').innerHTML = '';
    SIDES.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'rp-btn die' + (s === state.sides ? ' on' : '');
      b.textContent = 'd' + s;
      b.onclick = function () { state.sides = s; render(); };
      $('dice').appendChild(b);
    });
    $('count').textContent = state.count;
    $('mod').textContent = (state.mod >= 0 ? '+' : '') + state.mod;
    $('advRow').style.display = state.sides === 20 && state.count === 1 ? 'flex' : 'none';
    $('history').innerHTML = state.history.slice(0, 5).map(function (h) {
      return '<div class="rp-row hist rp-muted"><span class="rp-chip">' + h.label + '</span><span class="rp-grow">' + h.detail + '</span><b style="color:rgb(var(--c-text))">' + h.total + '</b></div>';
    }).join('');
  }
  async function save() { try { await rp.storage.set('history', state.history.slice(0, 20), 'chat'); } catch (e) {} }

  async function doRoll() {
    var adv = state.sides === 20 && state.count === 1 && $('adv').checked;
    var picks = [];
    for (var i = 0; i < state.count; i++) picks.push(roll(state.sides));
    var detail, sum;
    if (adv) {
      var second = roll(20);
      sum = Math.max(picks[0], second);
      detail = 'advantage: ' + picks[0] + ', ' + second + ' → ' + sum;
      picks = [sum];
    } else {
      sum = picks.reduce(function (a, b) { return a + b; }, 0);
      detail = picks.length > 1 ? picks.join(' + ') : 'rolled ' + picks[0];
    }
    var total = sum + state.mod;
    if (state.mod) detail += (state.mod > 0 ? ' + ' : ' − ') + Math.abs(state.mod);
    state.last = { label: label() + (adv ? ' (adv)' : ''), detail: detail, total: total };
    $('total').textContent = total;
    $('total').classList.remove('pop'); void $('total').offsetWidth; $('total').classList.add('pop');
    $('detail').textContent = state.last.label + ': ' + detail;
    $('flag').innerHTML = '';
    if (state.sides === 20 && state.count === 1) {
      if (picks[0] === 20) $('flag').innerHTML = '<span class="rp-chip">Natural 20!</span>';
      if (picks[0] === 1) $('flag').innerHTML = '<span class="rp-chip" style="background:rgb(var(--c-danger)/.14);color:rgb(var(--c-danger))">Critical miss</span>';
    }
    state.history.unshift(state.last);
    $('send').disabled = false;
    render();
    save();
    if (info.settings.announce && info.permissions.indexOf('chat.write') >= 0) {
      try { await rp.chat.append('*rolls ' + state.last.label + ': ' + detail + ', total ' + total + '*', { as: 'user' }); } catch (e) { rp.log(e.message); }
    }
  }

  $('roll').onclick = doRoll;
  $('cMinus').onclick = function () { state.count = Math.max(1, state.count - 1); render(); };
  $('cPlus').onclick = function () { state.count = Math.min(8, state.count + 1); render(); };
  $('mMinus').onclick = function () { state.mod = Math.max(-20, state.mod - 1); render(); };
  $('mPlus').onclick = function () { state.mod = Math.min(20, state.mod + 1); render(); };
  $('send').onclick = async function () {
    if (!state.last) return;
    $('send').disabled = true;
    try { await rp.chat.send('*rolls ' + state.last.label + ' and gets ' + state.last.total + '*'); }
    catch (e) { rp.notify(e.message, 'error'); }
    $('send').disabled = false;
  };

  try { state.history = (await rp.storage.get('history', 'chat')) || []; } catch (e) {}
  render();
})();
</script>`

export const diceTray: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'dice-tray',
    name: 'Dice Tray',
    version: '1.0.0',
    description: 'Roll d4 to d100 with bonuses and advantage. Rolls can post to the chat, and the character can react to them.',
    author: 'rp',
    glyph: '⚄',
    api: 1,
    permissions: ['chat.write'],
    panels: [{ id: 'tray', title: 'Dice', glyph: '⚄', entry: 'panel.html', slots: ['chat', 'view'] }],
    hooks: [],
    tools: [],
    settings: [{ key: 'announce', type: 'boolean', label: 'Post every roll to the chat', hint: 'Adds a line like "*rolls 1d20: 17*" as you.', default: true }],
  },
  files: { 'panel.html': PANEL },
}
