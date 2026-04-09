import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const UPLOAD_TIMEOUT_MS = 30_000

const STATUS_OPTIONS = ['active', 'completed', 'on hold']

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

function StatusBadge({ status, onSave }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function select(s) {
    setOpen(false)
    if (s !== status) await onSave(s)
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen(o => !o)}
        className={`${badgeClass(status)} cursor-pointer hover:opacity-80 transition-opacity capitalize`}
      >
        {status}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 min-w-[110px] py-1 overflow-hidden">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => select(s)}
              className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-surface-2 transition-colors flex items-center gap-2 ${s === status ? 'text-white font-medium' : 'text-gray-400'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s === 'active' ? 'bg-accent' : s === 'completed' ? 'bg-blue-400' : 'bg-yellow-400'}`} />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddPageModal({ projectId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploadStep, setUploadStep] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    setLoading(true)
    setUploadStep('')

    try {
      let floor_plan_url = null

      if (file) {
        const ext = file.name.split('.').pop().toLowerCase()
        const path = `${projectId}/${Date.now()}.${ext}`
        console.log('[AddPage] Starting upload to bucket "floor-plans", path:', path, 'size:', file.size)
        setUploadStep('Uploading file…')

        // Upload raw file bytes only — NO PDF rendering happens here.
        // PDF.js rendering runs lazily in Canvas.jsx when the user opens the canvas,
        // keeping the upload lightweight and off the main thread.
        const uploadPromise = supabase.storage
          .from('floor-plans')
          .upload(path, file, { upsert: true, contentType: file.type })

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Upload timed out after 30 seconds — check your connection and try again')), UPLOAD_TIMEOUT_MS)
        )

        const { data: uploadData, error: upErr } = await Promise.race([uploadPromise, timeoutPromise])

        if (upErr) {
          console.error('[AddPage] Storage upload error:', upErr)
          throw upErr
        }
        console.log('[AddPage] Upload succeeded:', uploadData)

        setUploadStep('Getting public URL…')
        const { data: urlData } = supabase.storage.from('floor-plans').getPublicUrl(path)
        floor_plan_url = urlData.publicUrl
        console.log('[AddPage] Public URL:', floor_plan_url)
      }

      setUploadStep('Saving page…')
      console.log('[AddPage] Inserting page row, name:', name.trim(), 'floor_plan_url:', floor_plan_url)

      const { data, error: pErr } = await supabase
        .from('pages')
        .insert({ project_id: projectId, name: name.trim(), floor_plan_url })
        .select()
        .single()

      if (pErr) {
        console.error('[AddPage] DB insert error:', pErr)
        throw pErr
      }
      console.log('[AddPage] Page created:', data)

      setUploadStep('')
      onCreated(data)
      onClose()
    } catch (err) {
      console.error('[AddPage] handleSubmit failed:', err)
      setError(err.message || 'Something went wrong. Please try again.')
      setUploadStep('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Add Floor Plan</h2>
          <button onClick={onClose} disabled={loading} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Page Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Level 1, Section A" required />
          </div>
          <div>
            <label className="label">Floor Plan Image (optional)</label>
            <div
              onClick={() => !loading && fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${loading ? 'border-border opacity-50 cursor-not-allowed' : 'border-border hover:border-accent/50 cursor-pointer'}`}
            >
              {file ? (
                <p className="text-sm text-accent font-medium">{file.name}</p>
              ) : (
                <>
                  <svg className="w-8 h-8 text-muted mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-sm text-muted">Click to upload floor plan</p>
                  <p className="text-xs text-muted mt-1">PNG, JPG, PDF up to 20MB</p>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e => setFile(e.target.files[0])} />
          </div>

          {uploadStep && !error && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
              {uploadStep}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={loading} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? (
                <span className="flex items-center justify-center gap-1.5">
                  <div className="w-3.5 h-3.5 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                  {file ? 'Uploading…' : 'Adding…'}
                </span>
              ) : 'Add Page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddMemberModal({ projectId, onClose, onAdded }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // Find profile by email
      const { data: userProfile, error: pErr } = await supabase
        .from('profiles')
        .select('id, name')
        .eq('email', email.trim().toLowerCase())
        .single()

      if (pErr || !userProfile) throw new Error('No user found with that email')

      // Check not already a member
      const { data: existing } = await supabase
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', userProfile.id)
        .single()

      if (existing) throw new Error('User is already a member')

      const { error: mErr } = await supabase
        .from('project_members')
        .insert({ project_id: projectId, user_id: userProfile.id })

      if (mErr) throw mErr

      onAdded()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Add Team Member</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Member Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="member@company.com" required />
          </div>
          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">{error}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Adding...' : 'Add Member'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ProjectDetail() {
  const { projectId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [pages, setPages] = useState([])
  const [members, setMembers] = useState([])
  const [todaySessions, setTodaySessions] = useState([])
  const [activePage, setActivePage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAddPage, setShowAddPage] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [editingTarget, setEditingTarget] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [savingTarget, setSavingTarget] = useState(false)
  const [editingTotalTarget, setEditingTotalTarget] = useState(false)
  const [totalTargetInput, setTotalTargetInput] = useState('')
  const [savingTotalTarget, setSavingTotalTarget] = useState(false)
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false)
  const [editingPageId, setEditingPageId] = useState(null)
  const [editingPageName, setEditingPageName] = useState('')
  const [editingProjectInfo, setEditingProjectInfo] = useState(false)
  const [editInfoName, setEditInfoName] = useState('')
  const [editInfoDesc, setEditInfoDesc] = useState('')
  const [savingProjectInfo, setSavingProjectInfo] = useState(false)

  const canManage = profile?.role === 'admin' || profile?.role === 'pm'

  async function saveProjectInfo() {
    const name = editInfoName.trim()
    if (!name) return
    setSavingProjectInfo(true)
    const description = editInfoDesc.trim() || null
    await supabase.from('projects').update({ name, description }).eq('id', projectId)
    setProject(p => ({ ...p, name, description }))
    setSavingProjectInfo(false)
    setEditingProjectInfo(false)
  }

  async function savePageRename(page) {
    const trimmed = editingPageName.trim()
    if (!trimmed || trimmed === page.name) { setEditingPageId(null); return }
    await supabase.from('pages').update({ name: trimmed }).eq('id', page.id)
    setPages(ps => ps.map(p => p.id === page.id ? { ...p, name: trimmed } : p))
    if (activePage?.id === page.id) setActivePage(p => ({ ...p, name: trimmed }))
    setEditingPageId(null)
  }

  async function loadTodaySessions(pgs) {
    if (!pgs?.length) return
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*, profiles(full_name)')
      .in('page_id', pgs.map(p => p.id))
      .order('created_at', { ascending: false })
    console.log('[ProjectDetail] Sessions fetch:', {
      pageIds: pgs.map(p => p.id),
      sessionsFound: sessions?.length,
      error,
    })
    setTodaySessions(sessions || [])
  }

  async function refreshSessions() {
    setSessionsRefreshing(true)
    try { await loadTodaySessions(pages) }
    finally { setSessionsRefreshing(false) }
  }

  async function loadData() {
    setLoading(true)
    try {
      const [{ data: proj }, { data: pgs }, { data: mems }] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('pages').select('*').eq('project_id', projectId).order('created_at'),
        supabase.from('project_members').select('user_id, profiles(*)').eq('project_id', projectId),
      ])

      setProject(proj)
      setPages(pgs || [])
      setMembers((mems || []).map(m => m.profiles))
      setTargetInput(proj?.daily_sf_target || 0)
      setTotalTargetInput(proj?.total_sf_target || 0)
      if (pgs && pgs.length > 0) setActivePage(pgs[0])

      await loadTodaySessions(pgs || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [projectId])

  const today = new Date().toISOString().slice(0, 10)
  const todaySF = todaySessions.filter(s => s.work_date === today).reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)
  const totalSF = todaySessions.reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)
  const pct = project?.daily_sf_target > 0
    ? Math.min(100, Math.round((todaySF / project.daily_sf_target) * 100))
    : 0
  const totalPct = project?.total_sf_target > 0
    ? Math.min(100, Math.round((totalSF / project.total_sf_target) * 100))
    : 0

  async function saveTarget() {
    setSavingTarget(true)
    try {
      await supabase.from('projects').update({ daily_sf_target: parseFloat(targetInput) || 0 }).eq('id', projectId)
      setProject(p => ({ ...p, daily_sf_target: parseFloat(targetInput) || 0 }))
      setEditingTarget(false)
    } catch (err) { console.error(err) }
    finally { setSavingTarget(false) }
  }

  async function saveTotalTarget() {
    setSavingTotalTarget(true)
    try {
      await supabase.from('projects').update({ total_sf_target: parseFloat(totalTargetInput) || 0 }).eq('id', projectId)
      setProject(p => ({ ...p, total_sf_target: parseFloat(totalTargetInput) || 0 }))
      setEditingTotalTarget(false)
    } catch (err) { console.error(err) }
    finally { setSavingTotalTarget(false) }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    )
  }

  if (!project) {
    return (
      <Layout>
        <div className="text-center py-16 text-muted">Project not found or access denied.</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)]">
        {/* Main area */}
        <div className="flex-1 overflow-auto">
          {/* Project header */}
          <div className="px-4 py-4 border-b border-border bg-surface/50">
            <div className="flex items-start gap-3">
              <button onClick={() => navigate('/projects')} className="btn-ghost p-1.5 mt-0.5 shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                {editingProjectInfo ? (
                  <div className="space-y-1.5">
                    <input
                      autoFocus
                      className="input py-0.5 text-sm w-full"
                      value={editInfoName}
                      onChange={e => setEditInfoName(e.target.value)}
                      placeholder="Project name"
                      onKeyDown={e => { if (e.key === 'Escape') setEditingProjectInfo(false) }}
                    />
                    <input
                      className="input py-0.5 text-xs w-full"
                      value={editInfoDesc}
                      onChange={e => setEditInfoDesc(e.target.value)}
                      placeholder="Add description..."
                      onKeyDown={e => { if (e.key === 'Escape') setEditingProjectInfo(false) }}
                    />
                    <div className="flex gap-1.5">
                      <button onClick={saveProjectInfo} disabled={savingProjectInfo || !editInfoName.trim()} className="btn-primary py-0.5 px-2 text-xs flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        {savingProjectInfo ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingProjectInfo(false)} className="btn-ghost py-0.5 px-2 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-lg font-bold text-white">{project.name}</h1>
                      <StatusBadge
                        status={project.status}
                        onSave={async s => {
                          await supabase.from('projects').update({ status: s }).eq('id', projectId)
                          setProject(p => ({ ...p, status: s }))
                        }}
                      />
                      {canManage && (
                        <button
                          onClick={() => { setEditInfoName(project.name); setEditInfoDesc(project.description || ''); setEditingProjectInfo(true) }}
                          className="btn-ghost p-0.5 opacity-60 hover:opacity-100"
                          title="Edit project"
                        >
                          <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                        </button>
                      )}
                    </div>
                    {project.address && <p className="text-sm text-muted mt-0.5">{project.address}</p>}
                    {project.description && <p className="text-sm text-gray-400 mt-0.5">{project.description}</p>}
                  </>
                )}
              </div>
              {canManage && (
                <button onClick={() => setShowAddPage(true)} className="btn-primary flex items-center gap-1.5 shrink-0 text-xs">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add Floor Plan
                </button>
              )}
            </div>
          </div>

          {/* Pages tabs */}
          {pages.length > 0 ? (
            <>
              <div className="flex gap-2 px-4 py-3 border-b border-border overflow-x-auto">
                {pages.map(page => {
                  const isActive = activePage?.id === page.id
                  const isEditingThis = editingPageId === page.id
                  return (
                    <div key={page.id} className="shrink-0 group/tab relative">
                      {isEditingThis ? (
                        <div className="flex flex-col items-center gap-1" style={{ width: 120 }}>
                          <input
                            autoFocus
                            className="text-xs bg-surface-3 border border-accent/50 rounded px-2 py-1 w-full text-white text-center"
                            value={editingPageName}
                            onChange={e => setEditingPageName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') savePageRename(page); if (e.key === 'Escape') setEditingPageId(null) }}
                          />
                          <div className="flex gap-1">
                            <button onClick={() => savePageRename(page)} className="text-accent text-xs">Save</button>
                            <button onClick={() => setEditingPageId(null)} className="text-muted text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => setActivePage(page)}
                          className={`cursor-pointer rounded-xl border-2 flex items-center justify-center text-center font-semibold text-sm transition-all px-2 ${
                            isActive ? 'border-accent text-accent bg-surface' : 'border-border text-gray-400 bg-surface hover:border-gray-500'
                          }`}
                          style={{ width: 120, height: 80 }}
                        >
                          {page.name}
                        </div>
                      )}
                      {canManage && !isEditingThis && (
                        <button
                          onClick={e => { e.stopPropagation(); setEditingPageId(page.id); setEditingPageName(page.name) }}
                          className="absolute top-1 right-1 p-0.5 rounded bg-black/60 opacity-0 group-hover/tab:opacity-100 transition-opacity"
                          title="Rename"
                        >
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {activePage && (
                <div className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/canvas/${activePage.id}`)}
                    className="btn-primary flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                    Open Canvas — {activePage.name}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4">
              <div className="w-12 h-12 bg-surface-2 rounded-xl flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                </svg>
              </div>
              <p className="text-gray-400 font-medium">No floor plans yet</p>
              {canManage && (
                <button onClick={() => setShowAddPage(true)} className="btn-primary mt-4 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add First Floor Plan
                </button>
              )}
            </div>
          )}

          {/* Progress */}
          <div className="px-4 pb-4">
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-surface/50 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Progress</h2>
                <button
                  onClick={refreshSessions}
                  disabled={sessionsRefreshing}
                  className="btn-ghost py-1 px-2 text-xs flex items-center gap-1"
                >
                  {sessionsRefreshing
                    ? <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                    : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                  }
                  Refresh
                </button>
              </div>

              {/* Total progress bar (blue) */}
              <div className="px-4 py-3 border-b border-border bg-surface/30">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs text-muted font-medium">Total Progress</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-white">
                      {totalSF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      {project?.total_sf_target > 0 && (
                        <span className="text-muted font-normal"> / {project.total_sf_target.toLocaleString()} SF</span>
                      )}
                    </span>
                    {canManage && !editingTotalTarget && (
                      <button onClick={() => setEditingTotalTarget(true)} className="btn-ghost p-1 ml-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {editingTotalTarget && (
                  <div className="flex items-center gap-1 mb-2">
                    <input
                      type="number"
                      value={totalTargetInput}
                      onChange={e => setTotalTargetInput(e.target.value)}
                      className="input w-28 text-xs py-1"
                      min="0"
                      placeholder="Total SF target"
                    />
                    <button onClick={saveTotalTarget} disabled={savingTotalTarget} className="btn-primary text-xs py-1 px-2">
                      {savingTotalTarget ? '...' : 'Save'}
                    </button>
                    <button onClick={() => setEditingTotalTarget(false)} className="btn-ghost text-xs py-1 px-2">Cancel</button>
                  </div>
                )}
                {project?.total_sf_target > 0 && (
                  <>
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${totalPct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-muted">{totalPct}% complete</span>
                      {totalPct >= 100 && <span className="text-blue-400 font-medium">Building complete!</span>}
                    </div>
                  </>
                )}
              </div>

              {/* Daily progress bar (green) */}
              <div className="px-4 py-3 border-b border-border bg-surface/30">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-xs text-muted font-medium">Daily Progress</span>
                  <span className="text-sm font-semibold text-white">
                    {todaySF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    {project?.daily_sf_target > 0 && (
                      <span className="text-muted font-normal"> / {project.daily_sf_target.toLocaleString()} SF</span>
                    )}
                  </span>
                </div>
                {project?.daily_sf_target > 0 && (
                  <>
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-muted">{pct}% complete</span>
                      {pct >= 100 && <span className="text-accent font-medium">Target reached!</span>}
                    </div>
                  </>
                )}
              </div>

              {/* Sessions grouped by date */}
              {todaySessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted">No sessions saved yet</div>
              ) : (() => {
                const pageMap = Object.fromEntries(pages.map(p => [p.id, p.name]))
                const byDate = {}
                todaySessions.forEach(s => {
                  const d = s.work_date || s.created_at?.slice(0, 10) || 'Unknown'
                  if (!byDate[d]) byDate[d] = []
                  byDate[d].push(s)
                })
                const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
                return (
                  <div className="divide-y divide-border">
                    {sortedDates.map(date => {
                      const dateSessions = byDate[date]
                      const dateSF = dateSessions.reduce((sum, s) => sum + (parseFloat(s.sf) || 0), 0)
                      const label = (() => {
                        try { return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
                        catch { return date }
                      })()
                      return (
                        <div key={date} className="px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-200">{label}{date === today && <span className="ml-1.5 text-accent">Today</span>}</p>
                            <p className="text-xs text-muted">{dateSF.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF</p>
                          </div>
                          <div className="space-y-2">
                            {dateSessions.map(session => (
                              <div key={session.id} className="flex items-center gap-2.5">
                                <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: session.color || '#facc15' }} />
                                <p className="text-xs text-gray-300 flex-1 truncate">{session.name || 'Session'}</p>
                                <p className="text-xs text-muted shrink-0">
                                  {[
                                    session.profiles?.full_name || 'Unknown',
                                    pageMap[session.page_id],
                                    (() => { const sf = parseFloat(session.sf) || 0; const ct = session.count_data?.length || 0; return sf > 0 && ct > 0 ? `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF · ${ct} items` : ct > 0 ? `${ct} items` : `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF` })(),
                                    session.created_at ? new Date(session.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
                                  ].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-surface/30 overflow-auto">
          <div className="p-4 space-y-4">
            {/* Progress */}
            <div>
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Progress</h3>
              <div className="bg-surface-2 rounded-xl p-3 space-y-4">

                {/* Total progress (blue) */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-xs text-muted font-medium">Total Progress</p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-gray-300">
                        {totalSF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {project?.total_sf_target > 0 && <span className="text-muted"> / {project.total_sf_target.toLocaleString()}</span>}
                        {' SF'}
                      </p>
                      {canManage && !editingTotalTarget && (
                        <button onClick={() => setEditingTotalTarget(true)} className="btn-ghost p-0.5">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {editingTotalTarget && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <input
                        type="number"
                        value={totalTargetInput}
                        onChange={e => setTotalTargetInput(e.target.value)}
                        className="input w-24 text-xs py-1"
                        min="0"
                        placeholder="Total SF"
                      />
                      <button onClick={saveTotalTarget} disabled={savingTotalTarget} className="btn-primary text-xs py-1 px-2">
                        {savingTotalTarget ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingTotalTarget(false)} className="btn-ghost text-xs py-1 px-1">✕</button>
                    </div>
                  )}
                  {project?.total_sf_target > 0 ? (
                    <>
                      <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${totalPct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-muted">{totalPct}%</span>
                        {totalPct >= 100 && <span className="text-blue-400 font-medium">Complete!</span>}
                      </div>
                    </>
                  ) : (
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500/30 rounded-full" style={{ width: '0%' }} />
                    </div>
                  )}
                </div>

                {/* Daily progress (green) */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-xs text-muted font-medium">Daily Progress</p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-gray-300">
                        {todaySF.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {project?.daily_sf_target > 0 && <span className="text-muted"> / {project.daily_sf_target.toLocaleString()}</span>}
                        {' SF'}
                      </p>
                      {canManage && !editingTarget && (
                        <button onClick={() => setEditingTarget(true)} className="btn-ghost p-0.5">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {editingTarget && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <input
                        type="number"
                        value={targetInput}
                        onChange={e => setTargetInput(e.target.value)}
                        className="input w-24 text-xs py-1"
                        min="0"
                        placeholder="Daily SF"
                      />
                      <button onClick={saveTarget} disabled={savingTarget} className="btn-primary text-xs py-1 px-2">
                        {savingTarget ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingTarget(false)} className="btn-ghost text-xs py-1 px-1">✕</button>
                    </div>
                  )}
                  {project?.daily_sf_target > 0 ? (
                    <>
                      <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-muted">{pct}%</span>
                        {pct >= 100 && <span className="text-accent font-medium">Target reached!</span>}
                      </div>
                    </>
                  ) : (
                    <div className="h-2 bg-surface-3 rounded-full overflow-hidden">
                      <div className="h-full bg-accent/30 rounded-full" style={{ width: '0%' }} />
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Today's Sessions */}
            {todaySessions.filter(s => s.work_date === today).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Today's Sessions</h3>
                <div className="space-y-2">
                  {todaySessions.filter(s => s.work_date === today).map(session => (
                    <div key={session.id} className="bg-surface-2 rounded-lg p-2.5 flex items-center gap-2.5">
                      <div
                        className="w-6 h-6 rounded-full shrink-0"
                        style={{ backgroundColor: session.color || '#facc15' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-200 truncate">{session.name || 'Session'}</p>
                        <p className="text-xs text-muted">
                          {(() => { const sf = parseFloat(session.sf) || 0; const ct = session.count_data?.length || 0; return sf > 0 && ct > 0 ? `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF · ${ct} items` : ct > 0 ? `${ct} items` : `${sf.toLocaleString(undefined, { maximumFractionDigits: 0 })} SF` })()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Team Members */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Team Members</h3>
                {canManage && (
                  <button onClick={() => setShowAddMember(true)} className="btn-ghost py-0.5 px-2 text-xs">
                    + Add
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {members.map(member => member && (
                  <div key={member.id} className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-bg shrink-0"
                      style={{ backgroundColor: member.color || '#4ade80' }}
                    >
                      {(member.name || 'U')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-200 truncate">{member.name}</p>
                      <p className="text-xs text-muted capitalize">{member.role}</p>
                    </div>
                  </div>
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-muted">No members yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAddPage && (
        <AddPageModal
          projectId={projectId}
          onClose={() => setShowAddPage(false)}
          onCreated={newPage => {
            setShowAddPage(false)
            // Full reload so the pages list reflects the saved floor_plan_url from DB
            loadData().then(() => setActivePage(newPage))
          }}
        />
      )}
      {showAddMember && (
        <AddMemberModal
          projectId={projectId}
          onClose={() => setShowAddMember(false)}
          onAdded={loadData}
        />
      )}
    </Layout>
  )
}
