// Dice parsing and rolling as plain JS, shared by the bundles whose panels and scripts both roll. No backticks or ${ inside.

export const DICE_LIB = String.raw`
var Dice = (function () {
  function d(n) { return 1 + Math.floor(Math.random() * n); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

  // Reads "2d6+3", "d20 adv", "4d6kh3-1" from the start of src. Returns null when src does not start with dice.
  function parse(src) {
    var m = /^\s*(\d{0,2})d(\d{1,3})(?:(kh|kl)(\d{1,2}))?(?:\s*([+-])\s*(\d{1,4}))?(?:\s+(adv|dis)\b)?/i.exec(src);
    if (!m) return null;
    var count = m[1] ? parseInt(m[1], 10) : 1;
    var sides = parseInt(m[2], 10);
    if (count < 1 || count > 50 || sides < 2 || sides > 1000) return null;
    var keep = m[3] ? Math.min(count, Math.max(1, parseInt(m[4], 10))) : 0;
    var mod = m[6] ? (m[5] === '-' ? -1 : 1) * parseInt(m[6], 10) : 0;
    var adv = m[7] ? m[7].toLowerCase() : '';
    if (adv && (count !== 1)) adv = '';
    return { count: count, sides: sides, keepMode: m[3] ? m[3].toLowerCase() : '', keep: keep, mod: mod, adv: adv, rest: src.slice(m[0].length).trim() };
  }

  // Rolls a parsed expression. total, the dice that counted, the ones dropped, and a readable line.
  function roll(p) {
    var rolls = [];
    for (var i = 0; i < p.count; i++) rolls.push(d(p.sides));
    var kept = rolls.slice(), dropped = [];
    if (p.adv) {
      rolls.push(d(p.sides));
      var hi = Math.max.apply(null, rolls), lo = Math.min.apply(null, rolls);
      var pick = p.adv === 'adv' ? hi : lo;
      kept = [pick]; dropped = [p.adv === 'adv' ? lo : hi];
    } else if (p.keepMode) {
      var sorted = rolls.slice().sort(function (a, b) { return p.keepMode === 'kh' ? b - a : a - b; });
      kept = sorted.slice(0, p.keep); dropped = sorted.slice(p.keep);
    }
    var total = sum(kept) + p.mod;
    var label = (p.count > 1 ? p.count : '') + 'd' + p.sides + (p.keepMode ? p.keepMode + p.keep : '') + (p.mod ? (p.mod > 0 ? '+' : '-') + Math.abs(p.mod) : '') + (p.adv ? ' ' + p.adv : '');
    var shown = '[' + kept.join(', ') + ']' + (dropped.length ? ' (dropped ' + dropped.join(', ') + ')' : '') + (p.mod ? ' ' + (p.mod > 0 ? '+' : '-') + ' ' + Math.abs(p.mod) : '');
    var note = '';
    if (p.count === 1 && p.sides === 20 && kept.length === 1) note = kept[0] === 20 ? 'natural 20' : kept[0] === 1 ? 'natural 1' : '';
    return { label: label, kept: kept, dropped: dropped, total: total, note: note, text: label + ': ' + shown + ' = ' + total + (note ? ' (' + note + ')' : '') };
  }

  return { parse: parse, roll: roll, d: d };
})();
`
