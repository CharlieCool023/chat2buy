import { useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { Clock, CreditCard, ReceiptText } from 'lucide-react'

interface Order {
  id: number
  customer_number: string
  items: Array<{ name: string; qty: number; unit_price: number }>
  total: number
  payment_status: string
  fulfillment: string
  address: string | null
  is_test: boolean
  created_at: string
}

interface OrdersData {
  orders: Order[]
}

function money(value = 0) {
  return `NGN ${Number(value).toLocaleString()}`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-red-50 text-red-700 border-red-200'
  }
  return <span className={`rounded-md border px-2 py-1 text-xs font-medium ${styles[status] || styles.pending}`}>{status}</span>
}

export default function Orders() {
  const { data, loading } = useApi<OrdersData>('/api/dashboard/orders')
  const orders = data?.orders || []

  const summary = useMemo(() => {
    const realOrders = orders.filter(order => !order.is_test)
    return {
      count: realOrders.length,
      paid: realOrders.filter(order => order.payment_status === 'paid').length,
      pending: realOrders.filter(order => order.payment_status === 'pending').length,
      value: realOrders.reduce((sum, order) => sum + Number(order.total || 0), 0)
    }
  }, [orders])

  if (loading) return <div className="h-96 animate-pulse rounded-lg bg-white" />

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Orders</h2>
        <p className="mt-1 text-sm text-slate-500">Monitor customer orders, payment status, and fulfillment details.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard title="Total orders" value={summary.count.toString()} icon={ReceiptText} />
        <SummaryCard title="Pending payment" value={summary.pending.toString()} icon={Clock} />
        <SummaryCard title="Order value" value={money(summary.value)} icon={CreditCard} />
      </div>

      {orders.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
            <ReceiptText className="h-7 w-7" />
          </div>
          <p className="mt-4 font-medium text-slate-950">No orders yet</p>
          <p className="mt-1 text-sm text-slate-500">Orders will appear here as customers buy through WhatsApp.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Order</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Items</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Fulfillment</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <div className="font-mono text-sm font-medium text-slate-950">#{order.id}</div>
                      {order.is_test && <span className="mt-1 inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">TEST</span>}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{order.customer_number}</td>
                    <td className="px-5 py-4">
                      <div className="max-w-xs text-sm text-slate-700">
                        {order.items?.map((item, i) => <span key={i} className="mr-2 inline-block">{item.qty}x {item.name}</span>) || 'N/A'}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      <div className="capitalize">{order.fulfillment}</div>
                      {order.address && <div className="max-w-xs truncate text-xs text-slate-400">{order.address}</div>}
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-950">{money(order.total)}</td>
                    <td className="px-5 py-4"><StatusBadge status={order.payment_status} /></td>
                    <td className="px-5 py-4 text-sm text-slate-500">{new Date(order.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ title, value, icon: Icon }: { title: string; value: string; icon: any }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        </div>
        <div className="rounded-md bg-slate-100 p-2 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}
