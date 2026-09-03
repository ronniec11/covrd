import { useEffect, useState } from 'react'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { rowsToCsv, downloadCsv } from '../lib/csv'

const REPORT_COLUMNS = [
  { key: 'person', label: 'Person' },
  { key: 'project', label: 'Project' },
  { key: 'floorPlan', label: 'Floor Plan' },
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'sf', label: 'SF' },
  { key: 'countItems', label: 'Count Items' },
  { key: 'crewSize', label: 'Crew Size' },
  { key: 'hoursWorked', label: 'Hours Worked' },
  { key: 'sfPerPersonHour', label: 'SF per Person-Hour' },
]

function todayISO() {
  return new Date().toLocaleDateString('en-CA')
}

function daysAgoISO(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-CA')
}

function monthStartISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA')
}

function countItemsFor(countData) {
  if (Array.isArray(countData)) return countData.length
  return countData?.markers?.length ?? 0
}

function shapeRow(s) {
  const crew = s.crew_size ?? null
  const hours = s.hours_worked ?? null
  const sf = parseFloat(s.sf) || 0
  const sfPerPersonHour = (crew > 0 && hours > 0) ? sf / (crew * hours) : null
  return {
    person: s.profiles?.full_name || 'Unknown',
    project: s.pages?.projects?.name || '',
    floorPlan: s.pages?.name || '',
    date: s.work_date || '',
    time: s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    sf: Math.round(sf),
    countItems: countItemsFor(s.count_data),
    crewSize: crew ?? '',
    hoursWorked: hours ?? '',
    sfPerPersonHour: sfPerPersonHour != null ? sfPerPersonHour.toFixed(1) : '',
  }
}

export default function Reports() {
  const { profile } = useAuth()
  const canView = profile?.role === 'admin' || profile?.role === 'pm'

  const [projectOptions, setProjectOptions] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasRun, setHasRun] = useState(false)
  const [migrationMissing, setMigrationMissing] = useState(false)

  useEffect(() => {
    if (!canView) return
    supabase.from('projects').select('id, name').order('name')
      .then(({ data, error: err }) => { if (!err) setProjectOptions(data || []) })
  }, [canView])

  function setPreset(preset) {
    if (preset === 'week') { setStartDate(daysAgoISO(7)); setEndDate(todayISO()) }
    else if (preset === 'month') { setStartDate(monthStartISO()); setEndDate(todayISO()) }
    else { setStartDate(''); setEndDate('') }
  }

  async function runReport() {
    setLoading(true); setError(''); setHasRun(false)
    try {
      let pageQuery = supabase.from('pages').select('id')
      if (selectedProjectId !== 'all') pageQuery = pageQuery.eq('project_id', selectedProjectId)
      const { data: pgs, error: pgErr } = await pageQuery
      if (pgErr) throw pgErr
      const pageIds = (pgs || []).map(p => p.id)
      if (pageIds.length === 0) { setRows([]); setHasRun(true); return }

      const FULL_COLUMNS = 'id, page_id, user_id, name, sf, work_date, created_at, count_data, crew_size, hours_worked, profiles(full_name), pages(name, project_id, projects(name))'
      const FALLBACK_COLUMNS = 'id, page_id, user_id, name, sf, work_date, created_at, count_data, profiles(full_name), pages(name, project_id, projects(name))'

      function buildQuery(columns) {
        let q = supabase.from('sessions').select(columns).in('page_id', pageIds)
          .order('work_date', { ascending: false }).order('created_at', { ascending: false })
        if (startDate) q = q.gte('work_date', startDate)
        if (endDate) q = q.lte('work_date', endDate)
        return q
      }

      let { data, error: sessErr } = await buildQuery(FULL_COLUMNS)
      let missingMigration = false
      if (sessErr && /crew_size|hours_worked/.test(sessErr.message)) {
        // Pre-migration DB — retry without the not-yet-existing columns.
        console.warn('[Reports] crew_size/hours_worked columns not found, retrying without them — run the migration noted in Canvas.jsx / supabase-schema.sql.')
        missingMigration = true
        ;({ data, error: sessErr } = await buildQuery(FALLBACK_COLUMNS))
      }
      if (sessErr) throw sessErr
      setMigrationMissing(missingMigration)
      setRows((data || []).map(shapeRow))
      setHasRun(true)
    } catch (err) {
      console.error('[Reports] runReport failed:', err)
      setError(err.message || 'Failed to load report data.')
    } finally {
      setLoading(false)
    }
  }

  function handleDownload() {
    const label = `${startDate || 'all'}_to_${endDate || 'all'}`
    downloadCsv(`production-report-${label}.csv`, rowsToCsv(rows, REPORT_COLUMNS))
  }

  const showProjectColumn = selectedProjectId === 'all'

  if (!canView) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-gray-300 font-medium mb-1">Reports are only available to admins and PMs.</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Production Report</h1>
          <p className="text-sm text-muted mt-0.5">Session-level production data for project estimating.</p>
        </div>

        <div className="card mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-muted mb-1">Project</label>
              <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} className="input">
                <option value="all">All Projects</option>
                {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPreset('week')} className="btn-secondary text-sm">Last 7 days</button>
              <button onClick={() => setPreset('month')} className="btn-secondary text-sm">This month</button>
              <button onClick={() => setPreset('all')} className="btn-secondary text-sm">All time</button>
            </div>
            <button onClick={runReport} disabled={loading} className="btn-primary">
              {loading ? 'Running…' : 'Run Report'}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-center py-10">
            <p className="text-gray-300 font-medium mb-1">Failed to load report</p>
            <p className="text-sm text-muted">{error}</p>
          </div>
        )}

        {!error && hasRun && rows.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 font-medium">No sessions found for this range.</p>
          </div>
        )}

        {!error && hasRun && migrationMissing && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-200">
            Crew Size / Hours Worked columns don't exist in the database yet, so those two fields are blank below for every row. Run the migration noted in Canvas.jsx / supabase-schema.sql (ALTER TABLE ... crew_size / hours_worked) in the Supabase SQL editor, then run this report again.
          </div>
        )}

        {!error && hasRun && rows.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted">{rows.length} session{rows.length === 1 ? '' : 's'}</p>
              <button onClick={handleDownload} className="btn-secondary flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download CSV
              </button>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-border">
                    <th className="py-2 pr-4">Person</th>
                    {showProjectColumn && <th className="py-2 pr-4">Project</th>}
                    <th className="py-2 pr-4">Floor Plan</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4 text-right">SF</th>
                    <th className="py-2 pr-4 text-right">Count</th>
                    <th className="py-2 pr-4 text-right">Crew</th>
                    <th className="py-2 pr-4 text-right">Hours</th>
                    <th className="py-2 pr-4 text-right">SF/Person-Hr</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50 text-gray-300">
                      <td className="py-2 pr-4">{r.person}</td>
                      {showProjectColumn && <td className="py-2 pr-4">{r.project}</td>}
                      <td className="py-2 pr-4">{r.floorPlan}</td>
                      <td className="py-2 pr-4">{r.date}</td>
                      <td className="py-2 pr-4">{r.time}</td>
                      <td className="py-2 pr-4 text-right">{r.sf.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right">{r.countItems || '—'}</td>
                      <td className="py-2 pr-4 text-right">{r.crewSize || '—'}</td>
                      <td className="py-2 pr-4 text-right">{r.hoursWorked || '—'}</td>
                      <td className="py-2 pr-4 text-right">{r.sfPerPersonHour || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
