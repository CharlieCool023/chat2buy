import { Outlet, NavLink, useLocation } from 'react-router'
import { useAuth } from '../App'
import { useState } from 'react'
import { BarChart3, BookOpen, LogOut, Menu, MessageCircle, Package, ReceiptText, Settings2, X } from 'lucide-react'

const navItems = [
  { path: '/', label: 'Overview', icon: BarChart3 },
  { path: '/catalog', label: 'Catalog', icon: Package },
  { path: '/pricing', label: 'Pricing', icon: Settings2 },
  { path: '/orders', label: 'Orders', icon: ReceiptText },
]

export default function DashboardLayout() {
  const { business, setToken } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const currentPage = navItems.find(n => n.path === location.pathname)?.label || 'Dashboard'

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      {sidebarOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">WhatsApp Autopilot</p>
            <p className="truncate text-xs text-slate-500">{business?.name || 'Seller dashboard'}</p>
          </div>
          <button
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(item => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-950 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <BookOpen className="h-3.5 w-3.5" />
              Seller code
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-wider text-slate-950">{business?.code || '---'}</p>
            <p className="mt-1 text-xs text-slate-500">Customers use this code to enter your store.</p>
          </div>
          <button
            onClick={() => setToken(null)}
            className="mt-4 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-950"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-base font-semibold text-slate-950">{currentPage}</h1>
              <p className="hidden text-xs text-slate-500 sm:block">{business?.status === 'live' ? 'Store is live' : 'Setup in progress'}</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 sm:flex">
            <span className={`h-2 w-2 rounded-full ${business?.status === 'live' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {business?.status || 'unknown'}
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
