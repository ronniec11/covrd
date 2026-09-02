import { supabase } from './supabase'

const BUCKET = 'floor-plans'
const TILE_SIZE = 256
// Largest single render/decode allowed per canvas — same ceiling used
// elsewhere in the app for iPad memory safety (Canvas.jsx MAX_DIM). Any
// pyramid level bigger than this gets rendered in CHUNK-sized pieces
// instead of one shot, then sliced into TILE_SIZE output tiles.
const CHUNK = 2048
// Base render quality for the sharpest (max) pyramid level — matches the
// desktop RENDER_SCALE used elsewhere in the app (Canvas.jsx) so tiles look
// as sharp as today's desktop floor plan rendering.
const BASE_SCALE = 4.0

function levelDims(fullW, fullH, maxLevel, level) {
  const factor = 2 ** (maxLevel - level)
  return { w: Math.max(1, Math.ceil(fullW / factor)), h: Math.max(1, Math.ceil(fullH / factor)) }
}

function pyramidLevels(fullW, fullH) {
  const maxLevel = Math.ceil(Math.log2(Math.max(fullW, fullH)))
  let minLevel = maxLevel
  while (minLevel > 0) {
    const { w, h } = levelDims(fullW, fullH, maxLevel, minLevel)
    if (w <= TILE_SIZE && h <= TILE_SIZE) break
    minLevel -= 1
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

// Slices `srcCanvas` (a rendered chunk/level, positioned at (chunkX,chunkY)
// within the full level) into TILE_SIZE output tiles and queues an
// upload job for each — shared by both the PDF chunk renderer and the
// raster level slicer below, since once a source canvas exists in memory
// this step is identical for both.
function queueTileSlices(jobs, srcCanvas, chunkX, chunkY, levelW, levelH, pathPrefix, level, format, quality) {
  // chunkX/chunkY are always exact multiples of TILE_SIZE at both call sites
  // (CHUNK is a multiple of TILE_SIZE for the PDF path; 0 for the raster path).
  const firstCol = Math.floor(chunkX / TILE_SIZE)
  const firstRow = Math.floor(chunkY / TILE_SIZE)
  const lastCol = Math.floor((Math.min(chunkX + srcCanvas.width, levelW) - 1) / TILE_SIZE)
  const lastRow = Math.floor((Math.min(chunkY + srcCanvas.height, levelH) - 1) / TILE_SIZE)
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const tileX = col * TILE_SIZE, tileY = row * TILE_SIZE
      const tw = Math.min(TILE_SIZE, levelW - tileX)
      const th = Math.min(TILE_SIZE, levelH - tileY)
      const sx = tileX - chunkX, sy = tileY - chunkY
      jobs.push(async () => {
        const tileCanvas = document.createElement('canvas')
        tileCanvas.width = tw; tileCanvas.height = th
        tileCanvas.getContext('2d').drawImage(srcCanvas, sx, sy, tw, th, 0, 0, tw, th)
        const blob = await canvasToBlob(tileCanvas, format, quality)
        await uploadTile(pathPrefix, level, col, row, blob, format)
      })
    }
  }
}

/**
 * Generates a tile pyramid from a PDF's first page. Renders each level in
 * CHUNK-sized pieces (memory-bounded — never allocates a canvas bigger than
 * CHUNK×CHUNK, so this is safe to run on iPad) rather than one render call
 * per final TILE_SIZE tile: for a large sheet that's the difference between
 * ~2000 individual pdf.js render passes and ~50, since each render replays
 * the page's full operator list regardless of how small the output canvas
 * is — tile-per-render was measured to make generation impractically slow.
 * Output tiles are sliced from each rendered chunk via cheap canvas copies.
 */
