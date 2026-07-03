import { useState } from 'react'
import { useAuth } from '../App'
import { useApi, apiPost, apiDelete } from '../hooks/useApi'
import { ImageOff, Package, Plus, Trash2, X } from 'lucide-react'

interface CatalogItem {
  id: number
  name: string
  description: string
  category: string
  price: number
  image_url: string
  active: boolean
}

interface CatalogData {
  items: CatalogItem[]
}

export default function Catalog() {
  const { token } = useAuth()
  const { data, loading, refetch } = useApi<CatalogData>('/api/dashboard/catalog')
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', category: '', price: '', imageUrl: '' })

  const categories = [...new Set(data?.items?.map(i => i.category).filter(Boolean) || [])]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.price) return
    setSaving(true)
    await apiPost('/api/dashboard/catalog', token, {
      name: form.name,
      description: form.description,
      category: form.category || 'General',
      price: parseFloat(form.price),
      imageUrl: form.imageUrl
    })
    setForm({ name: '', description: '', category: '', price: '', imageUrl: '' })
    setShowAdd(false)
    await refetch()
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this product from the live catalog?')) return
    await apiDelete(`/api/dashboard/catalog/${id}`, token)
    refetch()
  }

  if (loading) return <div className="h-96 animate-pulse rounded-lg bg-white" />

  const items = data?.items || []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Catalog</h2>
          <p className="mt-1 text-sm text-slate-500">{items.length} active products available to customers</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showAdd ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showAdd ? 'Close' : 'Add product'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-950">New product</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name" required>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input" placeholder="Party Jollof Rice" />
            </Field>
            <Field label="Price (NGN)" required>
              <input required type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="input" placeholder="3500" />
            </Field>
            <Field label="Category">
              <input list="categories" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="input" placeholder="Rice Dishes" />
              <datalist id="categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Image URL">
              <input value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} className="input" placeholder="https://..." />
            </Field>
          </div>
          <Field label="Description" className="mt-4">
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input min-h-24" placeholder="Short customer-friendly description" />
          </Field>
          <div className="mt-5 flex gap-3">
            <button type="submit" disabled={saving} className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save product'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
          <PackageEmpty />
          <p className="mt-4 font-medium text-slate-950">No products yet</p>
          <p className="mt-1 text-sm text-slate-500">Add products so customers can browse and order on WhatsApp.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map(item => (
            <article key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex aspect-video items-center justify-center bg-slate-100">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <ImageOff className="h-8 w-8 text-slate-400" />
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-950">{item.name}</h3>
                    <p className="mt-1 font-medium text-slate-700">NGN {Number(item.price).toLocaleString()}</p>
                  </div>
                  <button onClick={() => handleDelete(item.id)} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove product">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-slate-500">{item.description || 'No description yet.'}</p>
                <span className="mt-3 inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{item.category || 'General'}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, required, children, className = '' }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}{required ? ' *' : ''}</span>
      {children}
    </label>
  )
}

function PackageEmpty() {
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
      <Package className="h-7 w-7" />
    </div>
  )
}
