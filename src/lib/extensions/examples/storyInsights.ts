// Example: analytics for the open chat. Reply length, who writes how much, dialogue vs action, favourite words and a repetition radar (panel plus a small HUD).

import type { ExtensionBundle } from '../manifest'

/** Pure chat statistics over [{role, text, createdAt}]. Shared by the panel and the HUD. */
export const INSIGHT_LIB = String.raw`
var Insights = (function () {
  var STOP = {};
  ('a about after again all also am an and any are as at back be because been before being but by can could did do does down for from get got had has have he her here him his how i if in into is it its just like me more my no not now of off on one only or our out over said she so some than that the their them then there these they this to too up us was we were what when which who will with would you your yes oh well').split(' ').forEach(function (w) { STOP[w] = 1; });

  function words(t) { return String(t).toLowerCase().match(/[a-zÀ-ɏ]+(?:'[a-z]+)?/g) || []; }
  function count(t) { return (String(t).match(/\S+/g) || []).length; }
  function inside(t, re) {
    var n = 0, m;
    while ((m = re.exec(t))) n += count(m[1]);
    return n;
  }
  function top(map, limit, min) {
    return Object.keys(map).filter(function (k) { return map[k] >= min; }).sort(function (a, b) { return map[b] - map[a] || (a < b ? -1 : 1); }).slice(0, limit).map(function (k) { return { text: k, n: map[k] }; });
  }

  // How many replies share their opening three words, or a four-word run (with at least two meaningful words).
  function repetition(replies) {
    var recent = replies.slice(-40);
    if (recent.length < 6) return { level: 'n/a', score: 0, openers: [], phrases: [] };
    var openers = {}, grams = {}, perMsg = [];
    recent.forEach(function (t, i) {
      var w = words(t);
      if (w.length >= 3) { var o = w.slice(0, 3).join(' '); openers[o] = (openers[o] || 0) + 1; }
      var seen = {};
      for (var k = 0; k + 4 <= w.length; k++) {
        var g = w.slice(k, k + 4);
        if (g.filter(function (x) { return !STOP[x]; }).length < 2) continue;
        seen[g.join(' ')] = 1;
      }
      perMsg[i] = Object.keys(seen);
      perMsg[i].forEach(function (g2) { grams[g2] = (grams[g2] || 0) + 1; });
    });
    var hit = perMsg.filter(function (list) { return list.some(function (g3) { return grams[g3] >= 3; }); }).length;
    var score = Math.round(100 * hit / recent.length);
    return { level: score < 25 ? 'Low' : score < 50 ? 'Moderate' : 'High', score: score, openers: top(openers, 4, 3), phrases: top(grams, 5, 3) };
  }

  function analyze(msgs) {
    var user = msgs.filter(function (m) { return m.role === 'user'; });
    var char = msgs.filter(function (m) { return m.role !== 'user'; });
    var uw = 0, cw = 0, quoted = 0, acted = 0, favourite = {}, lengths = [], days = {};
    user.forEach(function (m) { uw += count(m.text); });
    char.forEach(function (m) {
      var n = count(m.text);
      cw += n; lengths.push(n);
      quoted += inside(m.text, /["“]([^"”]+)["”]/g);
      acted += inside(m.text, /\*([^*]+)\*/g);
      words(m.text).forEach(function (w) { if (w.length >= 4 && !STOP[w]) favourite[w] = (favourite[w] || 0) + 1; });
    });
    msgs.forEach(function (m) { if (m.createdAt) { var d = new Date(m.createdAt).toDateString(); days[d] = (days[d] || 0) + 1; } });
    var dayList = Object.keys(days).map(function (d) { return { day: d, n: days[d], at: new Date(d).getTime() }; }).sort(function (a, b) { return a.at - b.at; }).slice(-14);
    var plain = Math.max(0, cw - quoted - acted);
    var pct = function (n) { return cw ? Math.round(100 * n / cw) : 0; };
    var stamps = msgs.map(function (m) { return m.createdAt || 0; }).filter(Boolean);
    return {
      total: msgs.length, userCount: user.length, charCount: char.length, userWords: uw, charWords: cw,
      avgReply: char.length ? Math.round(cw / char.length) : 0, avgUser: user.length ? Math.round(uw / user.length) : 0,
      lengths: lengths.slice(-30), longest: lengths.length ? Math.max.apply(null, lengths) : 0,
      share: uw + cw ? Math.round(100 * cw / (uw + cw)) : 0,
      dialogue: pct(quoted), action: pct(acted), narration: pct(plain),
      repetition: repetition(char.map(function (m) { return m.text; })),
      favourites: top(favourite, 12, 3), days: dayList,
      span: stamps.length ? { from: Math.min.apply(null, stamps), to: Math.max.apply(null, stamps) } : null
    };
  }
  return { analyze: analyze, repetition: repetition, count: count };
})();
`

