import { Link } from 'react-router'
import { useAuth } from '../App'
import { useApi } from '../hooks/useApi'
import { ArrowRight, Banknote, Clock, Package, ReceiptText, ShoppingBag, TrendingUp } from 'lucide-react'

interface StatsData {
  business: { name: string; code: string; status: string }
  stats: {
    total_orders: number
    pending_payment: number
    paid_orders: number
    total_revenue: number
    pending_value: number
    average_order_value: number
    catalog_size: number
    today_orders: number
    today_revenue: number
    week_orders: number
    week_revenue: number
  }
}

function money(value = 0) {
  return `NGN ${Number(value).toLocaleString()}`
}

function StatCard({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: any }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        </div>
        <div className="rounded-md bg-slate-100 p-2 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{detail}</p>
    </div>
  )
}

export default function Overview() {
  const { business } = useAuth()
  const { data, loading } = useApi<StatsData>('/api/dashboard/stats')
  const stats = data?.stats

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-lg bg-white" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 animate-pulse rounded-lg bg-white" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Store command center</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{business?.name || 'Your store'}</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Track orders, keep your catalog ready, and tune how the WhatsApp assistant sells for you.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <Link to="/catalog" className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              <Package className="h-4 w-4" />
              Catalog
            </Link>
            <Link to="/orders" className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Orders
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Revenue" value={money(stats.total_revenue)} detail={`${money(stats.week_revenue)} this week`} icon={Banknote} />
            <StatCard title="Orders" value={stats.total_orders.toString()} detail={`${stats.today_orders} today, ${stats.week_orders} this week`} icon={ReceiptText} />
            <StatCard title="Pending Payment" value={stats.pending_payment.toString()} detail={`${money(stats.pending_value)} awaiting payment`} icon={Clock} />
            <StatCard title="Catalog Items" value={stats.catalog_size.toString()} detail={`${stats.paid_orders} paid orders all time`} icon={ShoppingBag} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-950">Performance</h3>
                  <p className="text-sm text-slate-500">Useful numbers for day-to-day decisions.</p>
                </div>
                <TrendingUp className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Average order</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{money(stats.average_order_value)}</p>
                </div>
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Today revenue</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{money(stats.today_revenue)}</p>
                </div>
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Conversion signal</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{stats.total_orders ? Math.round((stats.paid_orders / stats.total_orders) * 100) : 0}% paid</p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="font-semibold text-slate-950">WhatsApp control</h3>
              <p className="mt-2 text-sm text-slate-600">
                As the seller, message your bot with natural requests like "orders today" or "how is business going?".
              </p>
              <div className="mt-4 rounded-md bg-slate-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Seller code</p>
                <p className="mt-2 font-mono text-xl font-semibold tracking-wider text-slate-950">{business?.code}</p>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
