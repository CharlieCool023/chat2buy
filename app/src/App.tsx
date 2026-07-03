import { Routes, Route, Navigate } from 'react-router'
import { useState, useEffect, createContext, useContext } from 'react'
import DashboardLayout from './components/DashboardLayout'
import Overview from './pages/Overview'
import Catalog from './pages/Catalog'
import Pricing from './pages/Pricing'
import Orders from './pages/Orders'
import Setup from './pages/Setup'
import { LogIn, MessageCircle } from 'lucide-react'

// Auth context
interface Business {
  id: number
  name: string
  code: string
  status: string
}

interface AuthContextType {
  token: string | null
  business: Business | null
  setToken: (t: string | null) => void
}

export const AuthContext = createContext<AuthContextType>({
  token: null,
  business: null,
  setToken: () => {}
})

export function useAuth() {
  return useContext(AuthContext)
}

function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`/api/dashboard?token=${token}`)
      const data = await res.json()
      if (data.authenticated) {
        onLogin(token)
      } else {
        setError('Invalid setup token')
      }
    } catch {
      setError('Connection failed. Make sure the server is running.')
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-7">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-950 text-white">
            <MessageCircle className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Seller dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in with the setup token sent to your WhatsApp.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Setup token</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your setup token"
              className="input py-3"
            />
            <p className="mt-1 text-xs text-slate-500">Example: mkn001_token_hackathon2026</p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !token}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <LogIn className="h-4 w-4" />
            {loading ? 'Verifying...' : 'Enter dashboard'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('autopilot_token')
  })
  const [business, setBusiness] = useState<Business | null>(null)

  useEffect(() => {
    if (token) {
      localStorage.setItem('autopilot_token', token)
      // Fetch business info
      fetch(`/api/dashboard/business?token=${token}`)
        .then(r => r.json())
        .then(data => {
          if (data.business) setBusiness(data.business)
        })
        .catch(() => setBusiness(null))
    } else {
      localStorage.removeItem('autopilot_token')
    }
  }, [token])

  const handleLogin = (t: string) => {
    setToken(t)
  }

  return (
    <AuthContext.Provider value={{ token, business, setToken }}>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        {!token ? (
          <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
        ) : (
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<Overview />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </AuthContext.Provider>
  )
}