const PANEL = String.raw`<div class="rp-stack" id="root"></div>
<style>
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
  .tile{border:1px solid rgb(var(--c-border));border-radius:8px;padding:10px}
  .tile b{display:block;font-size:1.3rem;font-variant-numeric:tabular-nums}
  .tile span{font-size:12px;color:rgb(var(--c-text-muted))}
  .sect{border:1px solid rgb(var(--c-border));border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px}
  .seg{display:flex;height:10px;border-radius:5px;overflow:hidden;background:rgb(var(--c-bg-sunken))}
  .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:rgb(var(--c-text-muted))}
  .dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
  .lv-Low{color:rgb(var(--c-success))}.lv-Moderate{color:rgb(var(--c-warning))}.lv-High{color:rgb(var(--c-danger))}
  .ph{display:flex;justify-content:space-between;gap:10px;font-size:13px}
  .ph span:last-child{color:rgb(var(--c-text-muted))}
</style>
<script>
` + INSIGHT_LIB + String.raw`
(async function () {
  await rp.ready;
  var root = document.getElementById('root');
  var timer = null;
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function svg(html, w, hgt) { var d = document.createElement('div'); d.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + hgt + '" width="100%" height="' + hgt + '" preserveAspectRatio="none">' + html + '</svg>'; return d; }
  function bars(values, color) {
    var max = Math.max.apply(null, values.concat([1])), w = 300, hg = 60, bw = w / Math.max(values.length, 1);
    return svg(values.map(function (v, i) { var bh = Math.max(2, Math.round(hg * v / max)); return '<rect x="' + (i * bw + 1) + '" y="' + (hg - bh) + '" width="' + Math.max(1, bw - 2) + '" height="' + bh + '" rx="1.5" fill="' + color + '"/>'; }).join(''), w, hg);
  }
  function tile(value, label) { return h('div', { class: 'tile' }, [h('b', { text: String(value) }), h('span', { text: label })]); }
  function seg(parts) {
    var el = h('div', { class: 'seg' });
    parts.forEach(function (p) { var s = document.createElement('i'); s.style.cssText = 'display:block;width:' + p.v + '%;background:' + p.c; el.appendChild(s); });
    return el;
  }
  function legend(parts) {
    return h('div', { class: 'legend' }, parts.map(function (p) { var l = h('span'); var d = h('span', { class: 'dot' }); d.style.background = p.c; l.append(d, document.createTextNode(p.t + ' ' + p.v + '%')); return l; }));
  }

  async function refresh() {
    var msgs = [];
    try { msgs = await rp.chat.messages(200); } catch (e) { root.innerHTML = ''; root.appendChild(h('p', { class: 'rp-muted', text: 'Open a chat to see its insights.' })); return; }
    var s = Insights.analyze(msgs);
    root.innerHTML = '';
    if (s.total < 2) { root.appendChild(h('p', { class: 'rp-muted', text: 'Not enough messages yet.' })); return; }
    var acc = 'rgb(var(--c-accent))', mut = 'rgb(var(--c-text-muted))', warm = 'rgb(var(--c-warning))';
    root.appendChild(h('div', { class: 'tiles' }, [tile(s.total, 'messages'), tile(s.avgReply, 'words per reply'), tile(s.longest, 'longest reply'), tile(s.avgUser, 'words per yours')]));

    root.appendChild(h('div', { class: 'sect' }, [h('div', { class: 'rp-label', text: 'Who writes more' }), seg([{ v: 100 - s.share, c: acc }, { v: s.share, c: mut }]), legend([{ t: 'You', v: 100 - s.share, c: acc }, { t: 'Character', v: s.share, c: mut }])]));
    root.appendChild(h('div', { class: 'sect' }, [h('div', { class: 'rp-label', text: 'What the character writes' }), seg([{ v: s.dialogue, c: acc }, { v: s.action, c: warm }, { v: s.narration, c: mut }]), legend([{ t: 'Dialogue', v: s.dialogue, c: acc }, { t: 'Action', v: s.action, c: warm }, { t: 'Narration', v: s.narration, c: mut }])]));
    root.appendChild(h('div', { class: 'sect' }, [h('div', { class: 'rp-label', text: 'Reply length, last ' + s.lengths.length }), bars(s.lengths, acc)]));

    var r = s.repetition;
    var rep = h('div', { class: 'sect' }, [h('div', { class: 'rp-label', text: 'Repetition radar' })]);
    if (r.level === 'n/a') rep.appendChild(h('div', { class: 'rp-muted', text: 'Needs about six replies.' }));
    else {
      rep.appendChild(h('div', { class: 'lv-' + r.level, text: r.level + ' - ' + r.score + '% of recent replies reuse a phrase from other replies' }));
      r.phrases.forEach(function (p) { rep.appendChild(h('div', { class: 'ph' }, [h('span', { text: '"' + p.text + '"' }), h('span', { text: p.n + ' replies' })])); });
      r.openers.forEach(function (p) { rep.appendChild(h('div', { class: 'ph' }, [h('span', { text: 'Opens with "' + p.text + '..."' }), h('span', { text: p.n + ' times' })])); });
      if (!r.phrases.length && !r.openers.length) rep.appendChild(h('div', { class: 'rp-muted', text: 'Nothing is repeating.' }));
    }
    root.appendChild(rep);

    if (s.favourites.length) root.appendChild(h('div', { class: 'sect' }, [h('div', { class: 'rp-label', text: 'Words the character leans on' }), h('div', { class: 'rp-row rp-wrap' }, s.favourites.map(function (f) { return h('span', { class: 'rp-chip', text: f.text + ' ' + f.n }); }))]));
    if (s.days.length > 1) root.appendChild(h('div', { class: 'sect' }, [h('div', { class: 'rp-label', text: 'Messages per day' }), bars(s.days.map(function (d) { return d.n; }), acc)]));
  }
  function later() { clearTimeout(timer); timer = setTimeout(refresh, 600); }
  rp.on('message', later);
  rp.on('chat', refresh);
  refresh();
})();
</script>`

