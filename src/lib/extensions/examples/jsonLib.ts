// Tolerant JSON reading for model output, as plain JS shared by bundles that call rp.generate. No backticks or ${ inside.

export const JSON_LIB = String.raw`
// Models wrap JSON in prose or code fences. Returns the first array/object that parses, or null.
function parseLoose(text) {
  var s = String(text || '').replace(new RegExp(String.fromCharCode(96) + '{3}(?:json)?', 'gi'), '');
  var starts = ['[', '{'];
  for (var i = 0; i < starts.length; i++) {
    var open = starts[i], close = open === '[' ? ']' : '}';
    var a = s.indexOf(open), b = s.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  }
  return null;
}
`
