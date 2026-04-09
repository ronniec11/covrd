import Navbar from './Navbar'

export default function Layout({ children, fullHeight = false }) {
  return (
    <div className="flex flex-col h-screen bg-bg">
      <Navbar />
      <main className={`flex-1 overflow-auto ${fullHeight ? 'flex flex-col' : ''}`}>
        {children}
      </main>
    </div>
  )
}
