import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { apiPost } from '../hooks/useApi'

const categories = [
  'Food',
  'Tailoring',
  'Fashion retail',
  'Shoes and bags',
  'Electronics',
  'Beauty',
  'Professional services',
  'Home goods',
  'Auto parts',
  'Health and wellness',
  'Events and rentals',
  'General'
]
const pricingOptions = ['Strict', 'Moderate', 'Flexible']

interface Business {
  id: number
  name: string
  code: string
  status: string
  category?: string
}

interface SetupForm {
  business_name: string
  description: string
  category: string
  pricing_flexibility: string
  first_item_name: string
  first_item_price: string
  first_item_description: string
  first_item_category: string
}

export default function Setup() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [validating, setValidating] = useState(true)
  const [valid, setValid] = useState(false)
  const [business, setBusiness] = useState<Business | null>(null)
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [form, setForm] = useState<SetupForm>({
    business_name: '',
    description: '',
    category: 'Food',
    pricing_flexibility: 'Moderate',
    first_item_name: '',
    first_item_price: '',
    first_item_description: '',
    first_item_category: 'Food'
  })

  useEffect(() => {
    if (!token) {
      setValidating(false)
      return
    }

    fetch(`/api/dashboard/business?token=${token}`)
      .then(r => r.json())
      .then(data => {
        const validToken = !!data?.business
        setValid(validToken)
        if (validToken) {
          setBusiness(data.business)
          setForm(prev => ({
            ...prev,
            business_name: data.business.name || prev.business_name,
            category: data.business.category || prev.category
          }))
        }
      })
      .catch(() => setValid(false))
      .finally(() => setValidating(false))
  }, [token])

  const updateField = (field: keyof SetupForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return

    setError('')
    setSubmitting(true)

    try {
      const response = await apiPost('/api/dashboard/setup/complete', token, {
        business_name: form.business_name,
        description: form.description,
        category: form.category,
        pricing_flexibility: form.pricing_flexibility,
        first_item_name: form.first_item_name,
        first_item_price: form.first_item_price,
        first_item_description: form.first_item_description,
        first_item_category: form.first_item_category
      })

      if (response.error) {
        throw new Error(response.error)
      }

      setCompleted(true)
      setBusiness(response.business || business)
    } catch (err: any) {
      setError(err.message || 'Could not complete setup. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-500 rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-gray-500">Validating link...</p>
        </div>
      </div>
    )
  }

  if (!token || !valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center px-6 py-8 rounded-3xl border border-slate-200 bg-white shadow-sm max-w-md">
          <div className="mb-4 rounded-full bg-red-100 p-4 text-red-600 inline-flex">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Invalid setup link</h1>
          <p className="mt-3 text-slate-600">This setup link is expired or not valid.</p>
          <p className="mt-2 text-sm text-slate-500">Open WhatsApp and type <span className="font-semibold">SETUP</span> to request a new dashboard link.</p>
        </div>
      </div>
    )
  }

  if (completed || business?.status === 'live') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-sky-100 flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="flex items-center gap-3 rounded-3xl bg-emerald-500 p-4 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-600">OK</div>
            <div>
              <h1 className="text-xl font-semibold">Your store is ready</h1>
              <p className="text-sm opacity-90">{business?.name} is live and the WhatsApp bot can now welcome customers.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Seller code</p>
              <p className="mt-3 text-3xl font-semibold text-slate-950 tracking-wider">{business?.code}</p>
              <p className="mt-2 text-sm text-slate-600">Share this with shoppers so they can start buying from your store.</p>
            </div>

            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
              <p className="text-sm font-semibold text-emerald-700">Next step</p>
              <p className="mt-2 text-slate-700">Go back to WhatsApp and say <span className="font-semibold">hi</span>. The AI will welcome you back and ask you to try a message to test the chat flow.</p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-sm text-slate-600">To continue managing your store, open the dashboard login and paste your setup token.</p>
              <div className="mt-3 rounded-2xl bg-slate-100 p-3 font-mono text-sm text-slate-900">{token}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 to-indigo-100 p-4">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Seller onboarding</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">Create your store the right way</h1>
              <p className="mt-3 max-w-2xl text-slate-600">Complete the guided setup so your WhatsApp AI assistant knows your business, menu, and pricing style.</p>
            </div>
            <div className="rounded-3xl bg-slate-950 px-4 py-3 text-white">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-300">Step</p>
              <p className="mt-2 text-3xl font-semibold">{step}/4</p>
            </div>
          </div>

          <div className="mt-8 grid gap-6">
            <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="rounded-2xl bg-sky-500 p-3 text-white">1</div>
              <div>
                <p className="font-semibold text-slate-950">Tell us who you are</p>
                <p className="text-sm text-slate-600">Business name, category, and what you sell.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="rounded-2xl bg-emerald-500 p-3 text-white">2</div>
              <div>
                <p className="font-semibold text-slate-950">Choose your pricing style</p>
                <p className="text-sm text-slate-600">Strict, moderate, or flexible for discounts and recommendations.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="rounded-2xl bg-amber-500 p-3 text-white">3</div>
              <div>
                <p className="font-semibold text-slate-950">Add your first item</p>
                <p className="text-sm text-slate-600">A product customers can order immediately after setup.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="rounded-2xl bg-indigo-500 p-3 text-white">4</div>
              <div>
                <p className="font-semibold text-slate-950">Launch your store</p>
                <p className="text-sm text-slate-600">Finish setup and return to WhatsApp to test your chatbot.</p>
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold text-slate-500">Onboarding token</p>
              <p className="mt-2 text-sm text-slate-700">Use the token from WhatsApp to connect this dashboard with your store.</p>
              <div className="mt-3 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-900 font-mono">{token}</div>
            </div>

            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <label className="text-sm font-medium text-slate-700">Business name</label>
                  <input
                    value={form.business_name}
                    onChange={e => updateField('business_name', e.target.value)}
                    placeholder="Example: Lagos Food House"
                    className="input mt-2 w-full"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">What do you sell?</label>
                  <input
                    value={form.description}
                    onChange={e => updateField('description', e.target.value)}
                    placeholder="Example: jollof rice, suya, and drinks"
                    className="input mt-2 w-full"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Category</label>
                  <select
                    value={form.category}
                    onChange={e => updateField('category', e.target.value)}
                    className="input mt-2 w-full"
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <p className="text-sm text-slate-600">Pricing flexibility influences how the AI proposes discounts and negotiates with buyers.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {pricingOptions.map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => updateField('pricing_flexibility', option)}
                      className={`rounded-3xl border p-4 text-left transition ${form.pricing_flexibility === option ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-900'}`}
                    >
                      <p className="font-semibold">{option}</p>
                      <p className="mt-1 text-sm text-slate-500">{option === 'Strict' ? 'Tighter prices, smaller discounts.' : option === 'Moderate' ? 'Balanced deals for customers.' : 'Very flexible when closing sales.'}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <p className="text-sm text-slate-600">Add one featured item so customers can order right away.</p>
                <div>
                  <label className="text-sm font-medium text-slate-700">Item name</label>
                  <input
                    value={form.first_item_name}
                    onChange={e => updateField('first_item_name', e.target.value)}
                    placeholder="Example: Jollof Rice"
                    className="input mt-2 w-full"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Price (NGN)</label>
                  <input
                    value={form.first_item_price}
                    onChange={e => updateField('first_item_price', e.target.value)}
                    placeholder="Example: 2500"
                    type="number"
                    className="input mt-2 w-full"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Item description</label>
                  <input
                    value={form.first_item_description}
                    onChange={e => updateField('first_item_description', e.target.value)}
                    placeholder="Example: tasty jollof with chicken."
                    className="input mt-2 w-full"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Item category</label>
                  <select
                    value={form.first_item_category}
                    onChange={e => updateField('first_item_category', e.target.value)}
                    className="input mt-2 w-full"
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-sm font-medium text-slate-700">Review your store</p>
                  <div className="mt-4 space-y-3 text-slate-700">
                    <p><span className="font-semibold">Name:</span> {form.business_name}</p>
                    <p><span className="font-semibold">Description:</span> {form.description}</p>
                    <p><span className="font-semibold">Category:</span> {form.category}</p>
                    <p><span className="font-semibold">Pricing flexibility:</span> {form.pricing_flexibility}</p>
                    <p><span className="font-semibold">First item:</span> {form.first_item_name ? `${form.first_item_name} - NGN ${form.first_item_price}` : 'None yet'}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600">When you finish, your store will go live and the AI will welcome customers naturally on WhatsApp.</p>
              </div>
            )}

            {error && (
              <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                {step > 1 && (
                  <button
                    type="button"
                    onClick={() => setStep(step - 1)}
                    className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Back
                  </button>
                )}
                {step < 4 && (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    Continue
                  </button>
                )}
              </div>
              {step === 4 && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {submitting ? 'Finishing setup...' : 'Complete onboarding'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
