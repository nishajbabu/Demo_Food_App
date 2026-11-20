// Today at a glance; refreshes every 15 seconds.
import { money } from '../api';
import { useData } from '../hooks';

export default function Overview({ go }) {
  const { data: s, error } = useData('/admin/stats', 15000);
  if (error) return <div className="error">{error.message}</div>;
  if (!s) return <p className="muted">Loading…</p>;
  const food = s.orders.find((o) => o.service === 'food') || {};
  const grocery = s.orders.find((o) => o.service === 'grocery') || {};
  const gmv = s.orders.reduce((sum, o) => sum + o.gmvPaise, 0);

  return (
    <>
      <div>
        <h1>Today</h1>
        <span className="muted">{s.date} · refreshes every 15 seconds</span>
      </div>
      <div className="grid">
        <Kpi label="Food orders" value={food.total || 0} sub={`${food.delivered || 0} delivered · ${food.inProgress || 0} in progress`} />
        <Kpi label="Grocery orders" value={grocery.total || 0} sub={`${grocery.delivered || 0} delivered · ${grocery.inProgress || 0} in progress`} />
        <Kpi label="Milk deliveries" value={s.milk.total} sub={`${s.milk.delivered} ticked delivered`} />
        <Kpi label="Rides" value={s.rides.total} sub={`${s.rides.completed} completed · ${s.rides.shareSeats} share seats`} />
        <Kpi label="Delivered value" value={money(gmv)} sub="Food + grocery" />
        <Kpi label="Partners online" value={(s.partnersOnline.rider || 0) + (s.partnersOnline.driver || 0)} sub={`${s.partnersOnline.rider || 0} riders · ${s.partnersOnline.driver || 0} drivers`} />
      </div>
      <div className="cols">
        <div className="card narrow">
          <h2>Needs attention</h2>
          {s.delayedOrders ? (
            <div className="tag red" onClick={() => go('orders')} style={{ cursor: 'pointer' }}>
              {s.delayedOrders} order(s) older than 45 min
            </div>
          ) : (
            <span className="tag green">No delayed orders</span>
          )}
          {s.tickets.open ? (
            <div className="tag amber" onClick={() => go('support')} style={{ cursor: 'pointer' }}>
              {s.tickets.open} open ticket(s), {s.tickets.urgent} urgent
            </div>
          ) : null}
          {s.pendingMerchants ? (
            <div className="tag blue" onClick={() => go('merchants')} style={{ cursor: 'pointer' }}>
              {s.pendingMerchants} shop(s) waiting for approval
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="card kpi">
      <span className="muted">{label}</span>
      <span className="value">{value}</span>
      <span className="muted">{sub}</span>
    </div>
  );
}
