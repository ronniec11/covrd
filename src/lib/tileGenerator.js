import { supabase } from './supabase'

const BUCKET = 'floor-plans'
const TILE_SIZE = 256
// Base render quality for the sharpest (max) pyramid level — matches the
// desktop RENDER_SCALE used elsewhere in the app (Canvas.jsx) so tiles look
// as sharp as today's desktop floor plan rendering.
const BASE_SCALE = 4.0

function levelDims(fullW, fullH, maxLevel, level) {
  const factor = 2 ** (maxLevel - level)
  return { w: Math.max(1, Math.ceil(fullW / factor)), h: Math.max(1, Math.ceil(fullH / factor)) }
}

function tileCounts(w, h) {
  return { cols: Math.ceil(w / TILE_SIZE), rows: Math.ceil(h / TILE_SIZE) }
}

function pyramidLevels(fullW, fullH) {
  const maxLevel = Math.ceil(Math.log2(Math.max(fullW, fullH)))
  let minLevel = maxLevel
  while (minLevel > 0) {
    const { w, h } = levelDims(fullW, fullH, maxLevel, minLevel - 1)
    if (w <= TILE_SIZE && h <= TILE_SIZE) { minLevel -= 1 } else { break }
  }
  return { maxLevel, minLevel }
}

// Runs `tasks` (array of functions returning promises) with bounded parallelism.
async function runPool(tasks, concurrency, onEach) {
  let next = 0
  let completed = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      await tasks[i]()
      completed++
      onEach?.(completed, tasks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
}

async function uploadTile(pathPrefix, level, col, row, blob, format) {
  const path = `${pathPrefix}/${level}/${col}_${row}.${format}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
  })
  if (error) throw error
}

function canvasToBlob(canvas, format, quality) {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob returned null')), mime, quality)
  })
}

/**
 * Generates a tile pyramid from a PDF's first page, rendering each tile
 * directly from the PDF at its target resolution (via a translated render
 * transform) rather than rendering the whole page once and slicing it — so
 * generation never allocates a full-page-sized canvas, keeping it safe to
 * run on iPad.
 */
export async function generatePdfTiles(pdfUrl, { projectId, pageId, format = 'png', onProgress } = {}) {
  const pdfjsLib = await import('pdfjs-dist')
  const { default: pdfWorkerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

  const pdfDoc = await pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false }).promise
  const page = await pdfDoc.getPage(1)
  const baseViewport = page.getViewport({ scale: BASE_SCALE })
  const fullW = Math.round(baseViewport.width)
  const fullH = Math.round(baseViewport.height)
  const { maxLevel, minLevel } = pyramidLevels(fullW, fullH)
  const pathPrefix = `${projectId}/tiles/${pageId}`

  const jobs = []
  for (let level = minLevel; level <= maxLevel; level++) {
    const { w: lw, h: lh } = levelDims(fullW, fullH, maxLevel, level)
    const levelScale = BASE_SCALE / 2 ** (maxLevel - level)
    const levelViewport = page.getViewport({ scale: levelScale })
    const { cols, rows } = tileCounts(lw, lh)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tw = Math.min(TILE_SIZE, lw - col * TILE_SIZE)
        const th = Math.min(TILE_SIZE, lh - row * TILE_SIZE)
        jobs.push(async () => {
          const tileCanvas = document.createElement('canvas')
          tileCanvas.width = tw; tileCanvas.height = th
          await page.render({
            canvasContext: tileCanvas.getContext('2d'),
            viewport: levelViewport,
            transform: [1, 0, 0, 1, -col * TILE_SIZE, -row * TILE_SIZE],
          }).promise
          const blob = await canvasToBlob(tileCanvas, format)
          await uploadTile(pathPrefix, level, col, row, blob, format)
        })
      }
    }
  }

  await runPool(jobs, 5, (done, total) => onProgress?.(done, total))

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathPrefix)
  return { baseUrl: data.publicUrl, width: fullW, height: fullH, tileSize: TILE_SIZE, minLevel, maxLevel, format }
}

/**
 * Generates a tile pyramid from a plain raster image (JPG/PNG upload).
 * Unlike the PDF path, a raster source has to be decoded once in full before
 * any region can be cropped from it — so this decodes it exactly once,
 * bounded to the same MAX_DIM cap already used for iPad viewing elsewhere in
 * the app, then progressively halves that single in-memory canvas to build
 * each lower pyramid level (sharper than re-downsampling from the original
 * each time) and slices tiles from each level.
 */
export async function generateRasterTiles(imageUrl, { projectId, pageId, format = 'jpeg', quality = 0.9, onProgress } = {}) {
  const MAX_DIM = 4096
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = imageUrl })

  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
  const fullW = Math.round(img.width * scale)
  const fullH = Math.round(img.height * scale)
  let levelCanvas = document.createElement('canvas')
  levelCanvas.width = fullW; levelCanvas.height = fullH
  levelCanvas.getContext('2d').drawImage(img, 0, 0, fullW, fullH)

  const { maxLevel, minLevel } = pyramidLevels(fullW, fullH)
  const pathPrefix = `${projectId}/tiles/${pageId}`
  const levelCanvases = { [maxLevel]: levelCanvas }
  for (let level = maxLevel - 1; level >= minLevel; level--) {
    const { w: lw, h: lh } = levelDims(fullW, fullH, maxLevel, level)
    const prev = levelCanvases[level + 1]
    const c = document.createElement('canvas')
    c.width = lw; c.height = lh
    c.getContext('2d').drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, lw, lh)
    levelCanvases[level] = c
  }

  const jobs = []
  for (let level = minLevel; level <= maxLevel; level++) {
    const src = levelCanvases[level]
    const { cols, rows } = tileCounts(src.width, src.height)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tw = Math.min(TILE_SIZE, src.width - col * TILE_SIZE)
        const th = Math.min(TILE_SIZE, src.height - row * TILE_SIZE)
        jobs.push(async () => {
          const tileCanvas = document.createElement('canvas')
          tileCanvas.width = tw; tileCanvas.height = th
          tileCanvas.getContext('2d').drawImage(
            src, col * TILE_SIZE, row * TILE_SIZE, tw, th, 0, 0, tw, th
          )
          const blob = await canvasToBlob(tileCanvas, format, quality)
          await uploadTile(pathPrefix, level, col, row, blob, format)
        })
      }
    }
  }

  await runPool(jobs, 5, (done, total) => onProgress?.(done, total))

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathPrefix)
  return { baseUrl: data.publicUrl, width: fullW, height: fullH, tileSize: TILE_SIZE, minLevel, maxLevel, format }
}

/** Builds an OpenSeadragon custom TileSource object from stored tile_meta. */
export function buildTileSource(tileMeta) {
  return {
    width: tileMeta.width,
    height: tileMeta.height,
    tileSize: tileMeta.tileSize,
    minLevel: tileMeta.minLevel,
    maxLevel: tileMeta.maxLevel,
    getTileUrl(level, x, y) {
      return `${tileMeta.baseUrl}/${level}/${x}_${y}.${tileMeta.format}`
    },
  }
}

/** Removes all generated tile files for a page (call before regenerating or on page delete). */
export async function deleteTiles(projectId, pageId) {
  const prefix = `${projectId}/tiles/${pageId}`
  const levelDirs = await supabase.storage.from(BUCKET).list(prefix)
  if (levelDirs.error || !levelDirs.data?.length) return
  for (const dir of levelDirs.data) {
    const files = await supabase.storage.from(BUCKET).list(`${prefix}/${dir.name}`)
    if (files.data?.length) {
      await supabase.storage.from(BUCKET).remove(files.data.map(f => `${prefix}/${dir.name}/${f.name}`))
    }
  }
}
