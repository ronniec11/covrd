import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'squeegee_theme'

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}
  // Matches the inline script in index.html, which already applied this
  // as the 'dark' class on <html> before React mounted — this just keeps
  // React's state in sync with what's already on screen.
  return 'dark'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  function setTheme(t) { setThemeState(t === 'light' ? 'light' : 'dark') }
  function toggleTheme() { setThemeState(t => (t === 'dark' ? 'light' : 'dark')) }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
