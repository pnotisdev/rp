/** The "simple mode" sampler sliders (Settings → Generation */

export function creativityToParams(v: number) {
  return { temperature: Number((0.2 + (v / 100) * 1.6).toFixed(2)) }
}
export function focusToParams(v: number) {
  return { top_p: Number((1 - (v / 100) * 0.5).toFixed(2)) }
}
export function repetitionToParams(v: number) {
  return { rep_pen: Number((1.0 + (v / 100) * 0.3).toFixed(3)) }
}
export function paramsToCreativity(temperature: number) {
  return Math.round(((temperature - 0.2) / 1.6) * 100)
}
export function paramsToFocus(topP: number) {
  return Math.round(((1 - topP) / 0.5) * 100)
}
export function paramsToRepetition(repPen: number) {
  return Math.round(((repPen - 1.0) / 0.3) * 100)
}
