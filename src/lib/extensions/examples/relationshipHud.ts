// Example: a floating relationship ring for the chat. Shows a HUD panel, live `state` events and auto-sizing.

import type { ExtensionBundle } from '../manifest'

const PANEL = String.raw`<div class="wrap" id="wrap">
  <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
    <circle cx="32" cy="32" r="26" fill="none" stroke="rgb(var(--c-bg-sunken))" stroke-width="7"/>
    <circle id="arc" cx="32" cy="32" r="26" fill="none" stroke="rgb(var(--c-accent))" stroke-width="7" stroke-linecap="round" stroke-dasharray="0 163.4" transform="rotate(-90 32 32)" style="transition:stroke-dasharray .6s ease"/>
    <text id="num" x="32" y="37" text-anchor="middle" font-size="16" font-weight="700" fill="rgb(var(--c-text))">–</text>
  </svg>
  <div class="meta"><b id="stage">No chat</b><span id="sub" class="rp-muted"></span></div>
</div>
<style>
  body{padding:6px}
  .wrap{display:flex;align-items:center;gap:10px;padding:8px 14px 8px 8px;border-radius:999px;background:rgb(var(--c-bg-elevated)/.86);backdrop-filter:blur(10px);box-shadow:0 6px 24px rgb(0 0 0/.18)}
  .meta{display:flex;flex-direction:column;line-height:1.25;min-width:0}
  .meta b{text-transform:capitalize;font-size:13px}
  .meta span{font-size:11px}
</style>
<script>
(async function () {
  await rp.ready;
  var C = 2 * Math.PI * 26;
  var $ = function (id) { return document.getElementById(id); };
  function show(s) {
    if (!s) { $('stage').textContent = 'No chat'; $('num').textContent = '–'; $('sub').textContent = ''; $('arc').setAttribute('stroke-dasharray', '0 ' + C); return; }
    var w = Math.max(0, Math.min(100, Math.round(s.warmth)));
    $('arc').setAttribute('stroke-dasharray', (C * w / 100) + ' ' + C);
    $('num').textContent = w;
    $('stage').textContent = String(s.stage).replace(/_/g, ' ');
    $('sub').textContent = (s.coins ? s.coins + ' coins' : '') + (s.day !== null ? (s.coins ? ' · ' : '') + 'day ' + s.day : '');
  }
  async function refresh() { try { show(await rp.state.get()); } catch (e) { show(null); } }
  rp.on('state', show);
  rp.on('chat', refresh);
  refresh();
})();
</script>`

export const relationshipHud: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'relationship-hud',
    name: 'Relationship Ring',
    version: '1.0.0',
    description: 'A small floating ring that shows how warm things are, live, in the corner of the chat.',
    author: 'rp',
    glyph: '◐',
    api: 1,
    permissions: ['state.read'],
    panels: [{ id: 'ring', title: 'Ring', glyph: '◐', entry: 'panel.html', slots: ['hud'], anchor: 'top-right', width: 230 }],
    hooks: [],
    tools: [],
    settings: [],
  },
  files: { 'panel.html': PANEL },
}