export async function generatePdfTiles(pdfUrl, { projectId, pageId, format = 'png', onProgress } = {}) {
  console.log('[tileGenerator] Starting PDF tile generation:', pdfUrl)
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
  console.log('[tileGenerator] PDF page size at BASE_SCALE:', fullW, 'x', fullH, 'levels:', minLevel, '-', maxLevel)

  const jobs = []
  let chunkCount = 0
  for (let level = minLevel; level <= maxLevel; level++) {
    const { w: lw, h: lh } = levelDims(fullW, fullH, maxLevel, level)
    const levelScale = BASE_SCALE / 2 ** (maxLevel - level)
    const levelViewport = page.getViewport({ scale: levelScale })
    const chunkCols = Math.ceil(lw / CHUNK)
    const chunkRows = Math.ceil(lh / CHUNK)
    for (let cr = 0; cr < chunkRows; cr++) {
      for (let cc = 0; cc < chunkCols; cc++) {
        const chunkX = cc * CHUNK, chunkY = cr * CHUNK
        const cw = Math.min(CHUNK, lw - chunkX)
        const ch = Math.min(CHUNK, lh - chunkY)
        chunkCount++
        jobs.push(async () => {
          const chunkCanvas = document.createElement('canvas')
          chunkCanvas.width = cw; chunkCanvas.height = ch
          await page.render({
            canvasContext: chunkCanvas.getContext('2d'),
            viewport: levelViewport,
            transform: [1, 0, 0, 1, -chunkX, -chunkY],
          }).promise
          const tileJobs = []
          queueTileSlices(tileJobs, chunkCanvas, chunkX, chunkY, lw, lh, pathPrefix, level, format)
          await runPool(tileJobs, 6)
        })
      }
    }
  }
  console.log('[tileGenerator] Rendering', chunkCount, 'chunk(s) across', maxLevel - minLevel + 1, 'levels')

  let done = 0
  await runPool(jobs, 2, () => {
    done++
    console.log('[tileGenerator] Rendered chunk', done, '/', chunkCount)
    onProgress?.(done, chunkCount)
  })

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathPrefix)
  console.log('[tileGenerator] PDF tiling complete:', data.publicUrl)
  return { baseUrl: data.publicUrl, width: fullW, height: fullH, tileSize: TILE_SIZE, minLevel, maxLevel, format }
}

/**
 * Generates a tile pyramid from a plain raster image (JPG/PNG upload).
 * A raster source has to be decoded once in full before any region can be
 * cropped from it — so this decodes it exactly once, bounded to the same
 * MAX_DIM-equivalent (CHUNK) cap already used for iPad viewing elsewhere in
 * the app, then progressively halves that single in-memory canvas to build
 * each lower pyramid level (sharper than re-downsampling from the original
 * each time) and slices tiles from each level.
 */
export async function generateRasterTiles(imageUrl, { projectId, pageId, format = 'jpeg', quality = 0.9, onProgress } = {}) {
  console.log('[tileGenerator] Starting raster tile generation:', imageUrl)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = imageUrl })

  const scale = Math.min(1, CHUNK / Math.max(img.width, img.height))
  const fullW = Math.round(img.width * scale)
  const fullH = Math.round(img.height * scale)
  let levelCanvas = document.createElement('canvas')
  levelCanvas.width = fullW; levelCanvas.height = fullH
  levelCanvas.getContext('2d').drawImage(img, 0, 0, fullW, fullH)

  const { maxLevel, minLevel } = pyramidLevels(fullW, fullH)
  const pathPrefix = `${projectId}/tiles/${pageId}`
  console.log('[tileGenerator] Raster image size (capped):', fullW, 'x', fullH, 'levels:', minLevel, '-', maxLevel)
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
    queueTileSlices(jobs, src, 0, 0, src.width, src.height, pathPrefix, level, format, quality)
  }
  console.log('[tileGenerator] Slicing', jobs.length, 'tile(s)')

  let done = 0
  await runPool(jobs, 6, () => { done++; onProgress?.(done, jobs.length) })

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathPrefix)
  console.log('[tileGenerator] Raster tiling complete:', data.publicUrl)
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
