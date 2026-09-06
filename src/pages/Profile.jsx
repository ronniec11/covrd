import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'

const PRESET_COLORS = [
  '#4ade80', '#22d3ee', '#f472b6', '#fb923c', '#a78bfa',
  '#fbbf24', '#f87171', '#34d399', '#60a5fa', '#e879f9',
  '#f59e0b', '#84cc16', '#14b8a6', '#0ea5e9', '#6366f1',
  '#f43f5e', '#8b5cf6', '#ea580c', '#059669', '#db2777',
  '#64748b', '#fde047',
]

export default function Profile() {
  const { profile, updateProfile } = useAuth()
  const { theme, toggleTheme } = useTheme()
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

  const roleColors = { admin: 'text-red-600 dark:text-red-400', pm: 'text-yellow-600 dark:text-yellow-400', foreman: 'text-accent' }
  const roleLabels = { admin: 'Administrator', pm: 'Project Manager', foreman: 'Foreman' }

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-4 py-8">
        {returnTo && (
          <button
            onClick={() => navigate(returnTo, { replace: true })}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-gray-900 dark:hover:text-white mb-5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to canvas
          </button>
        )}
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-6">My Profile</h1>

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
              <p className="font-semibold text-gray-900 dark:text-white text-lg">{name || profile?.full_name}</p>
              <p className="text-sm text-muted">{profile?.email}</p>
              <span className={`text-xs font-semibold mt-0.5 block ${roleColors[profile?.role] || 'text-gray-500 dark:text-gray-400'}`}>
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
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-600 dark:text-red-400 text-sm">{error}</div>
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleTheme}
                className="btn-secondary flex items-center gap-2"
              >
                {theme === 'dark' ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1.5m0 15V21m9-9h-1.5M4.5 12H3m15.36-6.36l-1.06 1.06M6.7 17.3l-1.06 1.06m12.72 0l-1.06-1.06M6.7 6.7L5.64 5.64M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                    Light Mode
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                    </svg>
                    Dark Mode
                  </>
                )}
              </button>
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
            </div>
          </form>
        </div>

        {/* Role permissions info */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">Role & Permissions</h2>
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
                <span className={item.allowed ? 'text-gray-700 dark:text-gray-300' : 'text-muted'}>{item.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-3">Role changes require an administrator.</p>
        </div>
      </div>
    </Layout>
  )
}
