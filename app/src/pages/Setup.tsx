import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router'

interface Business {
  id: number
  name: string
  code: string
  status: string
}

export default function Setup() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [validating, setValidating] = useState(true)
  const [valid, setValid] = useState(false)
  const [business, setBusiness] = useState<Business | null>(null)

  useEffect(() => {
    if (!token) {
      setValidating(false)
      return
    }
    // Validate token first
    fetch(`/api/dashboard/setup?token=${token}`)
      .then(r => r.json())
      .then(data => {
        setValid(data.valid)
        if (data.valid && data.business) {
          setBusiness(data.business)
          // Also fetch full business details including code
          return fetch(`/api/dashboard/business?token=${token}`)
            .then(r => r.json())
            .then(bizData => {
              if (bizData.business) {
                setBusiness(bizData.business)
              }
            })
        }
      })
      .catch(() => {})
      .finally(() => setValidating(false))
  }, [token])

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-500 rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-gray-500">Validating...</p>
        </div>
      </div>
    )
  }

  if (!token || !valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font HOT-dashed text-gray-900">Invalid Link</h1>
          <p className="text-gray-500 mt-2">This setup link is invalid or has expired.</p>
          <p className="text-gray-400 text-sm mt-1">Go back to WhatsApp and type *SETUP* to get a new link.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
        <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Setup Complete!</h1>
        <p className="text-gray-500 mt-2">
          {business?.name} is ready to accept orders.
        </p>
        <div className="mt-6 bg-emerald-50 rounded-lg p-4">
          <p className="text-sm text-emerald-600 font-medium">Your Seller Code</p>
          <p className="text-2xl font-bold text-emerald-700 tracking-wider mt-1">
            {business?.code || 'Loading...'}
          </p>
          <p className="text-xs text-emerald-500 mt-2">Share this with your customers!</p>
        </div>
        <div className="mt-4 bg-blue-50 rounded-lg p-4">
          <p className="text-sm text-blue-600 font-medium">Test Your Bot</p>
          <p className="text-sm text-blue-800 mt-1">
            Go back to WhatsApp and type <span className="font-bold">TEST</span> to try your bot as a customer.
          </p>
        </div>
        <p className="text-gray-400 text-sm mt-4">
          Want to manage your store? Use your token: <span className="font-mono bg-gray-100 px-2 py-1 rounded text-xs">{token}</span>
        </p>
      </div>
    </div>
  )
}
