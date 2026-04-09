import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import CovrdLogo from '../assets/covrd-logo-full.svg'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const isCanvas = location.pathname.includes('/canvas/')

  return (
    <header className="h-14 bg-surface border-b border-border flex items-center px-4 gap-4 shrink-0 z-40">
      <Link to="/projects" className="flex items-center group">
        <img src={CovrdLogo} alt="Covrd" className="h-8 w-auto" />
      </Link>

      {!isCanvas && (
        <nav className="flex items-center gap-1 ml-2">
          <Link
            to="/projects"
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              location.pathname.startsWith('/projects') ? 'text-accent bg-accent/10' : 'text-muted hover:text-gray-300 hover:bg-surface-2'
            }`}
          >
            Projects
          </Link>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-2">
        {profile && (
          <Link
            to="/profile"
            className="flex items-center gap-2 hover:bg-surface-2 px-2 py-1.5 rounded-lg transition-colors group"
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-bg shrink-0"
              style={{ backgroundColor: profile.avatar_color || '#4ade80' }}
            >
              {(profile.full_name || 'U')[0].toUpperCase()}
            </div>
            <span className="text-sm text-gray-300 group-hover:text-gray-100 hidden sm:block">{profile.full_name}</span>
            <span className="text-xs text-muted capitalize hidden md:block">({profile.role})</span>
          </Link>
        )}
        <button
          onClick={handleSignOut}
          className="btn-ghost text-xs"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
