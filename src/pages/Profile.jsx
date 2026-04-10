import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'

const PRESET_COLORS = [
  '#4ade80', '#22d3ee', '#f472b6', '#fb923c', '#a78bfa',
  '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#e879f9',
]

export default function Profile() {
  const { profile, updateProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = location.state?.returnTo
  const [name, setName] = useState(profile?.full_name || '')
  const [color, setColor] = useState(profile?.avatar_color || '#4ade80')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSave(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await updateProfile({ full_name: name.trim(), avatar_color: color })
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        navigate(returnTo || '/projects', { replace: true })
      }, 1000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const roleColors = { admin: 'text-red-400', pm: 'text-yellow-400', foreman: 'text-accent' }
  const roleLabels = { admin: 'Administrator', pm: 'Project Manager', foreman: 'Foreman' }

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-4 py-8">
        {returnTo && (
          <button
            onClick={() => navigate(returnTo, { replace: true })}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-white mb-5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to canvas
          </button>
        )}
        <h1 className="text-xl font-bold text-white mb-6">My Profile</h1>

        <div className="card mb-4">
          {/* Avatar preview */}
          <div className="flex items-center gap-4 mb-6">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-bg shrink-0 transition-all duration-200"
              style={{ backgroundColor: color }}
            >
              {(name || profile?.full_name || 'U')[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-white text-lg">{name || profile?.full_name}</p>
              <p className="text-sm text-muted">{profile?.email}</p>
              <span className={`text-xs font-semibold mt-0.5 block ${roleColors[profile?.role] || 'text-gray-400'}`}>
                {roleLabels[profile?.role] || profile?.role}
              </span>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="label">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input"
                placeholder="Your name"
                required
              />
            </div>

            <div>
              <label className="label">Profile Color</label>
              <p className="text-xs text-muted mb-2">This is your personal color shown next to your name throughout the app. It's separate from the highlight colors you use on floor plans.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-lg transition-all duration-100 ${
                      color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-white scale-110' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border bg-surface-2 cursor-pointer p-0.5"
                />
                <span className="text-sm font-mono text-gray-400">{color}</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Profile saved!
                </>
              ) : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Role permissions info */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-200 mb-3">Role & Permissions</h2>
          <div className="space-y-2">
            {[
              { label: 'Highlight floor plans', allowed: true },
              { label: 'Use pen & annotation tools', allowed: true },
              { label: 'Save sessions', allowed: true },
              { label: 'View all team sessions', allowed: true },
              { label: 'Add floor plan pages', allowed: profile?.role === 'admin' || profile?.role === 'pm' },
              { label: 'Set daily SF targets', allowed: profile?.role === 'admin' || profile?.role === 'pm' },
              { label: 'Add team members', allowed: profile?.role === 'admin' || profile?.role === 'pm' },
              { label: 'Create projects', allowed: profile?.role === 'admin' || profile?.role === 'pm' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2.5 text-sm">
                {item.allowed ? (
                  <svg className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <span className={item.allowed ? 'text-gray-300' : 'text-muted'}>{item.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-3">Role changes require an administrator.</p>
        </div>
      </div>
    </Layout>
  )
}
