import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import './Canvas.css'

// NOTE: Run this migration in Supabase SQL editor before using count tool:
// ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS count_data jsonb DEFAULT '[]';

const COLORS = [
  '#facc15','#4ade80','#60a5fa','#f97316','#f472b6','#a78bfa',
  '#ef4444','#06b6d4','#84cc16','#f59e0b','#ffffff','#64748b',
]
const SCALES = {
  '1:1':{n:1,d:1/12},'1:32':{n:1/32,d:1},'3:64':{n:3/64,d:1},
  '1:16':{n:1/16,d:1},'3:32':{n:3/32,d:1},'1:8':{n:1/8,d:1},
  '3:16':{n:3/16,d:1},'1:4':{n:1/4,d:1},'3:8':{n:3/8,d:1},
  '1:2':{n:1/2,d:1},'3:4':{n:3/4,d:1},'1:0':{n:1,d:1},'1.5:0':{n:1.5,d:1}
}
const DAY_COLORS = [
  '#facc15','#4ade80','#60a5fa','#f97316','#f472b6',
  '#a78bfa','#ef4444','#06b6d4','#84cc16','#fb923c',
  '#e879f9','#34d399','#f87171','#38bdf8','#fbbf24',
]

export default function Canvas() {
  const { pageId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const wrapRef          = useRef(null)
  const planRef          = useRef(null)
  const hlRef            = useRef(null)
  const penRef           = useRef(null)
  const countRef         = useRef(null)   // count markers layer
  const drawRef          = useRef(null)
  const cursorRingRef    = useRef(null)
  const calibStatusRef   = useRef(null)
  const zoomBarRef       = useRef(null)
  const uploadZoneRef    = useRef(null)
  const unsavedBadgeRef  = useRef(null)   // "Unsaved changes" indicator
  const editBannerRef    = useRef(null)
  const editBannerTxtRef = useRef(null)
  // header
  const pageTitleRef     = useRef(null)
  const scaleSelectRef   = useRef(null)
  const customWrapRef    = useRef(null)
  const cNumerRef        = useRef(null)
  const cDenomRef        = useRef(null)
  const calibBtnRef      = useRef(null)
  const calibInfoRef     = useRef(null)
  const hdrSessionRef       = useRef(null)
  const hdrTotalRef         = useRef(null)
  const hdrPctRef           = useRef(null)
  const hdrProgressFillRef  = useRef(null)
  // sidebar
  const btnHlRef         = useRef(null)
  const btnPenRef        = useRef(null)
  const btnErRef         = useRef(null)
  const btnCountRef      = useRef(null)   // count tool button
  const brushRangeRef    = useRef(null)
  const brushValRef      = useRef(null)
  const colorGridRef     = useRef(null)
  const progressFillRef  = useRef(null)
  const totalSFsbRef     = useRef(null)
  const targetDisplayRef = useRef(null)
  const targetInputRef   = useRef(null)
  const sessionListRef   = useRef(null)
  const emptyMsgRef      = useRef(null)
  const footerRef        = useRef(null)
  // ctx menu
  const ctxMenuRef       = useRef(null)
  const ctxColorsRef     = useRef(null)
  const ctxBrushRef      = useRef(null)
  const ctxBrushValRef   = useRef(null)
  const ctxBtnHlRef      = useRef(null)
  const ctxBtnPenRef     = useRef(null)
  const ctxBtnErRef      = useRef(null)
  // edit modal
  const editModalRef     = useRef(null)
  const editNameRef      = useRef(null)
  const editSFRef        = useRef(null)
  const editColorsRef    = useRef(null)
  const editCountRef     = useRef(null)
  // history modal
  const histModalRef     = useRef(null)
  const calMonthLblRef   = useRef(null)
  const calGridRef       = useRef(null)
  const calDayPanelRef   = useRef(null)
  const calBarsRef       = useRef(null)
  const calLegendRef     = useRef(null)

  const api = useRef({})

  useEffect(() => {
    if (!user || !pageId) return

    const DPR = window.devicePixelRatio || 1

    const wrap   = wrapRef.current
    const planEl = planRef.current
    const hlEl   = hlRef.current
    const penEl  = penRef.current
    const countEl = countRef.current
    const drawEl = drawRef.current
    if (!wrap || !planEl || !hlEl || !penEl || !countEl || !drawEl) return

    const planCtx  = planEl.getContext('2d')
    const hlCtx    = hlEl.getContext('2d')
    const penCtx   = penEl.getContext('2d')
    const countCtx = countEl.getContext('2d')
    const drawCtx  = drawEl.getContext('2d')

    // ── RAF ───────────────────────────────────────────────────────────────────
    let rafId = 0
    function scheduleRedraw() {
      if (rafId) return
      rafId = requestAnimationFrame(() => { rafId = 0; redrawAll() })
    }

    // ── MUTABLE STATE ─────────────────────────────────────────────────────────
    let pages          = []
    let activePage     = null
    let tool           = 'highlight'
    let brushSize      = 20
    let activeColor    = '#facc15'
    let sessionCounter = 1
    let soloSession    = null
    let userProfile    = null   // fetched once in init()
    let dbProjectId    = null   // from page record
    const deletedSessionIds = new Set()

    let calibrating   = false
    let calibPt1      = null
    let calibMousePos = null

    let isPainting  = false
    let isPanning   = false
    let panStart    = {x:0, y:0}
    let lastPenPt   = null

    let cW = 0, cH = 0

    // Offscreen stroke canvases — full opacity; composited at 30% to screen
    let liveHlCanvas  = document.createElement('canvas')
    let liveHlCtx     = liveHlCanvas.getContext('2d')
    let livePenCanvas = document.createElement('canvas')
    let livePenCtx    = livePenCanvas.getContext('2d')
    let undoStack     = []

    // Count tool
    let liveCountMarkers = []   // {id, x, y, num, color} in image coords
    let hoveredMarkerId  = null
    let countSymbol = 'num'     // 'num' | 'check' | 'x'

    // Session composite cache
    let sessionsHL    = document.createElement('canvas')
    let sessionsPen   = document.createElement('canvas')
    let sessionsCount = document.createElement('canvas')
    let sessionsValid = false

    function invalidateSessions() { sessionsValid = false }

    function rebuildSessionsCache() {
      if (!activePage || !activePage.image || sessionsValid) return
      const img = activePage.image
      for (const c of [sessionsHL, sessionsPen, sessionsCount]) {
        c.width = img.width; c.height = img.height
      }
      const hlc  = sessionsHL.getContext('2d')
      const penc = sessionsPen.getContext('2d')
      if (!hlc || !penc) return
      hlc.clearRect(0, 0, img.width, img.height)
      penc.clearRect(0, 0, img.width, img.height)
      activePage.sessions.forEach(s => {
        if (s._hidden || !s.hlCanvas || s.hlCanvas.width === 0) return
        const tinted = tintCanvas(s.hlCanvas, s.color)
        if (tinted) hlc.drawImage(tinted, 0, 0)
      })
      activePage.sessions.forEach(s => {
        if (s.penCanvas && !s._hidden) penc.drawImage(s.penCanvas, 0, 0)
      })
      sessionsValid = true
    }

    // history
    let dayRecords      = []
    let todayTarget       = 0
    let totalBuildingSF   = 0   // project's total_sf_target, for the header % bar
    let calYear         = 0
    let calMonth        = 0
    let calSelectedDate = null
    let dayColorIdx     = 0
    let editTarget      = null
    let editingSession  = false
    let prevTool        = 'highlight'
    let draftInterval   = null
    let realtimeSub     = null
    let cachedLivePx    = 0   // pixel count of liveHlCanvas, updated on content change
    let cachedTotalPx   = 0   // pixel count of all sessions + live, updated on content change
    let cachedTodaySF   = 0   // SF total for today's sessions + live, updated on content change

    // ── SCALE HELPERS ─────────────────────────────────────────────────────────
    function ppf(n, d) { return (96 * n) / d }

    function onScaleChange() {
      if (!scaleSelectRef.current) return
      const v = scaleSelectRef.current.value
      if (customWrapRef.current) customWrapRef.current.style.display = v === 'custom' ? 'flex' : 'none'
      if (v === 'custom') { applyCustomScale(); return }
      if (activePage) {
        const s = SCALES[v]
        const ppi = activePage.ppi || 72 * 3.0
        activePage.ppf = (s.n / s.d) * ppi
        activePage.scale = v; activePage.calibrated = false
        if (calibInfoRef.current) calibInfoRef.current.style.display = 'none'
      }
      updateSFDisplay()
    }

    function applyCustomScale() {
      const n = parseFloat(cNumerRef.current?.value) || 1
      const d = parseFloat(cDenomRef.current?.value) || 30
      if (activePage) {
        const ppi = activePage.ppi || 72 * 3.0
        activePage.ppf = (n / d) * ppi
        activePage.scale = 'custom'; activePage.calibrated = false
      }
      updateSFDisplay()
    }

    // ── PAGE MANAGEMENT ───────────────────────────────────────────────────────
    function addPage(img, name, ppiIn) {
      const sv = scaleSelectRef.current?.value || '1:8'
      const s  = SCALES[sv] || SCALES['1:8']
      const pg = {
        id: Date.now(), name, image: img,
        ppf: ppiIn ? (s.n / s.d) * ppiIn : ppf(s.n, s.d),
        scale: sv, ppi: ppiIn || null,
        sessions: [], zoom: 1, pan: {x:0, y:0},
      }
      pages = [pg]; activePage = pg
      if (pageTitleRef.current) pageTitleRef.current.textContent = name
      applyScaleToPage(pg, ppiIn)
      ensureLive(); setupCanvases(); renderSessions(); updateSF()
    }

    function applyScaleToPage(pg, ppi) {
      const sv = pg.scale || '1:8'; if (sv === 'custom') return
      const s = SCALES[sv]; if (!s) return
      pg.ppf = ppi ? (s.n / s.d) * ppi : ppf(s.n, s.d)
    }

    // ── CANVAS SETUP ──────────────────────────────────────────────────────────
    function ensureLive() {
      if (!activePage) return
      const img = activePage.image
      if (liveHlCanvas.width !== img.width || liveHlCanvas.height !== img.height) {
        liveHlCanvas.width = img.width; liveHlCanvas.height = img.height
        liveHlCtx = liveHlCanvas.getContext('2d')
      }
      if (livePenCanvas.width !== img.width || livePenCanvas.height !== img.height) {
        livePenCanvas.width = img.width; livePenCanvas.height = img.height
        livePenCtx = livePenCanvas.getContext('2d')
      }
    }

    function applyDPRTransform() {
      for (const ctx of [planCtx, hlCtx, penCtx, countCtx, drawCtx])
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }

    function setupCanvases() {
      cW = wrap.clientWidth; cH = wrap.clientHeight
      for (const c of [planEl, hlEl, penEl, countEl, drawEl]) {
        c.width = Math.round(cW * DPR); c.height = Math.round(cH * DPR)
        c.style.width = cW + 'px'; c.style.height = cH + 'px'
        c.style.display = 'block'
      }
      applyDPRTransform()
      if (uploadZoneRef.current) uploadZoneRef.current.classList.add('hidden')
      if (zoomBarRef.current) zoomBarRef.current.style.display = 'flex'
      ensureLive()
      if (!activePage._fitted) { resetView(); activePage._fitted = true }
      redrawAll()
    }

    function resetView() {
      if (!activePage) return
      const img = activePage.image
      const currentW = wrap.clientWidth
      const currentH = wrap.clientHeight
      cW = currentW
      cH = currentH
      const z = Math.min(currentW / img.width, currentH / img.height) * 0.95
      activePage.zoom = z
      activePage.pan = {
        x: (currentW - img.width * z) / 2,
        y: (currentH - img.height * z) / 2,
      }
      redrawAll()
    }

    // ── DRAW ─────────────────────────────────────────────────────────────────
    function redrawAll() {
      if (!activePage) return
      rebuildSessionsCache()
      const img = activePage.image, z = activePage.zoom, p = activePage.pan

      planCtx.clearRect(0, 0, cW, cH)
      planCtx.save(); planCtx.translate(p.x, p.y); planCtx.scale(z, z)
      planCtx.imageSmoothingEnabled = true; planCtx.imageSmoothingQuality = 'high'
      planCtx.drawImage(img, 0, 0); planCtx.restore()

      redrawHL(); redrawPen(); drawCountLayer()
    }

    function redrawHL() {
      if (!activePage) return
      hlCtx.clearRect(0, 0, cW, cH)
      const z = activePage.zoom, p = activePage.pan
      hlCtx.save(); hlCtx.translate(p.x, p.y); hlCtx.scale(z, z)
      hlCtx.globalAlpha = 0.30
      if (soloSession) {
        if (soloSession.hlCanvas) {
          const tinted = tintCanvas(soloSession.hlCanvas, soloSession.color)
          if (tinted) hlCtx.drawImage(tinted, 0, 0)
        }
      } else {
        if (sessionsHL.width > 0) hlCtx.drawImage(sessionsHL, 0, 0)
        if (liveHlCanvas.width > 0) hlCtx.drawImage(liveHlCanvas, 0, 0)
      }
      hlCtx.restore()
    }

    function redrawPen() {
      if (!activePage) return
      penCtx.clearRect(0, 0, cW, cH)
      const z = activePage.zoom, p = activePage.pan
      penCtx.save(); penCtx.translate(p.x, p.y); penCtx.scale(z, z)
      penCtx.globalAlpha = 1.0
      if (soloSession) {
        if (soloSession.penCanvas) penCtx.drawImage(soloSession.penCanvas, 0, 0)
      } else {
        if (sessionsPen.width > 0) penCtx.drawImage(sessionsPen, 0, 0)
        if (livePenCanvas.width > 0) penCtx.drawImage(livePenCanvas, 0, 0)
      }
      penCtx.restore()
    }

    // ── COUNT LAYER ───────────────────────────────────────────────────────────
    function drawCountLayer() {
      if (!activePage) return
      countCtx.clearRect(0, 0, cW, cH)
      const z = activePage.zoom, p = activePage.pan

      const all = []
      if (!soloSession) {
        activePage.sessions.forEach(s => {
          if (!s._hidden && s.countMarkers) s.countMarkers.forEach(m => all.push(m))
        })
        liveCountMarkers.forEach(m => all.push(m))
      } else if (soloSession.countMarkers) {
        soloSession.countMarkers.forEach(m => all.push(m))
      }

      all.forEach(m => {
        const sx = m.x * z + p.x
        const sy = m.y * z + p.y
        const r = Math.max(10, 14 * Math.min(z, 1.5))
        const isHovered = m.id === hoveredMarkerId

        countCtx.save()
        // Shadow for visibility
        countCtx.shadowColor = 'rgba(0,0,0,0.5)'
        countCtx.shadowBlur  = 4
        // Fill circle
        countCtx.beginPath()
        countCtx.arc(sx, sy, r, 0, Math.PI * 2)
        countCtx.fillStyle = isHovered ? '#ef4444' : (m.color || '#4ade80')
        countCtx.fill()
        countCtx.strokeStyle = '#fff'
        countCtx.lineWidth = 2
        countCtx.shadowBlur = 0
        countCtx.stroke()
        // Label
        countCtx.font = `bold ${Math.max(9, r * 0.85)}px system-ui,sans-serif`
        countCtx.textAlign = 'center'
        countCtx.textBaseline = 'middle'
        countCtx.fillStyle = '#fff'
        countCtx.fillText(isHovered ? '\u00d7' : String(m.num), sx, sy)
        countCtx.restore()
      })
    }

    function placeCountMarker(sx, sy) {
      if (!activePage) return
      const pt = s2i(sx, sy)
      liveCountMarkers.push({
        id: Date.now(),
        x: pt.x, y: pt.y,
        num: liveCountMarkers.length + 1,
        color: activeColor,
      })
      drawCountLayer()
      updateUnsaved(true)
    }

    function tintCanvas(src, hexColor) {
      try {
        if (!src || !hexColor || src.width === 0 || src.height === 0) return null
        const out = document.createElement('canvas')
        out.width = src.width; out.height = src.height
        const ctx = out.getContext('2d')
        if (!ctx) return null
        ctx.fillStyle = hexColor
        ctx.fillRect(0, 0, out.width, out.height)
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(src, 0, 0)
        return out
      } catch (e) {
        console.warn('[Canvas] tintCanvas failed:', e)
        return null
      }
    }

    // ── UNSAVED BADGE ─────────────────────────────────────────────────────────
    function updateUnsaved(hasContent) {
      const badge = unsavedBadgeRef.current
      if (!badge) return
      badge.style.display = hasContent ? 'flex' : 'none'
    }

    function checkHasLiveContent() {
      if (liveCountMarkers.length > 0) return true
      const hd = liveHlCtx.getImageData(0, 0, liveHlCanvas.width, liveHlCanvas.height).data
      for (let i = 3; i < hd.length; i += 4) if (hd[i] > 10) return true
      return false
    }

    // ── TOAST ─────────────────────────────────────────────────────────────────
    function showToast(msg, isError = false) {
      let t = document.getElementById('ct-toast')
      if (!t) {
        t = document.createElement('div')
        t.id = 'ct-toast'
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;pointer-events:none;transition:opacity 0.3s;'
        document.body.appendChild(t)
      }
      t.textContent = msg
      t.style.background = isError ? '#ef4444' : '#4ade80'
      t.style.color = isError ? '#fff' : '#000'
      t.style.opacity = '1'
      clearTimeout(t._timer)
      t._timer = setTimeout(() => { t.style.opacity = '0' }, 2500)
    }

    // ── INPUT ─────────────────────────────────────────────────────────────────
    function s2i(sx, sy) {
      const z = activePage.zoom, p = activePage.pan
      return {x: (sx - p.x) / z, y: (sy - p.y) / z}
    }

    function getOffset(e) {
      const rect = drawEl.getBoundingClientRect()
      return {x: e.clientX - rect.left, y: e.clientY - rect.top}
    }

    function onDown(e) {
      if (!activePage) return
      const pos = getOffset(e)
      if (calibrating && e.button === 0) { handleCalibClick(pos.x, pos.y); return }
      if (e.button === 1 || e.altKey) {
        isPanning = true
        panStart = {x: e.clientX - activePage.pan.x, y: e.clientY - activePage.pan.y}
        drawEl.style.cursor = 'grabbing'; return
      }
      if (e.button === 0) {
        if (tool === 'count') {
          const hit = liveCountMarkers.findIndex(m => {
            const sx = m.x * activePage.zoom + activePage.pan.x
            const sy = m.y * activePage.zoom + activePage.pan.y
            return Math.hypot(pos.x - sx, pos.y - sy) < 20
          })
          if (hit !== -1) {
            liveCountMarkers.splice(hit, 1)
            liveCountMarkers.forEach((m, i) => m.num = i + 1)
            drawCountLayer(); updateUnsaved(true); return
          }
          placeCountMarker(pos.x, pos.y); return
        }
        if (soloSession) { soloSession = null; renderSessions() }
        isPainting = true; lastPenPt = null
        undoStack.push({
          hl:  liveHlCtx.getImageData(0, 0, liveHlCanvas.width, liveHlCanvas.height),
          pen: livePenCtx.getImageData(0, 0, livePenCanvas.width, livePenCanvas.height),
          cnt: [...liveCountMarkers],
        })
        if (undoStack.length > 40) undoStack.shift()
        const pt = s2i(pos.x, pos.y)
        doPaint(pt.x, pt.y, null); lastPenPt = pt
      }
    }

    function onMove(e) {
      const pos = getOffset(e)
      const ring = cursorRingRef.current

      if (calibrating) {
        calibMousePos = {x: pos.x, y: pos.y}; drawCalibLine()
        ring.style.display = 'none'; return
      }

      if (tool === 'count') {
        ring.style.display = 'none'
        if (activePage) {
          const prev = hoveredMarkerId
          const hit = liveCountMarkers.find(m => {
            const sx = m.x * activePage.zoom + activePage.pan.x
            const sy = m.y * activePage.zoom + activePage.pan.y
            return Math.hypot(pos.x - sx, pos.y - sy) < 20
          })
          hoveredMarkerId = hit?.id || null
          if (hoveredMarkerId !== prev) drawCountLayer()
          drawEl.style.cursor = hoveredMarkerId ? 'pointer' : 'crosshair'
        }
      } else {
        ring.style.width  = brushSize * 2 + 'px'
        ring.style.height = brushSize * 2 + 'px'
        ring.style.left   = pos.x + 'px'; ring.style.top = pos.y + 'px'
        ring.style.display = activePage ? 'block' : 'none'
        ring.style.border = tool === 'highlight' ? '2px solid rgba(250,204,21,0.7)' :
                            tool === 'pen'        ? '2px solid rgba(96,165,250,0.8)' :
                                                    '2px solid rgba(248,113,113,0.8)'
      }

      if (isPanning) {
        activePage.pan = {x: e.clientX - panStart.x, y: e.clientY - panStart.y}
        scheduleRedraw(); return
      }
      if (isPainting) {
        const pt = s2i(pos.x, pos.y)
        doPaint(pt.x, pt.y, lastPenPt); lastPenPt = pt
      }
    }

    function onUp() {
      if (isPainting) {
        isPainting = false; lastPenPt = null
        cancelAnimationFrame(rafId); rafId = 0
        redrawAll(); updateSF()
        if (checkHasLiveContent()) updateUnsaved(true)
      }
      isPanning = false; drawEl.style.cursor = 'crosshair'
    }

    function onLeave() {
      if (cursorRingRef.current) cursorRingRef.current.style.display = 'none'
      drawCtx.clearRect(0, 0, cW, cH)
      if (hoveredMarkerId !== null) { hoveredMarkerId = null; drawCountLayer() }
    }

    // ── SMOOTH STROKE PAINTING ────────────────────────────────────────────────
    function doPaint(ix, iy, prev) {
      const r = brushSize / activePage.zoom
      if (tool === 'highlight') {
        liveHlCtx.save()
        liveHlCtx.strokeStyle = activeColor
        liveHlCtx.lineWidth = r * 2
        liveHlCtx.lineCap = liveHlCtx.lineJoin = 'round'
        liveHlCtx.globalCompositeOperation = 'source-over'
        liveHlCtx.beginPath()
        liveHlCtx.moveTo(prev ? prev.x : ix, prev ? prev.y : iy)
        liveHlCtx.lineTo(ix, iy)
        liveHlCtx.stroke()
        liveHlCtx.restore()
        scheduleRedraw()
      } else if (tool === 'pen') {
        livePenCtx.save()
        livePenCtx.strokeStyle = activeColor
        livePenCtx.lineWidth = Math.max(1, r * 0.5)
        livePenCtx.lineCap = livePenCtx.lineJoin = 'round'
        livePenCtx.globalCompositeOperation = 'source-over'
        livePenCtx.beginPath()
        livePenCtx.moveTo(prev ? prev.x : ix, prev ? prev.y : iy)
        livePenCtx.lineTo(ix, iy)
        livePenCtx.stroke()
        livePenCtx.restore()
        scheduleRedraw()
      } else {
        for (const ctx of [liveHlCtx, livePenCtx]) {
          ctx.save()
          ctx.globalCompositeOperation = 'destination-out'
          ctx.strokeStyle = 'rgba(0,0,0,1)'
          ctx.lineWidth = r * 2
          ctx.lineCap = ctx.lineJoin = 'round'
          ctx.beginPath()
          ctx.moveTo(prev ? prev.x : ix, prev ? prev.y : iy)
          ctx.lineTo(ix, iy)
          ctx.stroke()
          ctx.restore()
        }
        scheduleRedraw()
      }
    }

    // ── ZOOM & PAN ────────────────────────────────────────────────────────────
    function onWheel(e) {
      e.preventDefault(); if (!activePage) return
      if (e.ctrlKey) {
        const f = e.deltaY < 0 ? 1.08 : 0.926
        const pos = getOffset(e)
        activePage.pan.x = pos.x - (pos.x - activePage.pan.x) * f
        activePage.pan.y = pos.y - (pos.y - activePage.pan.y) * f
        activePage.zoom *= f; scheduleRedraw(); return
      }
      if (e.deltaX !== 0 || e.shiftKey) {
        activePage.pan.x -= e.deltaX * 1.5
        activePage.pan.y -= e.deltaY * 1.5
        scheduleRedraw(); return
      }
      const f = e.deltaY < 0 ? 1.12 : 0.893
      const pos = getOffset(e)
      activePage.pan.x = pos.x - (pos.x - activePage.pan.x) * f
      activePage.pan.y = pos.y - (pos.y - activePage.pan.y) * f
      activePage.zoom *= f; scheduleRedraw()
    }

    function doZoom(f) {
      if (!activePage) return
      const cx = cW / 2, cy = cH / 2
      activePage.pan.x = cx - (cx - activePage.pan.x) * f
      activePage.pan.y = cy - (cy - activePage.pan.y) * f
      activePage.zoom *= f; scheduleRedraw()
    }

    // ── TOUCH ─────────────────────────────────────────────────────────────────
    let touchPanStart = null, touchPanOrigin = null, lastTouchPt = null, touchPainting = false

    function getTouchPos(e) {
      const rect = drawEl.getBoundingClientRect()
      const t = e.touches[0] || e.changedTouches[0]
      return {x: t.clientX - rect.left, y: t.clientY - rect.top}
    }

    function onTouchStart(e) {
      e.preventDefault(); if (!activePage) return
      if (e.touches.length === 2) {
        touchPainting = false; lastTouchPt = null
        const r = drawEl.getBoundingClientRect()
        const mx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - r.left
        const my = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - r.top
        touchPanStart = {x: mx, y: my}; touchPanOrigin = {...activePage.pan}; return
      }
      const pos = getTouchPos(e)
      if (calibrating) { handleCalibClick(pos.x, pos.y); return }
      if (tool === 'count') {
        const hit = liveCountMarkers.findIndex(m => {
          const sx = m.x * activePage.zoom + activePage.pan.x
          const sy = m.y * activePage.zoom + activePage.pan.y
          return Math.hypot(pos.x - sx, pos.y - sy) < 24  // slightly larger tap target for touch
        })
        if (hit !== -1) {
          liveCountMarkers.splice(hit, 1)
          liveCountMarkers.forEach((m, i) => m.num = i + 1)
          drawCountLayer(); updateUnsaved(true); return
        }
        placeCountMarker(pos.x, pos.y); return
      }
      touchPainting = true; lastTouchPt = null
      undoStack.push({
        hl:  liveHlCtx.getImageData(0, 0, liveHlCanvas.width, liveHlCanvas.height),
        pen: livePenCtx.getImageData(0, 0, livePenCanvas.width, livePenCanvas.height),
        cnt: [...liveCountMarkers],
      })
      if (undoStack.length > 40) undoStack.shift()
      const pt = s2i(pos.x, pos.y)
      doPaint(pt.x, pt.y, null); lastTouchPt = pt
    }

    function onTouchMove(e) {
      e.preventDefault(); if (!activePage) return
      if (e.touches.length === 2 && touchPanStart) {
        const r = drawEl.getBoundingClientRect()
        const mx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - r.left
        const my = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - r.top
        activePage.pan = {x: touchPanOrigin.x + (mx - touchPanStart.x), y: touchPanOrigin.y + (my - touchPanStart.y)}
        scheduleRedraw(); return
      }
      if (!touchPainting) return
      const pos = getTouchPos(e)
      const pt = s2i(pos.x, pos.y)
      doPaint(pt.x, pt.y, lastTouchPt); lastTouchPt = pt
    }

    function onTouchEnd(e) {
      e.preventDefault()
      touchPainting = false; touchPanStart = null; lastTouchPt = null
      cancelAnimationFrame(rafId); rafId = 0
      redrawAll(); updateSF()
      if (checkHasLiveContent()) updateUnsaved(true)
    }

    // ── CALIBRATION ───────────────────────────────────────────────────────────
    function startCalib() {
      if (!activePage) { alert('Add a page first.'); return }
      calibrating = true; calibPt1 = null
      if (calibBtnRef.current) calibBtnRef.current.classList.add('active')
      if (calibStatusRef.current) { calibStatusRef.current.style.display = 'block'; calibStatusRef.current.textContent = 'Click point 1 on the plan...' }
    }

    function cancelCalib() {
      calibrating = false; calibPt1 = null
      if (calibBtnRef.current) calibBtnRef.current.classList.remove('active')
      if (calibStatusRef.current) calibStatusRef.current.style.display = 'none'
      drawCtx.clearRect(0, 0, cW, cH)
    }

    function drawCalibLine() {
      drawCtx.clearRect(0, 0, cW, cH)
      if (!calibPt1 || !calibMousePos) return
      const z = activePage.zoom, p = activePage.pan
      const sx1 = calibPt1.x * z + p.x, sy1 = calibPt1.y * z + p.y
      drawCtx.save()
      drawCtx.strokeStyle = '#f97316'; drawCtx.lineWidth = 2; drawCtx.setLineDash([6, 4])
      drawCtx.beginPath(); drawCtx.moveTo(sx1, sy1); drawCtx.lineTo(calibMousePos.x, calibMousePos.y); drawCtx.stroke()
      drawCtx.setLineDash([]); drawCtx.fillStyle = '#f97316'
      drawCtx.beginPath(); drawCtx.arc(sx1, sy1, 5, 0, Math.PI * 2); drawCtx.fill()
      drawCtx.restore()
    }

    function handleCalibClick(sx, sy) {
      const pt = s2i(sx, sy)
      if (!calibPt1) { calibPt1 = pt; if (calibStatusRef.current) calibStatusRef.current.textContent = 'Click point 2 on the plan...'; return }
      const dx = pt.x - calibPt1.x, dy = pt.y - calibPt1.y
      const px = Math.sqrt(dx * dx + dy * dy)
      const ans = prompt('Enter the real distance between those 2 points in feet:', '')
      if (!ans || isNaN(parseFloat(ans))) { cancelCalib(); return }
      activePage.ppf = px / parseFloat(ans)
      activePage.calibrated = true
      supabase.from('pages').upsert({ id: pageId, pixels_per_foot: activePage.ppf, calibrated: true })
        .then(({ error }) => { if (error) console.error('[Canvas] Calib save error:', error) })
      if (calibInfoRef.current) { calibInfoRef.current.style.display = 'inline'; calibInfoRef.current.textContent = 'Calibrated: ' + activePage.ppf.toFixed(1) + ' px/ft' }
      cancelCalib(); updateSF()
    }

    // ── SF ────────────────────────────────────────────────────────────────────
    function countPx(cvs) {
      if (!activePage) return 0
      const img = activePage.image
      const tmp = document.createElement('canvas')
      tmp.width = img.width; tmp.height = img.height
      if (cvs) { const tmpCtx = tmp.getContext('2d'); if (tmpCtx && tmp.width > 0) tmpCtx.drawImage(cvs, 0, 0) }
      const d = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height).data
      let c = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) c++
      return c
    }

    function toSF(px) { return activePage ? px / (activePage.ppf * activePage.ppf) : 0 }

    function updateSF() {
      if (!activePage) { if (hdrSessionRef.current) hdrSessionRef.current.textContent = '0'; if (hdrTotalRef.current) hdrTotalRef.current.textContent = '0'; return }
      cachedLivePx = countPx(liveHlCanvas)
      // Total SF = sum of all non-hidden sessions + current unsaved live work
      cachedTodaySF = activePage.sessions
        .filter(s => !s._hidden)
        .reduce((sum, s) => sum + (s.sf || 0), 0)
        + toSF(cachedLivePx)
      updateSFDisplay()
    }

    // Fast display update — no ImageData reads, safe to call on scale changes
    function updateSFDisplay() {
      if (!activePage) return
      const liveSF     = Math.round(toSF(cachedLivePx))
      const totalSF    = Math.round(cachedTodaySF)
      const totalPct   = totalBuildingSF > 0 ? Math.round((cachedTodaySF / totalBuildingSF) * 100) : 0
      const barPct     = totalBuildingSF > 0 ? Math.min((cachedTodaySF / totalBuildingSF) * 100, 100) : 0
      if (hdrSessionRef.current)      hdrSessionRef.current.textContent      = liveSF.toLocaleString()
      if (hdrTotalRef.current)        hdrTotalRef.current.textContent        = totalSF.toLocaleString()
      if (hdrPctRef.current)          hdrPctRef.current.textContent          = totalBuildingSF > 0 ? totalPct + '%' : '–'
      if (hdrProgressFillRef.current) hdrProgressFillRef.current.style.width = barPct + '%'
      updateProgressBar()
    }

    // ── TOOLS ─────────────────────────────────────────────────────────────────
    function setTool(t) {
      if (tool !== 'erase' && t !== 'erase' && t !== 'count') prevTool = t
      tool = t
      if (btnHlRef.current)    btnHlRef.current.className    = 'ct-tbtn' + (t === 'highlight' ? ' t-hl' : '')
      if (btnPenRef.current)   btnPenRef.current.className   = 'ct-tbtn' + (t === 'pen'       ? ' t-pen' : '')
      if (btnErRef.current)    btnErRef.current.className    = 'ct-tbtn' + (t === 'erase'     ? ' t-er' : '')
      if (btnCountRef.current) btnCountRef.current.className = 'ct-tbtn' + (t === 'count'     ? ' t-count' : '')
    }

    function updateBrush() {
      if (brushRangeRef.current) brushSize = parseInt(brushRangeRef.current.value)
      if (brushValRef.current) brushValRef.current.textContent = brushSize
    }

    function pickColor(hex) {
      activeColor = hex
      colorGridRef.current.querySelectorAll('.ct-cc').forEach(c => c.classList.remove('sel'))
      const match = colorGridRef.current.querySelector(`[data-c="${hex}"]`)
      if (match) match.classList.add('sel')
      if (tool === 'erase') setTool(prevTool)
    }

    // ── UNDO ─────────────────────────────────────────────────────────────────
    function undoLast() {
      // Count tool: pop last marker directly (count placement doesn't push to undoStack)
      if (tool === 'count' && liveCountMarkers.length > 0) {
        liveCountMarkers.pop()
        liveCountMarkers.forEach((m, i) => m.num = i + 1)
        drawCountLayer()
        updateUnsaved(checkHasLiveContent())
        return
      }
      if (!undoStack.length) return
      const snap = undoStack.pop()
      liveHlCtx.putImageData(snap.hl, 0, 0)
      livePenCtx.putImageData(snap.pen, 0, 0)
      if (snap.cnt) liveCountMarkers = snap.cnt
      redrawAll(); updateSF()
      updateUnsaved(checkHasLiveContent())
    }

    // ── SESSIONS ─────────────────────────────────────────────────────────────
    async function saveSession() {
      if (!activePage) { showToast('No floor plan loaded', true); return }
      ensureLive()

      const hd  = liveHlCtx.getImageData(0, 0, liveHlCanvas.width, liveHlCanvas.height).data
      const pd  = livePenCtx.getImageData(0, 0, livePenCanvas.width, livePenCanvas.height).data
      let hasHL = false; for (let i = 3; i < hd.length; i += 4) { if (hd[i] > 10) { hasHL = true; break } }
      let hasPen = false; for (let i = 3; i < pd.length; i += 4) { if (pd[i] > 10) { hasPen = true; break } }
      if (!hasHL && !hasPen && liveCountMarkers.length === 0) {
        showToast('Nothing to save — paint first!', true); return
      }

      // Use profile name as default; fall back to auth email prefix
      const userName = userProfile?.full_name || user.email?.split('@')[0] || 'Session'
      const name = prompt('Session name (optional — press Enter to use your name):', userName)
      if (name === null) return  // user cancelled
      const sessionName = (name && name.trim()) ? name.trim() : userName

      const sf   = toSF(countPx(liveHlCanvas))
      const countTotal = liveCountMarkers.length
      const date = getCurrentDate()
      const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})

      // Snapshot live canvases
      const snapHL  = document.createElement('canvas')
      snapHL.width  = liveHlCanvas.width;  snapHL.height = liveHlCanvas.height
      const snapHLCtx = snapHL.getContext('2d')
      if (snapHLCtx && snapHL.width > 0) snapHLCtx.drawImage(liveHlCanvas, 0, 0)

      const snapPen = document.createElement('canvas')
      snapPen.width  = livePenCanvas.width; snapPen.height = livePenCanvas.height
      const snapPenCtx = snapPen.getContext('2d')
      if (snapPenCtx && snapPen.width > 0) snapPenCtx.drawImage(livePenCanvas, 0, 0)

      const snapCount = [...liveCountMarkers]

      const session = {
        id: sessionCounter++, name: sessionName,
        color: activeColor,
        userColor: userProfile?.avatar_color || activeColor,
        userName: userProfile?.full_name || user.email?.split('@')[0] || 'User',
        sf, count: countTotal, date, time,
        hlCanvas: snapHL, penCanvas: snapPen,
        countMarkers: snapCount,
        pageId: activePage.id, pageName: activePage.name,
      }
      activePage.sessions.push(session)
      invalidateSessions()

      if (!dayRecords.find(r => r.date === date)) {
        dayRecords.push({date, target: todayTarget, sessions: [], dayColor: getDayColor(date)})
        dayRecords.sort((a, b) => b.date.localeCompare(a.date))
      }

      // Clear live canvas after snapshot — saved session visible via sessions cache
      liveHlCtx.clearRect(0, 0, liveHlCanvas.width, liveHlCanvas.height)
      livePenCtx.clearRect(0, 0, livePenCanvas.width, livePenCanvas.height)
      liveCountMarkers = []
      undoStack = []
      if (hdrSessionRef.current) hdrSessionRef.current.textContent = '0'

      // Clear draft from localStorage
      try { localStorage.removeItem(`draft_${pageId}`) } catch {}
      updateUnsaved(false)

      redrawAll(); renderSessions(); updateSF(); saveDayToHistory()

      // Persist to Supabase
      const saved = await saveSessionToSupabase(session)
      if (saved) showToast('Session saved!')
    }

    async function saveSessionToSupabase(session) {
      try {
        const insertPayload = {
          page_id:        pageId,
          project_id:     dbProjectId,
          user_id:        user.id,
          name:           session.name,
          color:          session.color,
          sf:             session.sf,
          work_date:      session.date,
          highlight_data: session.hlCanvas.toDataURL('image/png'),
          pen_data:       session.penCanvas ? session.penCanvas.toDataURL('image/png') : null,
          count_data:     session.countMarkers?.length > 0 ? session.countMarkers : null,
          updated_at:     new Date().toISOString(),
        }

        const { error } = await supabase.from('sessions').insert(insertPayload)
        if (error) throw error
        console.log('[Canvas] Session saved to Supabase')
        return true
      } catch (err) {
        console.error('[Canvas] Failed to save session:', err)
        showToast('Save failed: ' + (err.message || 'check console'), true)
        return false
      }
    }

    async function deleteSession(pgId, sId, e) {
      e.stopPropagation()
      const pg = pages.find(p => p.id === pgId); if (!pg) return
      const sess = pg.sessions.find(s => s.id === sId)
      pg.sessions = pg.sessions.filter(s => s.id !== sId)
      if (soloSession?.id === sId) soloSession = null
      invalidateSessions(); redrawAll(); renderSessions(); updateSF()
      if (sess?.supabaseId) {
        deletedSessionIds.add(sess.supabaseId)
        await supabase.from('sessions').delete().eq('id', sess.supabaseId)
      }
    }

    function toggleSolo(sess) {
      soloSession = (soloSession?.id === sess.id) ? null : sess
      redrawAll(); renderSessions(); updateSF()
    }

    function renderSessions() {
      const list  = sessionListRef.current
      const empty = emptyMsgRef.current
      const all   = []
      pages.forEach(pg => pg.sessions.forEach(s => all.push({s, pg})))
      list.querySelectorAll('.ct-scard').forEach(c => c.remove())
      if (!all.length) { empty.style.display = 'block'; return }
      empty.style.display = 'none'
      all.forEach(({s, pg}) => {
        const card = document.createElement('div')
        card.className = 'ct-scard' + (soloSession?.id === s.id ? ' solo' : '')

        const editBtn = document.createElement('button')
        editBtn.className = 'ct-scard-edit'; editBtn.title = 'Edit'; editBtn.textContent = 'Edit'
        editBtn.addEventListener('click', ev => openEditModal(pg.id, s.id, ev))

        const delBtn = document.createElement('button')
        delBtn.className = 'ct-scard-del'; delBtn.title = 'Delete'; delBtn.textContent = 'Del'
        delBtn.addEventListener('click', ev => deleteSession(pg.id, s.id, ev))

        const top = document.createElement('div'); top.className = 'ct-scard-top'
        // User avatar dot (profile color) + session name
        const dot = document.createElement('div'); dot.className = 'ct-scard-dot'
        dot.style.background = s.userColor || s.color || '#4ade80'
        dot.title = s.userName || s.name
        const nm  = document.createElement('div'); nm.className = 'ct-scard-name'; nm.textContent = s.name
        const sb  = document.createElement('span'); sb.className = 'ct-solo-badge'; sb.textContent = 'SOLO'
        top.append(dot, nm, sb, editBtn, delBtn)

        const sfDiv = document.createElement('div'); sfDiv.className = 'ct-scard-sf'
        const _count = s.count ?? s.countMarkers?.length ?? 0
        if (s.sf > 0 && _count > 0) {
          sfDiv.textContent = `${Math.round(s.sf).toLocaleString()} SF · ${_count} items`
        } else if (_count > 0) {
          sfDiv.textContent = `${_count} items`
        } else {
          sfDiv.textContent = `${Math.round(s.sf).toLocaleString()} SF`
        }
        card.append(top, sfDiv)

        const metaDiv = document.createElement('div'); metaDiv.className = 'ct-scard-meta'
        metaDiv.textContent = pg.name + ' · ' + (s.time || s.date || '') + ' · ' + (s.userName || s.name || '')
        card.appendChild(metaDiv)
        card.addEventListener('click', () => toggleSolo(s))
        list.appendChild(card)
      })
    }

    // ── DRAFT (localStorage) ──────────────────────────────────────────────────
    function saveDraft() {
      try {
        // Only save lightweight state, not canvas image data
        const draft = {
          scale: activePage?.scale || '1:8',
          color: activeColor,
          brushSize,
          timestamp: Date.now(),
        }
        localStorage.setItem(`draft_${pageId}`, JSON.stringify(draft))
      } catch (e) {
        console.warn('[Canvas] Draft save failed:', e)
      }
    }

    function loadDraft() {
      try {
        const raw = localStorage.getItem(`draft_${pageId}`)
        if (!raw) return
        const draft = JSON.parse(raw)
        const age = Date.now() - (draft.savedAt || 0)
        if (age > 7 * 24 * 60 * 60 * 1000) { localStorage.removeItem(`draft_${pageId}`); return } // expire after 7 days

        if (draft.hlData) {
          const img = new Image()
          img.onload = () => { liveHlCtx.drawImage(img, 0, 0); redrawHL(); updateUnsaved(true) }
          img.src = draft.hlData
        }
        if (draft.penData) {
          const img = new Image()
          img.onload = () => { livePenCtx.drawImage(img, 0, 0); redrawPen() }
          img.src = draft.penData
        }
        if (draft.countMarkers?.length > 0) {
          liveCountMarkers = draft.countMarkers
          drawCountLayer(); updateUnsaved(true)
        }
        if (draft.hlData || draft.penData || draft.countMarkers?.length > 0) {
          console.log('[Canvas] Draft restored from localStorage')
        }
      } catch (e) { console.warn('[Canvas] Draft load failed:', e) }
    }

    // ── EXPORT ────────────────────────────────────────────────────────────────
    function exportAll() {
      const date = getCurrentDate()
      let txt = 'Covrd - Daily Report\nDate: ' + date + '\n\n'; let grand = 0
      pages.forEach(pg => {
        txt += '=== ' + pg.name + ' ===\n'
        pg.sessions.forEach((s, i) => {
          txt += `  ${i+1}. ${s.name} — ${Math.round(s.sf).toLocaleString()} SF`
          if (s.countMarkers?.length) txt += ` + ${s.countMarkers.length} items counted`
          txt += ` (${s.time})\n`
          grand += s.sf
        })
        txt += '\n'
      })
      txt += 'GRAND TOTAL: ' + Math.round(grand).toLocaleString() + ' SF\n'
      const blob = new Blob([txt], {type: 'text/plain'})
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = 'cleantrack-' + date + '.txt'; a.click()

      pages.forEach(pg => {
        if (!pg.image) return
        const exp = document.createElement('canvas')
        exp.width = pg.image.width; exp.height = pg.image.height
        const ec = exp.getContext('2d'); ec.drawImage(pg.image, 0, 0)
        ec.globalAlpha = 0.3
        pg.sessions.forEach(s => { if (s.hlCanvas) ec.drawImage(s.hlCanvas, 0, 0) })
        ec.globalAlpha = 1
        pg.sessions.forEach(s => { if (s.penCanvas) ec.drawImage(s.penCanvas, 0, 0) })
        const lk = document.createElement('a')
        lk.href = exp.toDataURL('image/png')
        lk.download = 'cleantrack-' + pg.name.replace(/\s+/g, '-') + '-' + date + '.png'
        lk.click()
      })
    }

    // ── CONTEXT MENU ──────────────────────────────────────────────────────────
    function syncCtxToolBtns() {
      if (ctxBtnHlRef.current)  ctxBtnHlRef.current.className  = 'ct-ctx-tbtn' + (tool === 'highlight' ? ' t-hl' : '')
      if (ctxBtnPenRef.current) ctxBtnPenRef.current.className = 'ct-ctx-tbtn' + (tool === 'pen'       ? ' t-pen' : '')
      if (ctxBtnErRef.current)  ctxBtnErRef.current.className  = 'ct-ctx-tbtn' + (tool === 'erase'     ? ' t-er' : '')
    }
    function ctxSetTool(t) { setTool(t); syncCtxToolBtns(); closeCtxMenu() }
    function ctxBrushChange(val) {
      brushSize = parseInt(val)
      if (brushValRef.current) brushValRef.current.textContent = val
      if (brushRangeRef.current) brushRangeRef.current.value = val
      if (ctxBrushValRef.current) ctxBrushValRef.current.textContent = val
    }
    function openCtxMenu(x, y) {
      if (ctxBrushRef.current) ctxBrushRef.current.value = brushSize
      if (ctxBrushValRef.current) ctxBrushValRef.current.textContent = brushSize
      ctxColorsRef.current.querySelectorAll('.ct-ctx-cc').forEach((el, i) => el.classList.toggle('sel', COLORS[i] === activeColor))
      syncCtxToolBtns()
      const menu = ctxMenuRef.current; menu.style.display = 'block'
      menu.style.left = Math.min(x, window.innerWidth - 208) + 'px'
      menu.style.top  = Math.min(y, window.innerHeight - 230) + 'px'
    }
    function closeCtxMenu() { if (ctxMenuRef.current) ctxMenuRef.current.style.display = 'none' }

    // ── EDIT MODAL ────────────────────────────────────────────────────────────
    function openEditModal(pgId, sId, e) {
      e.stopPropagation()
      const pg = pages.find(p => p.id === pgId); if (!pg) return
      const s  = pg.sessions.find(x => x.id === sId); if (!s) return
      editTarget = {pg, s}
      if (editNameRef.current) editNameRef.current.value = s.name
      if (editSFRef.current) editSFRef.current.value = Math.round(s.sf)
      if (editCountRef.current) editCountRef.current.textContent = (s.count ?? s.countMarkers?.length ?? 0) + ' items'
      if (editColorsRef.current) editColorsRef.current.querySelectorAll('.ct-modal-cc').forEach(el => el.classList.toggle('sel', el.dataset.c === s.color))
      if (editModalRef.current) editModalRef.current.classList.add('open')
    }
    function closeEditModal() { if (editModalRef.current) editModalRef.current.classList.remove('open') }
    async function saveEdit() {
      if (!editTarget) return
      const {s} = editTarget
      const newName = editNameRef.current?.value.trim()
      const newSF   = parseFloat(editSFRef.current?.value)
      const sel     = editColorsRef.current?.querySelector('.ct-modal-cc.sel')
      if (newName) s.name = newName
      if (!isNaN(newSF) && newSF >= 0) s.sf = newSF
      if (sel) s.color = sel.dataset.c
      editTarget = null; closeEditModal(); invalidateSessions()
      renderSessions(); updateSF(); redrawAll()
      if (s.supabaseId) {
        console.log('[Canvas] Updating session in Supabase:', s.supabaseId, s.name)
        await supabase.from('sessions').update({
          name:  s.name,
          color: s.color,
          sf:    s.sf,
        }).eq('id', s.supabaseId)
      }
    }

    // ── PAINT MORE ────────────────────────────────────────────────────────────
    function startPaintEdit(forceCountTool = false) {
      if (!editTarget) return
      const {s} = editTarget
      closeEditModal(); editingSession = true; ensureLive()
      // Hide session first so count markers don't double during load
      s._hidden = true; invalidateSessions()
      liveHlCtx.clearRect(0, 0, liveHlCanvas.width, liveHlCanvas.height)
      livePenCtx.clearRect(0, 0, livePenCanvas.width, livePenCanvas.height)
      if (s.hlCanvas)  liveHlCtx.drawImage(s.hlCanvas, 0, 0)
      if (s.penCanvas) livePenCtx.drawImage(s.penCanvas, 0, 0)
      liveCountMarkers = s.countMarkers ? [...s.countMarkers] : []
      undoStack = [{
        hl:  liveHlCtx.getImageData(0, 0, liveHlCanvas.width, liveHlCanvas.height),
        pen: livePenCtx.getImageData(0, 0, livePenCanvas.width, livePenCanvas.height),
        cnt: [...liveCountMarkers],
      }]
      // Auto-select tool: count if forced, or if session only has count (no SF), else highlight
      if (forceCountTool || (s.sf === 0 && liveCountMarkers.length > 0)) {
        setTool('count')
      } else {
        setTool('highlight')
      }
      if (editBannerRef.current) editBannerRef.current.classList.add('show')
      if (editBannerTxtRef.current) editBannerTxtRef.current.textContent = 'Editing: ' + s.name + ' — paint to add more, then tap Update'
      if (!footerRef.current) return
      footerRef.current.innerHTML = `
        <button class="ct-fb" id="ct-undo-btn">Undo</button>
        <button class="ct-fb danger" id="ct-cancel-edit-btn">Cancel</button>
        <button class="ct-fb export" id="ct-commit-edit-btn">Update Session</button>
      `
      footerRef.current.querySelector('#ct-undo-btn').addEventListener('click', undoLast)
      footerRef.current.querySelector('#ct-cancel-edit-btn').addEventListener('click', cancelSessionEdit)
      footerRef.current.querySelector('#ct-commit-edit-btn').addEventListener('click', commitSessionEdit)
      redrawAll(); updateSF()
    }

    function startCountEdit() { startPaintEdit(true) }

    function cancelSessionEdit() {
      if (!editTarget) return
      editTarget.s._hidden = false; editingSession = false; editTarget = null
      ensureLive()
      liveHlCtx.clearRect(0, 0, liveHlCanvas.width, liveHlCanvas.height)
      livePenCtx.clearRect(0, 0, livePenCanvas.width, livePenCanvas.height)
      liveCountMarkers = []; undoStack = []; invalidateSessions()
      if (editBannerRef.current) editBannerRef.current.classList.remove('show')
      restoreFooter(); redrawAll(); updateSF(); renderSessions()
    }

    function commitSessionEdit() {
      if (!editTarget) return
      const {s} = editTarget
      const newHL  = document.createElement('canvas')
      newHL.width  = liveHlCanvas.width;  newHL.height = liveHlCanvas.height
      const newHLCtx = newHL.getContext('2d')
      if (newHLCtx && newHL.width > 0) newHLCtx.drawImage(liveHlCanvas, 0, 0)
      const newPen = document.createElement('canvas')
      newPen.width = livePenCanvas.width; newPen.height = livePenCanvas.height
      const newPenCtx = newPen.getContext('2d')
      if (newPenCtx && newPen.width > 0) newPenCtx.drawImage(livePenCanvas, 0, 0)
      s.hlCanvas = newHL; s.penCanvas = newPen
      s.countMarkers = [...liveCountMarkers]; s.count = liveCountMarkers.length
      s._hidden = false
      // Recalculate SF from updated highlight canvas
      const d = newHL.getContext('2d').getImageData(0, 0, newHL.width, newHL.height).data
      let px = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) px++
      s.sf = activePage?.ppf ? px / (activePage.ppf * activePage.ppf) : s.sf
      liveHlCtx.clearRect(0, 0, liveHlCanvas.width, liveHlCanvas.height)
      livePenCtx.clearRect(0, 0, livePenCanvas.width, livePenCanvas.height)
      liveCountMarkers = []; undoStack = []; editingSession = false; editTarget = null
      invalidateSessions(); if (editBannerRef.current) editBannerRef.current.classList.remove('show')
      restoreFooter(); redrawAll(); renderSessions(); updateSF()
      // Persist updated session to Supabase
      if (s.supabaseId) {
        supabase.from('sessions').upsert({
          id:             s.supabaseId,
          name:           s.name,
          color:          s.color,
          sf:             s.sf,
          highlight_data: newHL.toDataURL('image/png'),
          pen_data:       newPen ? newPen.toDataURL('image/png') : null,
          count_data:     s.countMarkers.length > 0 ? s.countMarkers : null,
          updated_at:     new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[Canvas] Failed to update session:', error)
          else { console.log('[Canvas] Session updated in Supabase'); showToast('Session updated!') }
        })
      }
    }

    function restoreFooter() {
      if (!footerRef.current) return
      footerRef.current.innerHTML = `
        <button class="ct-fb" id="ct-undo-btn">Undo</button>
        <button class="ct-fb" id="ct-clear-btn">Clear</button>
        <button class="ct-fb" id="ct-save-btn">+ Save</button>
        <button class="ct-fb export" id="ct-export-btn">Export</button>
      `
      footerRef.current.querySelector('#ct-undo-btn').addEventListener('click', undoLast)
      footerRef.current.querySelector('#ct-clear-btn').addEventListener('click', () => {
        liveHlCtx.clearRect(0, 0, liveHlCanvas.width, liveHlCanvas.height)
        livePenCtx.clearRect(0, 0, livePenCanvas.width, livePenCanvas.height)
        liveCountMarkers = []; undoStack = []
        redrawAll(); updateSF(); updateUnsaved(false)
        try { localStorage.removeItem(`draft_${pageId}`) } catch {}
      })
      footerRef.current.querySelector('#ct-save-btn').addEventListener('click', saveSession)
      footerRef.current.querySelector('#ct-export-btn').addEventListener('click', exportAll)
    }

    // ── TARGET & PROGRESS ─────────────────────────────────────────────────────
    function updateTarget() {
      todayTarget = parseFloat(targetInputRef.current?.value) || 0
      const rec = dayRecords.find(r => r.date === getCurrentDate())
      if (rec) rec.target = todayTarget
      updateProgressBar()
      // Debounce save to Supabase so rapid typing doesn't flood the DB
      clearTimeout(updateTarget._saveTimer)
      updateTarget._saveTimer = setTimeout(async () => {
        if (dbProjectId) {
          await supabase.from('projects').update({ daily_sf_target: todayTarget }).eq('id', dbProjectId)
        }
      }, 800)
    }
    function updateProgressBar() {
      const target = todayTarget
      const total  = cachedTodaySF  // all sessions + current unsaved work
      const pct = target > 0 ? Math.min((total / target) * 100, 100) : 0
      if (progressFillRef.current)  { progressFillRef.current.style.width = pct + '%'; progressFillRef.current.classList.toggle('over', total > target && target > 0) }
      if (totalSFsbRef.current)     totalSFsbRef.current.textContent     = Math.round(total).toLocaleString()
      if (targetDisplayRef.current) targetDisplayRef.current.textContent = Math.round(target).toLocaleString()
      if (targetInputRef.current)   targetInputRef.current.value         = target || ''
    }

    // ── HISTORY ───────────────────────────────────────────────────────────────
    function getCurrentDate() {
      const t = new Date()
      return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0')
    }
    function getDayColor(date) {
      const rec = dayRecords.find(r => r.date === date)
      if (rec) return rec.dayColor
      const col = DAY_COLORS[dayColorIdx % DAY_COLORS.length]; dayColorIdx++; return col
    }
    function getDayColorForDate(date) {
      const rec = dayRecords.find(r => r.date === date)
      return rec ? rec.dayColor : activeColor
    }
    function saveDayToHistory() {
      const date = getCurrentDate()
      const daySessions = []
      pages.forEach(pg => pg.sessions.forEach(s => daySessions.push({name:s.name,color:s.color,sf:s.sf,pageName:pg.name,time:s.time})))
      if (!daySessions.length) return
      let rec = dayRecords.find(r => r.date === date)
      if (rec) { rec.sessions = daySessions; rec.target = todayTarget }
      else { rec = {date,target:todayTarget,sessions:daySessions,dayColor:getDayColor(date)}; dayRecords.push(rec); dayRecords.sort((a,b)=>b.date.localeCompare(a.date)) }
    }
    function openHistory() {
      saveDayToHistory()
      const now = new Date(); calYear = now.getFullYear(); calMonth = now.getMonth(); calSelectedDate = null
      renderCalendar(); renderCalChart(); renderCalLegend()
      if (histModalRef.current) histModalRef.current.classList.add('open')
    }
    function closeHistory() { if (histModalRef.current) histModalRef.current.classList.remove('open') }
    function calPrevMonth() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear-- }; renderCalendar() }
    function calNextMonth() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++ }; renderCalendar() }

    function renderCalendar() {
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
      if (calMonthLblRef.current) calMonthLblRef.current.textContent = MONTHS[calMonth] + ' ' + calYear
      const grid = calGridRef.current; grid.innerHTML = ''
      const firstDay = new Date(calYear, calMonth, 1).getDay()
      const daysInMonth = new Date(calYear, calMonth+1, 0).getDate()
      const daysInPrev  = new Date(calYear, calMonth, 0).getDate()
      for (let i = firstDay-1; i >= 0; i--) grid.appendChild(makeCalCell(daysInPrev-i, calYear, calMonth-1, true))
      for (let d = 1; d <= daysInMonth; d++) grid.appendChild(makeCalCell(d, calYear, calMonth, false))
      const rem = (firstDay + daysInMonth) % 7 === 0 ? 0 : 7 - ((firstDay + daysInMonth) % 7)
      for (let d = 1; d <= rem; d++) grid.appendChild(makeCalCell(d, calYear, calMonth+1, true))
    }
    function makeCalCell(day, year, month, otherMonth) {
      const cell = document.createElement('div')
      cell.className = 'ct-cal-cell' + (otherMonth ? ' other-month' : '')
      const rm = ((month % 12) + 12) % 12
      const ry = year + Math.floor(month / 12)
      const ds = ry + '-' + String(rm+1).padStart(2,'0') + '-' + String(day).padStart(2,'0')
      const rec = dayRecords.find(r => r.date === ds)
      if (ds === getCurrentDate()) cell.classList.add('today')
      if (ds === calSelectedDate) cell.classList.add('selected')
      const numDiv = document.createElement('div'); numDiv.className = 'ct-cal-cell-num'; numDiv.textContent = day
      cell.appendChild(numDiv)
      if (rec?.sessions.length) {
        cell.classList.add('has-data')
        const dot = document.createElement('div'); dot.className = 'ct-cal-cell-dot'
        dot.style.background = rec.dayColor || '#7a7870'; cell.appendChild(dot)
      }
      cell.addEventListener('click', () => {
        if (otherMonth) { calYear = ry; calMonth = rm; renderCalendar(); return }
        calSelectedDate = ds; renderCalendar(); renderCalDayPanel(ds, rec)
      })
      return cell
    }
    function renderCalDayPanel(dateStr, rec) {
      const panel = calDayPanelRef.current; panel.innerHTML = ''
      const hdr = document.createElement('div'); hdr.className = 'ct-cal-day-date-hdr'
      hdr.textContent = formatDate(dateStr); panel.appendChild(hdr)
      const trow = document.createElement('div'); trow.className = 'ct-cal-target-row'
      const tlbl = document.createElement('span'); tlbl.className = 'ct-cal-target-lbl'; tlbl.textContent = 'SF Target:'
      const tinp = document.createElement('input'); tinp.className = 'ct-cal-target-inp'; tinp.type = 'number'
      tinp.value = rec?.target || ''; tinp.placeholder = 'Set goal'
      tinp.addEventListener('change', () => {
        const val = parseFloat(tinp.value) || 0
        if (rec) rec.target = val
        else { const nr = {date:dateStr,target:val,sessions:[],dayColor:getDayColor(dateStr)}; dayRecords.push(nr); dayRecords.sort((a,b)=>b.date.localeCompare(a.date)) }
        if (dateStr === getCurrentDate()) { todayTarget = val; updateProgressBar() }
        renderCalChart(); renderCalLegend()
      })
      const tunit = document.createElement('span'); tunit.className = 'ct-cal-target-lbl'; tunit.textContent = 'SF'
      trow.append(tlbl, tinp, tunit); panel.appendChild(trow)
      if (!rec?.sessions.length) {
        const em = document.createElement('div'); em.className = 'ct-cal-day-empty'; em.textContent = 'No sessions recorded this day.'
        panel.appendChild(em); return
      }
      const totalSF = rec.sessions.reduce((a,s)=>a+s.sf,0)
      if (rec.target > 0) {
        const pct = Math.min((totalSF/rec.target)*100,100)
        const pbg = document.createElement('div'); pbg.className = 'ct-cal-day-progress'
        pbg.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:10px;color:#7a7870"><span>Progress</span><span style="color:#f0ede6;font-weight:700">${Math.round(totalSF).toLocaleString()} / ${Math.round(rec.target).toLocaleString()} SF</span></div><div class="ct-progress-bar-bg"><div class="ct-progress-bar-fill${totalSF>=rec.target?' over':''}" style="width:${pct}%"></div></div>`
        panel.appendChild(pbg)
      }
      const byPage = {}
      rec.sessions.forEach(s => { if (!byPage[s.pageName]) byPage[s.pageName]=[]; byPage[s.pageName].push(s) })
      Object.entries(byPage).forEach(([pname, sessions]) => {
        const lbl = document.createElement('div')
        lbl.style.cssText='font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a7870;margin:8px 0 4px'
        lbl.textContent = pname; panel.appendChild(lbl)
        sessions.forEach(s => {
          const d = document.createElement('div'); d.className = 'ct-cal-sess-item'
          d.innerHTML = `<div class="ct-cal-sess-dot" style="background:${s.color}"></div><div><div class="ct-cal-sess-name">${s.name}</div><div class="ct-cal-sess-meta">${s.time}</div></div><div class="ct-cal-sess-sf">${Math.round(s.sf).toLocaleString()} SF</div>`
          panel.appendChild(d)
        })
      })
      const tot = document.createElement('div')
      tot.style.cssText='margin-top:10px;padding-top:8px;border-top:1px solid #2e2e2b;display:flex;justify-content:space-between;'
      tot.innerHTML = `<span style="font-size:10px;color:#7a7870;font-weight:700;text-transform:uppercase;letter-spacing:1px">Total</span><span style="font-size:16px;font-weight:800;color:#4ade80">${Math.round(totalSF).toLocaleString()} SF</span>`
      panel.appendChild(tot)
    }
    function renderCalChart() {
      const wrapEl = calBarsRef.current; wrapEl.innerHTML = ''
      const days = dayRecords.slice(0,30).reverse()
      if (!days.length) { wrapEl.innerHTML = '<div style="font-size:11px;color:#7a7870">No history yet</div>'; return }
      const maxSF = Math.max(...days.map(h=>h.sessions.reduce((a,s)=>a+s.sf,0)),1)
      days.forEach(h => {
        const sf = h.sessions.reduce((a,s)=>a+s.sf,0)
        const bw = document.createElement('div'); bw.className = 'ct-cal-bar-wrap'
        const bar = document.createElement('div'); bar.className = 'ct-cal-bar'
        bar.style.cssText = `height:${Math.max((sf/maxSF)*92,2)}%;background:${h.dayColor||'#60a5fa'};`
        bar.title = formatDate(h.date)+': '+Math.round(sf).toLocaleString()+' SF'
        bar.addEventListener('click', ()=>{ calSelectedDate=h.date; renderCalendar(); renderCalDayPanel(h.date,h) })
        const lbl = document.createElement('div'); lbl.className = 'ct-cal-bar-lbl'; lbl.textContent = h.date.slice(5)
        bw.append(bar,lbl); wrapEl.appendChild(bw)
      })
    }
    function renderCalLegend() {
      const el = calLegendRef.current; el.innerHTML = ''
      if (!dayRecords.length) { el.innerHTML = '<div style="font-size:12px;color:#7a7870">No days recorded yet</div>'; return }
      dayRecords.forEach(h => {
        const sf  = h.sessions.reduce((a,s)=>a+s.sf,0)
        const pct = h.target>0 ? Math.round((sf/h.target)*100) : null
        const d   = document.createElement('div'); d.className = 'ct-cal-legend-item'
        d.innerHTML = `<div class="ct-cal-legend-swatch" style="background:${h.dayColor||'#7a7870'}"></div><div class="ct-cal-legend-date">${formatDate(h.date)}</div><div class="ct-cal-legend-sf" style="color:${h.dayColor||'#4ade80'}">${Math.round(sf).toLocaleString()} SF</div>${pct!==null?`<div class="ct-cal-legend-pct" style="background:${pct>=100?'rgba(74,222,128,0.15)':'rgba(250,204,21,0.15)'};color:${pct>=100?'#4ade80':'#facc15'}">${pct}%</div>`:''}`
        d.addEventListener('click', ()=>{ calSelectedDate=h.date; renderCalendar(); renderCalDayPanel(h.date,h) })
        el.appendChild(d)
      })
    }
    function formatDate(ds) {
      return new Date(ds+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
    }

    // ── RESIZE ────────────────────────────────────────────────────────────────
    function onResize() {
      if (!activePage) return
      cW = wrap.clientWidth; cH = wrap.clientHeight
      for (const c of [planEl, hlEl, penEl, countEl, drawEl]) {
        c.width = Math.round(cW*DPR); c.height = Math.round(cH*DPR)
        c.style.width = cW+'px'; c.style.height = cH+'px'
      }
      applyDPRTransform(); redrawAll()
    }

    // ── SUPABASE: LOAD SESSIONS ───────────────────────────────────────────────
    async function loadCanvasFromDataUrl(dataUrl) {
      if (!dataUrl) return null
      try {
        const img = new Image()
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl })
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
        const cCtx = c.getContext('2d')
        if (cCtx && c.width > 0) cCtx.drawImage(img, 0, 0)
        return c
      } catch (e) {
        console.warn('[Canvas] Failed to load canvas from data URL', e)
        return null
      }
    }

    async function loadCanvasFromUrl(url) {
      if (!url) return null
      try {
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve; img.onerror = reject
          img.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now()
        })
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
        const cCtx = c.getContext('2d')
        if (cCtx && c.width > 0) cCtx.drawImage(img, 0, 0)
        return c
      } catch { return null }
    }

    async function loadSessionsFromSupabase() {
      console.log('[Canvas] Loading all sessions for page', pageId)
      // Clear existing sessions to avoid duplicates if this is called more than once
      if (activePage) activePage.sessions = []
      // Load all sessions (not just today) for persistent markup
      const { data: dbSessions, error } = await supabase
        .from('sessions')
        .select('*, profiles(full_name, avatar_color)')
        .eq('page_id', pageId)
        .order('created_at', {ascending: true})

      console.log('[Canvas] Supabase returned', dbSessions?.length, 'sessions, error:', error)
      if (error) { console.error('[Canvas] Error loading sessions:', error); return }
      if (!dbSessions?.length) { console.log('[Canvas] No sessions found'); return }

      console.log('[Canvas] Loading', dbSessions.length, 'sessions')
      for (const dbSess of dbSessions) {
        if (deletedSessionIds.has(dbSess.id)) continue
        let hlCanvas = null, penCanvas = null

        if (dbSess.highlight_data) {
          hlCanvas = await loadCanvasFromDataUrl(dbSess.highlight_data)
        }
        if (dbSess.pen_data) {
          penCanvas = await loadCanvasFromDataUrl(dbSess.pen_data)
        }

        console.log('[Canvas] Loaded session', dbSess.id, 'hlCanvas:', hlCanvas?.width, 'x', hlCanvas?.height)
        if (!hlCanvas || hlCanvas.width === 0) {
          console.warn('[Canvas] Skipping session with invalid hlCanvas:', dbSess.id)
          continue
        }

        const img = activePage.image
        if (hlCanvas.width !== img.width || hlCanvas.height !== img.height) {
          const tmp = document.createElement('canvas')
          tmp.width = img.width; tmp.height = img.height
          const tmpCtx = tmp.getContext('2d')
          if (tmpCtx && tmp.width > 0) tmpCtx.drawImage(hlCanvas, 0, 0, img.width, img.height)
          hlCanvas = tmp
        }
        if (penCanvas && (penCanvas.width !== img.width || penCanvas.height !== img.height)) {
          const tmp = document.createElement('canvas')
          tmp.width = img.width; tmp.height = img.height
          const tmpCtx = tmp.getContext('2d')
          if (tmpCtx && tmp.width > 0) tmpCtx.drawImage(penCanvas, 0, 0, img.width, img.height)
          penCanvas = tmp
        }
        if (!penCanvas) {
          penCanvas = document.createElement('canvas')
          penCanvas.width = img.width; penCanvas.height = img.height
        }

        let countMarkers = []
        try {
          const raw = dbSess.count_data
          if (raw) countMarkers = typeof raw === 'string' ? JSON.parse(raw) : raw
        } catch {}

        const date = dbSess.work_date || getCurrentDate()
        if (!dayRecords.find(r => r.date === date)) {
          dayRecords.push({date, target: todayTarget, sessions: [], dayColor: getDayColor(date)})
          dayRecords.sort((a, b) => b.date.localeCompare(a.date))
        }

        activePage.sessions.push({
          id:           sessionCounter++,
          name:         dbSess.name || 'Session',
          color:        dbSess.color || '#facc15',
          userName:     dbSess.profiles?.full_name || 'User',
          userColor:    dbSess.profiles?.avatar_color || dbSess.color || '#facc15',
          sf:           parseFloat(dbSess.sf) || 0,
          count:        countMarkers.length || 0,
          hlCanvas, penCanvas, countMarkers,
          pageId:       activePage.id,
          pageName:     activePage.name,
          date,
          time:         dbSess.created_at ? new Date(dbSess.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '',
          supabaseId:   dbSess.id,
        })
      }

      console.log('[Canvas] Sessions loaded:', activePage.sessions.length)
      invalidateSessions()
      redrawAll(); renderSessions(); updateSF(); updateProgressBar(); saveDayToHistory()
    }

    // ── REALTIME SUBSCRIPTION ─────────────────────────────────────────────────
    function startRealtime() {
      // Remove any existing channel before creating a new one to prevent
      // "cannot add postgres_changes callbacks after subscribe()" errors on re-render
      if (realtimeSub) {
        supabase.removeChannel(realtimeSub)
        realtimeSub = null
      }
      realtimeSub = supabase
        .channel(`canvas_sessions_${pageId}_${Date.now()}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'sessions',
          filter: `page_id=eq.${pageId}`,
        }, async payload => {
          const row = payload.new
          if (row.user_id === user.id) return  // skip our own saves
          if (deletedSessionIds.has(row.id)) return  // skip re-insertion of deleted sessions
          console.log('[Canvas] Realtime: new session from another user')
          const data = row.strokes
          if (!data) return
          let hlCanvas = null, penCanvas = null
          if (data.type === 'canvas_v3') {
            ;[hlCanvas, penCanvas] = await Promise.all([
              loadCanvasFromDataUrl(data.highlight_data),
              loadCanvasFromDataUrl(data.pen_data),
            ])
          } else if (data.type === 'canvas_v2') {
            ;[hlCanvas, penCanvas] = await Promise.all([
              loadCanvasFromUrl(data.hlUrl),
              loadCanvasFromUrl(data.penUrl),
            ])
          }
          if (!hlCanvas || !activePage) return
          const img = activePage.image
          if (hlCanvas.width !== img.width || hlCanvas.height !== img.height) {
            const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height
            const tmpCtx = tmp.getContext('2d')
            if (tmpCtx && tmp.width > 0) tmpCtx.drawImage(hlCanvas, 0, 0, img.width, img.height)
            hlCanvas = tmp
          }
          if (!penCanvas) { penCanvas = document.createElement('canvas'); penCanvas.width = img.width; penCanvas.height = img.height }
          const date = row.date || getCurrentDate()
          activePage.sessions.push({
            id: sessionCounter++,
            name: data.name || 'Team member', color: data.color || '#4ade80',
            userColor: data.userColor || '#4ade80', userName: data.userName || 'Team member',
            sf: row.sf_calculated || 0, hlCanvas, penCanvas, countMarkers: [],
            pageId: activePage.id, pageName: activePage.name, time: data.time || '', date,
            supabaseId: row.id,
          })
          invalidateSessions(); redrawAll(); renderSessions(); updateSF()
          showToast('New session from a team member')
        })
        .subscribe()
    }

    // ── INIT ──────────────────────────────────────────────────────────────────
    async function init() {
      const uz = uploadZoneRef.current
      function uzShow(icon, title, sub) {
        uz.innerHTML = `<div class="ct-upload-box"><div class="ct-upload-icon">${icon}</div><div class="ct-upload-title">${title}</div><div class="ct-upload-sub">${sub}</div></div>`
        uz.classList.remove('hidden')
      }

      uzShow('', 'Loading…', 'Fetching page data…')

      // Fetch user profile for session default name
      const { data: prof } = await supabase.from('profiles').select('full_name, avatar_color').eq('id', user.id).single()
      userProfile = prof

      const { data: pg, error: pgErr } = await supabase.from('pages').select('*').eq('id', pageId).single()
      if (pgErr || !pg) { uzShow('', 'Page not found', 'Please go back and try again'); return }

      dbProjectId = pg.project_id
      if (pageTitleRef.current) pageTitleRef.current.textContent = pg.name

      // Load project target and apply it before the progress bar renders
      const { data: project } = await supabase
        .from('projects')
        .select('daily_sf_target, total_sf_target')
        .eq('id', pg.project_id)
        .single()
      if (project?.daily_sf_target) {
        todayTarget = project.daily_sf_target
        if (targetInputRef.current) targetInputRef.current.value = project.daily_sf_target
      }
      if (project?.total_sf_target) {
        totalBuildingSF = project.total_sf_target
      }

      const savedPPF = pg.pixels_per_foot || null
      const savedCalibrated = pg.calibrated || false

      let url = pg.floor_plan_url
      if (url && !url.startsWith('http')) {
        const { data: urlData } = supabase.storage.from('floor-plans').getPublicUrl(url)
        url = urlData?.publicUrl || null
      }

      if (!url) { uzShow('', 'No floor plan loaded', 'Upload a floor plan from the project page'); return }

      uzShow('', 'Loading floor plan…', 'Rendering image…')

      try {
        const isPdf = /\.pdf($|\?)/i.test(url) || url.toLowerCase().includes('.pdf')
        console.log('[Canvas] floor plan load path:', pg.cached_image_url ? 'CACHED PNG' : isPdf ? 'PDF RENDER' : 'IMAGE')
        let img, ppi = null

        if (pg.cached_image_url) {
          // Use cached PNG render — skips PDF.js entirely
          uzShow('', 'Loading floor plan…', 'Loading cached image…')
          img = new Image()
          await new Promise((resolve, reject) => {
            img.onload = resolve; img.onerror = reject
            img.crossOrigin = 'anonymous'; img.src = pg.cached_image_url
          })
          ppi = pg.ppi || 72 * Math.max(3.0, DPR * 1.5)
        } else if (isPdf) {
          uzShow('', 'Loading floor plan…', 'Rendering PDF…')
          const RENDER_SCALE = Math.max(3.0, DPR * 1.5)
          const pdfjsLib = await import('pdfjs-dist')
          const { default: pdfWorkerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
          const pdfDoc = await pdfjsLib.getDocument({ url, withCredentials: false }).promise
          const page = await pdfDoc.getPage(1)
          const viewport = page.getViewport({ scale: RENDER_SCALE })
          ppi = 72 * RENDER_SCALE
          const offscreen = document.createElement('canvas')
          offscreen.width = viewport.width; offscreen.height = viewport.height
          await page.render({ canvasContext: offscreen.getContext('2d'), viewport }).promise
          img = offscreen
        } else {
          img = new Image()
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url })
        }

        addPage(img, pg.name, ppi)

        // Cache PDF render as PNG for faster future loads
        if (isPdf && !pg.cached_image_url) {
          try {
            const blob = await new Promise(resolve => img.toBlob(resolve, 'image/png'))
            const cachePath = `${dbProjectId}/cache_${pageId}.png`
            const { error: upErr } = await supabase.storage
              .from('floor-plans')
              .upload(cachePath, blob, { upsert: true, contentType: 'image/png' })
            if (!upErr) {
              const { data: urlData } = supabase.storage.from('floor-plans').getPublicUrl(cachePath)
              await supabase.from('pages').update({ cached_image_url: urlData.publicUrl }).eq('id', pageId)
              console.log('[Canvas] PDF cached as PNG:', urlData.publicUrl)
            }
          } catch (e) {
            console.warn('[Canvas] Cache save failed:', e)
          }
        }

        if (savedPPF && savedCalibrated) {
          activePage.ppf = savedPPF; activePage.calibrated = true
          if (calibInfoRef.current) { calibInfoRef.current.style.display = 'inline'; calibInfoRef.current.textContent = 'Calibrated: ' + savedPPF.toFixed(1) + ' px/ft' }
        }

      } catch (err) {
        console.error('[Canvas] Init error:', err, err?.stack)
        uzShow('', 'Failed to load floor plan', err.message || 'Check console for details')
        return
      }

      // Sessions, draft, and realtime run outside the floor plan try/catch
      // so errors here never trigger the "Failed to load floor plan" overlay
      try {
        console.log('[Canvas] About to load sessions, activePage:', activePage?.id, 'image size:', activePage?.image?.width, 'x', activePage?.image?.height)
        await loadSessionsFromSupabase()
      } catch (err) {
        console.error('[Canvas] Session load error:', err, err?.stack)
      }

      try {
        loadDraft()
      } catch (err) {
        console.error('[Canvas] Draft load error:', err, err?.stack)
      }

      try {
        draftInterval = setInterval(saveDraft, 30000)
        startRealtime()
      } catch (err) {
        console.error('[Canvas] Realtime start error:', err, err?.stack)
      }
    }

    // ── INIT COLOR GRIDS ──────────────────────────────────────────────────────
    const cgEl = colorGridRef.current; cgEl.innerHTML = ''
    COLORS.forEach(col => {
      const d = document.createElement('div')
      d.className = 'ct-cc' + (col === activeColor ? ' sel' : '')
      d.style.background = col; d.dataset.c = col
      if (col === '#ffffff') d.style.borderColor = '#555'
      d.addEventListener('click', () => pickColor(col))
      cgEl.appendChild(d)
    })
    const ccEl = ctxColorsRef.current; ccEl.innerHTML = ''
    COLORS.forEach((col, i) => {
      const d = document.createElement('div')
      d.className = 'ct-ctx-cc' + (col === activeColor ? ' sel' : '')
      d.style.background = col
      if (col === '#ffffff') d.style.borderColor = '#555'
      d.addEventListener('click', () => {
        activeColor = col; pickColor(col)
        ccEl.querySelectorAll('.ct-ctx-cc').forEach(c => c.classList.remove('sel'))
        d.classList.add('sel')
        if (tool === 'erase') setTool(prevTool)
        closeCtxMenu()
      })
      ccEl.appendChild(d)
    })
    const ecEl = editColorsRef.current; ecEl.innerHTML = ''
    COLORS.forEach(col => {
      const d = document.createElement('div')
      d.className = 'ct-modal-cc'; d.style.background = col; d.dataset.c = col
      if (col === '#ffffff') d.style.borderColor = '#555'
      d.addEventListener('click', () => { ecEl.querySelectorAll('.ct-modal-cc').forEach(x => x.classList.remove('sel')); d.classList.add('sel') })
      ecEl.appendChild(d)
    })

    restoreFooter()

    scaleSelectRef.current.addEventListener('change', onScaleChange)
    cNumerRef.current.addEventListener('input', applyCustomScale)
    cDenomRef.current.addEventListener('input', applyCustomScale)
    brushRangeRef.current.addEventListener('input', updateBrush)
    targetInputRef.current.addEventListener('input', updateTarget)
    ctxBrushRef.current.addEventListener('input', e => ctxBrushChange(e.target.value))

    drawEl.addEventListener('mousedown', onDown)
    drawEl.addEventListener('mousemove', onMove)
    drawEl.addEventListener('mouseleave', onLeave)
    drawEl.addEventListener('wheel', onWheel, {passive: false})
    drawEl.addEventListener('contextmenu', e => { e.preventDefault(); if (!activePage) return; openCtxMenu(e.clientX, e.clientY) })
    drawEl.addEventListener('touchstart', onTouchStart, {passive: false})
    drawEl.addEventListener('touchmove', onTouchMove, {passive: false})
    drawEl.addEventListener('touchend', onTouchEnd, {passive: false})
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && calibrating) cancelCalib() })
    window.addEventListener('resize', onResize)
    document.addEventListener('click', e => {
      if (ctxMenuRef.current?.style.display === 'block' && !ctxMenuRef.current.contains(e.target)) closeCtxMenu()
    })
    if (editModalRef.current) editModalRef.current.addEventListener('click', e => { if (e.target === editModalRef.current) closeEditModal() })
    if (histModalRef.current) histModalRef.current.addEventListener('click', e => { if (e.target === histModalRef.current) closeHistory() })

    api.current = {
      setTool, startCalib, cancelCalib,
      doZoom, resetView,
      openHistory, closeHistory, calPrevMonth, calNextMonth,
      closeEditModal, saveEdit, startPaintEdit, startCountEdit,
      cancelSessionEdit, commitSessionEdit,
      ctxSetTool,
    }

    init()

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(draftInterval)
      if (realtimeSub) supabase.removeChannel(realtimeSub)
      drawEl.removeEventListener('mousedown', onDown)
      drawEl.removeEventListener('mousemove', onMove)
      drawEl.removeEventListener('mouseleave', onLeave)
      drawEl.removeEventListener('wheel', onWheel)
      drawEl.removeEventListener('touchstart', onTouchStart)
      drawEl.removeEventListener('touchmove', onTouchMove)
      drawEl.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('resize', onResize)
      const toast = document.getElementById('ct-toast')
      if (toast) toast.remove()
    }
  }, [pageId, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden',fontFamily:'system-ui,sans-serif',background:'#111210',color:'#f0ede6'}}>

      <div className="ct-header">
        <button className="ct-hbtn" onClick={() => navigate(-1)} style={{flexShrink:0}}>← Back</button>
        <div className="ct-hdiv" />
        <span ref={pageTitleRef} style={{fontSize:13,fontWeight:700,color:'#f0ede6',whiteSpace:'nowrap',flexShrink:0}}>Loading…</span>
        <div className="ct-hdiv" />
        <div className="ct-hgroup">
          <span className="ct-hlbl">Scale</span>
          <select ref={scaleSelectRef} className="ct-select" defaultValue="1:8">
            <option value="1:1">1" = 1"</option>
            <option value="1:32">1/32" = 1'</option>
            <option value="3:64">3/64" = 1'</option>
            <option value="1:16">1/16" = 1'</option>
            <option value="3:32">3/32" = 1'</option>
            <option value="1:8">1/8" = 1'</option>
            <option value="3:16">3/16" = 1'</option>
            <option value="1:4">1/4" = 1'</option>
            <option value="3:8">3/8" = 1'</option>
            <option value="1:2">1/2" = 1'</option>
            <option value="3:4">3/4" = 1'</option>
            <option value="1:0">1" = 1'</option>
            <option value="1.5:0">1-1/2" = 1'</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div ref={customWrapRef} style={{display:'none',alignItems:'center',gap:4}}>
          <input ref={cNumerRef} type="number" className="ct-num-input" defaultValue="1" min="0.001" step="0.125" style={{width:44}} />
          <span style={{color:'#7a7870',fontSize:12}}>" =</span>
          <input ref={cDenomRef} type="number" className="ct-num-input" defaultValue="1" min="0.001" step="1" style={{width:44}} />
          <span style={{color:'#7a7870',fontSize:12}}>'</span>
        </div>
        <div className="ct-hdiv" />
        <button ref={calibBtnRef} className="ct-hbtn" onClick={() => api.current.startCalib?.()}>Calibrate</button>
        <span ref={calibInfoRef} className="ct-calib-info" style={{display:'none'}} />
        <div className="ct-hdiv" />
        <div className="ct-stat-box">
          <div ref={hdrSessionRef} className="ct-stat-val" style={{color:'#4ade80'}}>0</div>
          <div className="ct-stat-lbl">Session SF</div>
        </div>
        <div className="ct-hdiv" />
        <div className="ct-stat-box">
          <div ref={hdrTotalRef} className="ct-stat-val">0</div>
          <div className="ct-stat-lbl">Total SF</div>
        </div>
        <div className="ct-hdiv" />
        <div className="ct-stat-box" style={{minWidth:55}}>
          <div ref={hdrPctRef} className="ct-stat-val" style={{color:'#facc15'}}>–</div>
          <div className="ct-stat-lbl">of target</div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
          <button className="ct-hbtn" onClick={() => api.current.openHistory?.()}>History</button>
        </div>
      </div>
      {/* Total building progress bar — thin blue strip below the header */}
      <div style={{height:5,background:'#1a1a18',flexShrink:0}}>
        <div ref={hdrProgressFillRef} style={{height:'100%',background:'#3b82f6',width:'0%',transition:'width 0.4s ease'}} />
      </div>

      <div style={{display:'flex',flex:1,overflow:'hidden',minHeight:0}}>

        <div ref={wrapRef} className="ct-canvas-wrap">

          <div ref={uploadZoneRef} className="ct-upload-zone hidden">
            <div className="ct-upload-box">
              <div className="ct-upload-icon"></div>
              <div className="ct-upload-title">Loading floor plan…</div>
              <div className="ct-upload-sub">Please wait…</div>
            </div>
          </div>

          {/* Unsaved changes badge */}
          <div ref={unsavedBadgeRef} style={{display:'none',position:'absolute',top:10,right:10,zIndex:20,alignItems:'center',gap:5,background:'rgba(250,204,21,0.15)',border:'1px solid rgba(250,204,21,0.4)',borderRadius:20,padding:'3px 10px',fontSize:11,fontWeight:600,color:'#facc15',pointerEvents:'none'}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'#facc15',display:'inline-block'}} />
            Unsaved
          </div>

          <canvas ref={planRef}  className="ct-canvas" />
          <canvas ref={hlRef}    className="ct-canvas" />
          <canvas ref={penRef}   className="ct-canvas" />
          <canvas ref={countRef} className="ct-canvas" />
          <canvas ref={drawRef}  className="ct-canvas ct-draw-canvas" />

          <div ref={cursorRingRef} className="ct-cursor-ring" />

          <div ref={zoomBarRef} className="ct-zoom-bar">
            <button className="ct-z-btn" onClick={() => api.current.doZoom?.(1.18)}>+</button>
            <button className="ct-z-btn" onClick={() => api.current.doZoom?.(0.847)} style={{fontSize:18,lineHeight:1}}>−</button>
            <button className="ct-z-btn" onClick={() => api.current.resetView?.()} style={{fontSize:10,fontWeight:700}}>FIT</button>
          </div>

          <div ref={calibStatusRef} className="ct-calib-status" />

          <div ref={editBannerRef} className="ct-editing-banner">
            <span ref={editBannerTxtRef}>Editing session</span>
            <button className="ct-cancel-edit-btn" onClick={() => api.current.cancelSessionEdit?.()}>Cancel</button>
          </div>
        </div>

        <div className="ct-sidebar">
          <div className="ct-sb-sec">
            <div className="ct-sb-ttl">Tool</div>
            <div className="ct-tool-row">
              <div ref={btnHlRef}    className="ct-tbtn t-hl" onClick={() => api.current.setTool?.('highlight')}>Highlight</div>
              <div ref={btnPenRef}   className="ct-tbtn"      onClick={() => api.current.setTool?.('pen')}>Pen</div>
              <div ref={btnErRef}    className="ct-tbtn"      onClick={() => api.current.setTool?.('erase')}>Erase</div>
              <div ref={btnCountRef} className="ct-tbtn"      onClick={() => api.current.setTool?.('count')}>Count</div>
            </div>
            <div className="ct-sb-ttl">Brush Size</div>
            <div className="ct-brush-row">
              <span className="ct-blbl">Size</span>
              <input ref={brushRangeRef} type="range" className="ct-brush-range" min="3" max="80" defaultValue="20" />
              <span ref={brushValRef} className="ct-bval">20</span>
            </div>
            <div className="ct-sb-ttl" style={{marginTop:10}}>Color</div>
            <div ref={colorGridRef} className="ct-color-grid" />
          </div>

          <div className="ct-progress-wrap">
            <div className="ct-progress-header">
              <span className="ct-progress-lbl">Progress</span>
              <span className="ct-progress-nums"><span ref={totalSFsbRef}>0</span> / <span ref={targetDisplayRef}>0</span> SF</span>
            </div>
            <div className="ct-progress-bar-bg">
              <div ref={progressFillRef} className="ct-progress-bar-fill" style={{width:'0%'}} />
            </div>
            <div className="ct-target-row">
              <span className="ct-target-lbl">Goal:</span>
              <input ref={targetInputRef} type="number" className="ct-target-input" defaultValue="0" min="0" step="100" placeholder="SF goal" />
              <span className="ct-target-unit">SF / day</span>
            </div>
          </div>

          <div className="ct-sessions-hdr">Sessions <span>(tap to isolate)</span></div>
          <div ref={sessionListRef} className="ct-sessions-wrap">
            <div ref={emptyMsgRef} className="ct-empty-msg">
              No sessions yet.<br />Highlight the plan,<br />then tap + Save.
            </div>
          </div>

          <div ref={footerRef} className="ct-sb-footer" />
        </div>
      </div>

      <div ref={ctxMenuRef} className="ct-ctx-menu">
        <div className="ct-ctx-title">Quick Pick</div>
        <div ref={ctxColorsRef} className="ct-ctx-colors" />
        <div className="ct-ctx-divider" />
        <div className="ct-ctx-title">Brush Size</div>
        <div className="ct-ctx-brush-row">
          <span className="ct-ctx-lbl">Size</span>
          <input ref={ctxBrushRef} type="range" min="3" max="80" defaultValue="20" style={{flex:1,accentColor:'#4ade80',cursor:'pointer'}} />
          <span ref={ctxBrushValRef} className="ct-ctx-val">20</span>
        </div>
        <div className="ct-ctx-divider" />
        <div className="ct-ctx-title">Tool</div>
        <div className="ct-ctx-tools">
          <div ref={ctxBtnHlRef}  className="ct-ctx-tbtn t-hl" onClick={() => api.current.ctxSetTool?.('highlight')}>Highlight</div>
          <div ref={ctxBtnPenRef} className="ct-ctx-tbtn"      onClick={() => api.current.ctxSetTool?.('pen')}>Pen</div>
          <div ref={ctxBtnErRef}  className="ct-ctx-tbtn"      onClick={() => api.current.ctxSetTool?.('erase')}>Erase</div>
        </div>
      </div>

      <div ref={editModalRef} className="ct-modal-overlay">
        <div className="ct-modal-box">
          <div className="ct-modal-title">Edit Session</div>
          <div className="ct-modal-field">
            <label className="ct-modal-lbl">Session Name</label>
            <input ref={editNameRef} className="ct-modal-input" type="text" placeholder="e.g. Zone A – Morning" />
          </div>
          <div className="ct-modal-field">
            <label className="ct-modal-lbl">Square Footage</label>
            <input ref={editSFRef} className="ct-modal-input" type="number" min="0" step="1" placeholder="SF" />
          </div>
          <div className="ct-modal-field">
            <label className="ct-modal-lbl">Count Items</label>
            <span ref={editCountRef} className="ct-modal-input" style={{ display: 'block', cursor: 'default', marginBottom: 6 }}>0 items</span>
            <div className="ct-modal-btn paint" style={{ width: '100%', boxSizing: 'border-box' }} onClick={() => api.current.startCountEdit?.()}>+ Edit Count on Canvas</div>
          </div>
          <div className="ct-modal-field">
            <label className="ct-modal-lbl">Color</label>
            <div ref={editColorsRef} className="ct-modal-colors" />
          </div>
          <div className="ct-modal-row">
            <div className="ct-modal-btn" onClick={() => api.current.closeEditModal?.()}>Cancel</div>
            <div className="ct-modal-btn paint" onClick={() => api.current.startPaintEdit?.()}>+ Paint More</div>
            <div className="ct-modal-btn save" onClick={() => api.current.saveEdit?.()}>Save Changes</div>
          </div>
        </div>
      </div>

      <div ref={histModalRef} className="ct-cal-overlay">
        <div className="ct-cal-box">
          <div className="ct-cal-header">
            <div className="ct-cal-title">Daily History</div>
            <div className="ct-cal-nav">
              <button className="ct-cal-nav-btn" onClick={() => api.current.calPrevMonth?.()}>‹</button>
              <div ref={calMonthLblRef} className="ct-cal-month-lbl" />
              <button className="ct-cal-nav-btn" onClick={() => api.current.calNextMonth?.()}>›</button>
            </div>
            <button className="ct-cal-close" onClick={() => api.current.closeHistory?.()}>Close</button>
          </div>
          <div className="ct-cal-body">
            <div className="ct-cal-left">
              <div className="ct-cal-grid-wrap">
                <div className="ct-cal-dow">
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <div key={d} className="ct-cal-dow-lbl">{d}</div>)}
                </div>
                <div ref={calGridRef} className="ct-cal-grid" />
              </div>
              <div ref={calDayPanelRef} className="ct-cal-day-panel">
                <div className="ct-cal-day-empty">Click a day to view details</div>
              </div>
            </div>
            <div className="ct-cal-right">
              <div className="ct-cal-chart-wrap">
                <div className="ct-cal-chart-title">SF per Day — last 30 days</div>
                <div ref={calBarsRef} className="ct-cal-bars" />
              </div>
              <div className="ct-cal-legend">
                <div className="ct-cal-legend-title">All Days Summary</div>
                <div ref={calLegendRef} />
              </div>
            </div>
          </div>
          <div className="ct-cal-footer">
            <button className="ct-cal-btn" onClick={() => api.current.closeHistory?.()}>Done</button>
          </div>
        </div>
      </div>

    </div>
  )
}