const HUD = String.raw`<div class="pill" id="pill" style="display:none"></div>
<style>
  body{padding:6px}
  .pill{display:inline-flex;gap:8px;padding:6px 10px;border-radius:8px;background:rgb(var(--c-bg-elevated)/.92);border:1px solid rgb(var(--c-border));font-size:12px;white-space:nowrap}
  .pill b.Low{color:rgb(var(--c-success))}.pill b.Moderate{color:rgb(var(--c-warning))}.pill b.High{color:rgb(var(--c-danger))}
  .pill span{color:rgb(var(--c-text-muted))}
</style>
<script>
` + INSIGHT_LIB + String.raw`
(async function () {
  await rp.ready;
  var pill = document.getElementById('pill'), timer = null;
  async function refresh() {
    var msgs = [];
    try { msgs = await rp.chat.messages(60); } catch (e) {}
    var s = Insights.analyze(msgs);
    if (s.charCount < 3) { pill.style.display = 'none'; return; }
    pill.style.display = 'inline-flex';
    pill.innerHTML = '';
    var level = document.createElement('b'); level.className = s.repetition.level; level.textContent = s.repetition.level === 'n/a' ? 'Repeats: n/a' : 'Repeats: ' + s.repetition.level;
    var avg = document.createElement('span'); avg.textContent = s.avgReply + ' words/reply';
    pill.append(level, avg);
  }
  function later() { clearTimeout(timer); timer = setTimeout(refresh, 600); }
  rp.on('message', later);
  rp.on('chat', refresh);
  refresh();
})();
</script>`

export const storyInsights: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'story-insights',
    name: 'Story Insights',
    version: '1.0.0',
    description: 'Charts for the open chat: reply length, who writes more, dialogue vs action, favourite words, and a repetition radar that warns when the AI starts reusing phrases.',
    author: 'rp',
    glyph: '▤',
    api: 1,
    permissions: ['chat.read'],
    panels: [
      { id: 'insights', title: 'Insights', glyph: '▤', entry: 'insights.html', slots: ['chat', 'view'] },
      { id: 'radar', title: 'Repetition radar', glyph: '◎', entry: 'radar.html', slots: ['hud'], anchor: 'top-left', width: 260 },
    ],
    hooks: [],
    tools: [],
    settings: [],
  },
  files: { 'insights.html': PANEL, 'radar.html': HUD },
}
