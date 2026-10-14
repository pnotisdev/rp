// Small image helpers: keep attached and generated pictures a sensible size before they are stored or sent to a model.

/** The size that fits inside `max` on its longest edge, never enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Re-encodes a data URL as a JPEG no larger than `maxEdge`. Anything that fails to decode is returned unchanged. */
export async function shrinkImage(dataUrl: string, maxEdge = 1024, quality = 0.85): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image load failed'))
      el.src = dataUrl
    })
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge)
    if (width === img.naturalWidth && height === img.naturalHeight && dataUrl.length < 400_000) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return dataUrl
  }
}
