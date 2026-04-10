import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const STATUS_OPTIONS = ['active', 'completed', 'on hold']

function badgeClass(status) {
  if (status === 'active') return 'badge-active'
  if (status === 'completed') return 'badge-completed'
  return 'badge-on-hold'
}

function StatusBadge({ status, onSave, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function select(e, s) {
    e.stopPropagation()
    setOpen(false)
    if (s !== status) await onSave(s)
  }

  return (
    <div ref={ref} className={`relative inline-flex ${className}`} onClick={e => e.stopPropagation()}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className={`${badgeClass(status)} cursor-pointer hover:opacity-80 transition-opacity capitalize`}
      >
        {status}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 min-w-[110px] py-1 overflow-hidden">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={e => select(e, s)}
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

function CreateProjectModal({ onClose, onCreated }) {
  const { user } = useAuth()
  const [form, setForm] = useState({ name: '', description: '', address: '', status: 'active', daily_sf_target: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: project, error: pErr } = await supabase
        .from('projects')
        .insert({
          name: form.name.trim(),
          description: form.description.trim() || null,
          address: form.address.trim() || null,
          status: form.status,
          daily_sf_target: parseFloat(form.daily_sf_target) || 0,
          created_by: user.id,
        })
        .select()
        .single()

      if (pErr) throw pErr

      // Add creator as member — ignore duplicate key if already a member
      const { error: mErr } = await supabase
        .from('project_members')
        .insert({ project_id: project.id, user_id: user.id })

      if (mErr && !mErr.message.includes('duplicate key')) throw mErr

      onCreated(project)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">New Project</h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Project Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Warehouse District B" required />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Overhead steel cleaning, Level 1 final clean, Post-construction detail" />
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Industrial Blvd" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="label">Daily SF Target</label>
              <input className="input" type="number" min="0" value={form.daily_sf_target} onChange={e => set('daily_sf_target', e.target.value)} placeholder="5000" />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const PencilIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
  </svg>
)

function InlineTargetEdit({ label, value, onSave, canManage, colorClass = 'text-gray-200' }) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  async function commit() {
    setSaving(true)
    await onSave(parseFloat(input) || 0)
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          type="number"
          min="0"
          className="input py-0.5 text-xs w-20"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={commit}
        />
        {saving && <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin shrink-0" />}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 group/target">
      <p className={`text-sm font-semibold ${colorClass}`}>
        {value ? value.toLocaleString() : '—'} <span className="text-xs font-normal text-muted">SF</span>
      </p>
      {canManage && (
        <button
          onClick={e => { e.stopPropagation(); setInput(value ?? ''); setEditing(true) }}
          className="btn-ghost p-0.5 opacity-0 group-hover/target:opacity-100 transition-opacity"
        >
          <PencilIcon />
        </button>
      )}
    </div>
  )
}

function ProjectCard({ project, todaySF, allTimeSF, onClick, onRename, onUpdateProject, canManage }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [editDesc, setEditDesc] = useState(project.description || '')
  const [saving, setSaving] = useState(false)

  const dailyPct = project.daily_sf_target > 0
    ? Math.min(100, Math.round((todaySF / project.daily_sf_target) * 100))
    : 0
  const totalPct = project.total_sf_target > 0
    ? Math.min(100, Math.round((allTimeSF / project.total_sf_target) * 100))
    : 0

  function openEdit(e) {
    e.stopPropagation()
    setEditName(project.name)
    setEditDesc(project.description || '')
    setEditing(true)
  }

  function cancelEdit(e) {
    e?.stopPropagation()
    setEditing(false)
  }

  async function saveEdit(e) {
    e?.stopPropagation()
    const name = editName.trim()
    if (!name) return
    setSaving(true)
    const desc = editDesc.trim() || null
    await supabase.from('projects').update({ name, description: desc }).eq('id', project.id)
    setSaving(false)
    setEditing(false)
    onRename(project.id, name)
    onUpdateProject(project.id, { description: desc })
  }

  async function saveDailyTarget(val) {
    await supabase.from('projects').update({ daily_sf_target: val }).eq('id', project.id)
    onUpdateProject(project.id, { daily_sf_target: val })
  }

  async function saveTotalTarget(val) {
    await supabase.from('projects').update({ total_sf_target: val }).eq('id', project.id)
    onUpdateProject(project.id, { total_sf_target: val })
  }

  return (
    <div
      onClick={editing ? undefined : onClick}
      className="card hover:border-accent/40 hover:bg-surface/80 cursor-pointer transition-all duration-150 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
              <input
                autoFocus
                className="input py-0.5 text-sm w-full"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Project name"
                onKeyDown={e => { if (e.key === 'Escape') cancelEdit(e) }}
              />
              <input
                className="input py-0.5 text-xs w-full"
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                placeholder="Add description..."
                onKeyDown={e => { if (e.key === 'Escape') cancelEdit(e) }}
              />
              <div className="flex gap-1.5">
                <button onClick={saveEdit} disabled={saving || !editName.trim()} className="btn-primary py-0.5 px-2 text-xs flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={cancelEdit} className="btn-ghost py-0.5 px-2 text-xs">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="font-semibold text-gray-100 group-hover:text-white truncate">{project.name}</h3>
                {canManage && (
                  <button
                    onClick={openEdit}
                    className="btn-ghost p-0.5 opacity-0 group-hover:opacity-100 shrink-0"
                    title="Edit"
                  >
                    <svg className="w-3 h-3 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" /></svg>
                  </button>
                )}
              </div>
              {project.address && (
                <p className="text-xs text-muted mt-0.5 truncate">{project.address}</p>
              )}
              {project.description && (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{project.description}</p>
              )}
            </>
          )}
        </div>
        {!editing && (
          <StatusBadge
            status={project.status}
            className="ml-2 shrink-0"
            onSave={async s => {
              await supabase.from('projects').update({ status: s }).eq('id', project.id)
              onUpdateProject(project.id, { status: s })
            }}
          />
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Daily Target</p>
          <InlineTargetEdit
            value={project.daily_sf_target}
            onSave={saveDailyTarget}
            canManage={canManage}
          />
        </div>
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Total Target</p>
          <InlineTargetEdit
            value={project.total_sf_target}
            onSave={saveTotalTarget}
            canManage={canManage}
            colorClass="text-blue-300"
          />
        </div>
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Today's SF</p>
          <p className="text-sm font-semibold text-accent">
            {todaySF.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs font-normal text-muted">SF</span>
          </p>
        </div>
        <div className="bg-surface-2 rounded-lg p-2.5">
          <p className="text-xs text-muted mb-0.5">Total Cleaned</p>
          <p className="text-sm font-semibold text-gray-200">
            {allTimeSF.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-xs font-normal text-muted">SF</span>
          </p>
        </div>
      </div>

      {/* Daily progress bar (green) */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted">Daily progress</span>
          <span className={dailyPct >= 100 ? 'text-accent font-medium' : 'text-gray-400'}>
            {project.daily_sf_target > 0 ? `${dailyPct}%` : '—'}
          </span>
        </div>
        <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all duration-700" style={{ width: `${dailyPct}%` }} />
        </div>
      </div>

      {/* Total progress bar (blue) */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted">Total progress</span>
          <span className={totalPct >= 100 ? 'text-blue-400 font-medium' : 'text-gray-400'}>
            {project.total_sf_target > 0 ? `${totalPct}%` : 'Total target not set'}
          </span>
        </div>
        <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${totalPct}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <span className="text-xs text-muted">Click to open project</span>
        <svg className="w-4 h-4 text-muted group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )
}

export default function Projects() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [sfByProject, setSfByProject] = useState({})
  const [sfTodayByProject, setSfTodayByProject] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  const canCreate = profile?.role === 'admin' || profile?.role === 'pm'

  function handleUpdateProject(id, patch) {
    setProjects(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
  }

  async function loadProjects() {
    const userId = user?.id
    if (!userId) return

    setLoading(true)
    setLoadError('')

    // 5-second hard timeout so the skeleton never spins forever
    const timeoutId = setTimeout(() => {
      setLoading(false)
      setLoadError('Loading timed out. Check your connection and try refreshing.')
    }, 5000)

    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })

      console.log('[Projects] fetch result:', { count: data?.length, error })
      if (error) throw error
      setProjects(data || [])

      const projectIds = (data || []).map(p => p.id)
      if (projectIds.length === 0) { setSfByProject({}); setSfTodayByProject({}); return }

      // Fetch all pages for all projects in one query
      const { data: allPages } = await supabase
        .from('pages')
        .select('id, project_id')
        .in('project_id', projectIds)

      const pageToProject = {}
      ;(allPages || []).forEach(pg => { pageToProject[pg.id] = pg.project_id })
      const allPageIds = Object.keys(pageToProject)

      if (allPageIds.length === 0) { setSfByProject({}); setSfTodayByProject({}); return }

      // Fetch all sessions for those pages in one query
      const today = new Date().toLocaleDateString('en-CA')
      const { data: allSessions } = await supabase
        .from('sessions')
        .select('page_id, sf, work_date')
        .in('page_id', allPageIds)

      const totalMap = {}
      const todayMap = {}
      ;(allSessions || []).forEach(s => {
        const projId = pageToProject[s.page_id]
        if (!projId) return
        const sf = parseFloat(s.sf) || 0
        totalMap[projId] = (totalMap[projId] || 0) + sf
        if (s.work_date === today) todayMap[projId] = (todayMap[projId] || 0) + sf
      })

      setSfByProject(totalMap)
      setSfTodayByProject(todayMap)
    } catch (err) {
      console.error('loadProjects error:', err)
      setLoadError(err.message || 'Failed to load projects. Please try refreshing.')
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadProjects()
  }, [user])

  const filtered = projects.filter(p => {
    const matchSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || (p.address || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = filterStatus === 'all' || p.status === filterStatus
    return matchSearch && matchStatus
  })

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">Projects</h1>
            <p className="text-sm text-muted mt-0.5">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'} assigned
            </p>
          </div>
          {canCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 self-start sm:self-auto">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Project
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <svg className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search projects..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="input pl-9"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'active', 'completed', 'on hold'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
                  filterStatus === s ? 'bg-accent/10 text-accent border border-accent/30' : 'bg-surface-2 text-muted hover:text-gray-300 border border-border'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="card animate-pulse">
                <div className="h-5 bg-surface-3 rounded w-3/4 mb-3" />
                <div className="h-4 bg-surface-3 rounded w-1/2 mb-4" />
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="h-14 bg-surface-3 rounded-lg" />
                  <div className="h-14 bg-surface-3 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-gray-300 font-medium mb-1">Failed to load projects</p>
            <p className="text-sm text-muted mb-4">{loadError}</p>
            <button onClick={loadProjects} className="btn-secondary">
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-surface-2 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <p className="text-gray-400 font-medium">No projects found</p>
            <p className="text-sm text-muted mt-1">
              {projects.length === 0 ? 'You have not been added to any projects yet.' : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                todaySF={sfTodayByProject[project.id] || 0}
                allTimeSF={sfByProject[project.id] || 0}
                onClick={() => navigate(`/projects/${project.id}`)}
                canManage={canCreate}
                onRename={(id, name) => setProjects(ps => ps.map(p => p.id === id ? { ...p, name } : p))}
                onUpdateProject={handleUpdateProject}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => loadProjects()}
        />
      )}
    </Layout>
  )
}
