import { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { useApi, apiPut } from '../hooks/useApi'
import { CheckCircle2, Info, Percent, Save, Truck } from 'lucide-react'

interface Policy {
  bulk_min_qty: number
  bulk_discount_pct: number
  max_discount_pct_no_bulk: number
  delivery_fee: number
  pickup_available: boolean
  notes: string
}

interface PolicyData {
  policy: Policy
}

export default function Pricing() {
  const { token } = useAuth()
  const { data, loading, refetch } = useApi<PolicyData>('/api/dashboard/policy')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [policy, setPolicy] = useState<Policy>({
    bulk_min_qty: 20,
    bulk_discount_pct: 5,
    max_discount_pct_no_bulk: 2,
    delivery_fee: 1500,
    pickup_available: true,
    notes: ''
  })

  useEffect(() => {
    if (data?.policy) setPolicy(data.policy)
  }, [data])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    await apiPut('/api/dashboard/policy', token, {
      bulk_min_qty: policy.bulk_min_qty,
      bulk_discount_pct: policy.bulk_discount_pct,
      max_discount_pct: policy.max_discount_pct_no_bulk,
      delivery_fee: policy.delivery_fee,
      pickup_available: policy.pickup_available,
      notes: policy.notes
    })
    await refetch()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="h-96 animate-pulse rounded-lg bg-white" />

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Pricing</h2>
        <p className="mt-1 text-sm text-slate-500">Control discounts, delivery fees, and when the assistant escalates to you.</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-slate-100 p-2 text-slate-700">
            <Percent className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-950">Negotiation rules</h3>
            <p className="text-sm text-slate-500">The assistant can approve discounts inside these limits.</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Bulk minimum quantity" hint="Minimum items before bulk pricing applies.">
            <input type="number" min={1} value={policy.bulk_min_qty} onChange={e => setPolicy({ ...policy, bulk_min_qty: parseInt(e.target.value) || 0 })} className="input" />
          </Field>
          <Field label="Bulk discount %" hint="Maximum discount for bulk orders.">
            <input type="number" min={0} max={100} value={policy.bulk_discount_pct} onChange={e => setPolicy({ ...policy, bulk_discount_pct: parseFloat(e.target.value) || 0 })} className="input" />
          </Field>
          <Field label="Regular discount %" hint="Maximum discount before bulk quantity is reached.">
            <input type="number" min={0} max={100} value={policy.max_discount_pct_no_bulk} onChange={e => setPolicy({ ...policy, max_discount_pct_no_bulk: parseFloat(e.target.value) || 0 })} className="input" />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-slate-100 p-2 text-slate-700">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-950">Fulfillment</h3>
            <p className="text-sm text-slate-500">Set how pickup and delivery are quoted to customers.</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Delivery fee (NGN)">
            <input type="number" min={0} value={policy.delivery_fee} onChange={e => setPolicy({ ...policy, delivery_fee: parseFloat(e.target.value) || 0 })} className="input" />
          </Field>
          <label className="flex min-h-20 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4">
            <div>
              <p className="text-sm font-medium text-slate-950">Pickup available</p>
              <p className="text-xs text-slate-500">Customers can choose pickup with no delivery fee.</p>
            </div>
            <input type="checkbox" checked={policy.pickup_available} onChange={e => setPolicy({ ...policy, pickup_available: e.target.checked })} className="h-5 w-5 rounded border-slate-300 text-slate-950 focus:ring-slate-300" />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <Field label="Policy notes" hint="Mention exceptions, free-delivery thresholds, or products that should not be discounted.">
          <textarea value={policy.notes} onChange={e => setPolicy({ ...policy, notes: e.target.value })} className="input min-h-28" placeholder="Free delivery on orders above NGN 50,000. Bulk discount applies to rice and soup combos only." />
        </Field>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Saved
            </span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <InfoCard title="Auto approval" text="Discounts inside the limits are handled immediately so customers do not wait." />
        <InfoCard title="Escalation" text="Requests far above your policy are sent to your WhatsApp for approval." />
        <InfoCard title="Natural selling" text="Customers can bargain normally; the code still protects your pricing rules." />
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
        <Info className="h-4 w-4 text-slate-500" />
        {title}
      </div>
      <p className="mt-2 text-sm text-slate-500">{text}</p>
    </div>
  )
}
