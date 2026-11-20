// Live orders: filter, open one, assign a rider, cancel, refund.
import { useState } from 'react';
import { api, money, time } from '../api';
import { useAction, useData } from '../hooks';
import { STATUS_TAG } from '../status';


export default function Orders() {
  const [status, setStatus] = useState('active');
  const [service, setService] = useState('');
  const [openId, setOpenId] = useState(null);
  const list = useData(`/admin/orders?status=${status}${service ? `&service=${service}` : ''}`, 10000);

  return (
    <>
      <h1>Orders</h1>
      <div className="row">
        {['active', 'delivered', 'cancelled', 'all'].map((s) => (
          <button key={s} className={`pill ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
            {s}
          </button>
        ))}
        <select value={service} onChange={(e) => setService(e.target.value)} aria-label="Service">
          <option value="">All services</option>
          <option value="grocery">Grocery</option>
          <option value="food">Food</option>
        </select>
      </div>
      {list.error ? <div className="error">{list.error.message}</div> : null}
      <div className="cols">
        <div className="card wide">
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer · village</th>
                  <th>Shop</th>
                  <th>Rider</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {(list.data || []).map((o) => {
                  const old = ['placed', 'accepted', 'ready', 'picked_up'].includes(o.status) && Date.now() - new Date(o.createdAt) > 45 * 60000;
                  const [cls, label] = STATUS_TAG[o.status];
                  return (
                    <tr key={o.id} className="click" onClick={() => setOpenId(o.id)}>
                      <td><b>{o.code}</b><br /><span className="muted">{o.service}</span></td>
                      <td>{o.customerName || o.customerPhone}<br /><span className="muted">{o.villageName}</span></td>
                      <td>{o.merchantName}</td>
                      <td>{o.riderName || <span className="tag amber">None yet</span>}</td>
                      <td><span className={`tag ${old ? 'red' : cls}`}>{old ? 'Delayed' : label}</span></td>
                      <td>{o.paymentMethod === 'cod' ? 'Cash' : 'UPI'} {money(o.totalPaise)}</td>
                      <td>{time(o.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.data && !list.data.length ? <p className="muted">No orders here.</p> : null}
          </div>
        </div>
        {openId ? <OrderPanel id={openId} onChange={list.reload} onClose={() => setOpenId(null)} /> : null}
      </div>
    </>
  );
}

function OrderPanel({ id, onChange, onClose }) {
  const o = useData(`/admin/orders/${id}`);
  const riders = useData('/admin/partners?role=rider');
  const [run, busy] = useAction(async () => {
    await o.reload();
    await onChange();
  });
  const [riderId, setRiderId] = useState('');
  const d = o.data;
  if (!d) return <div className="card narrow">Loading…</div>;
  const live = ['placed', 'accepted', 'ready', 'picked_up'].includes(d.status);

  return (
    <div className="card narrow">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{d.code}</h2>
        <button className="btn outline" onClick={onClose}>Close</button>
      </div>
      <span className={`tag ${STATUS_TAG[d.status][0]}`}>{STATUS_TAG[d.status][1]}</span>
      <div>
        {d.items.map((i) => (
          <div key={i.id}>
            {i.qty} × {i.name} — {money(i.pricePaise * i.qty)}
          </div>
        ))}
        <b>Total {money(d.totalPaise)}</b> · {d.paymentMethod} · {d.paymentStatus}
      </div>
      <div className="muted">
        Customer: {d.customerName} {d.customerPhone}<br />
        Address: {d.villageName}, {d.addressText}<br />
        Shop: {d.merchantName} {d.merchantPhone}<br />
        Rider: {d.riderName ? `${d.riderName} ${d.riderPhone}` : 'not assigned'} · pickup code {d.pickupCode}
      </div>
      <div>
        <b>Timeline</b>
        {d.events.map((e, i) => (
          <div key={i} className="muted">
            {time(e.createdAt)} · {e.status} {e.note ? `· ${e.note}` : ''}
          </div>
        ))}
      </div>
      {live && !['picked_up'].includes(d.status) ? (
        <div className="row">
          <select value={riderId} onChange={(e) => setRiderId(e.target.value)} aria-label="Rider">
            <option value="">Choose rider…</option>
            {(riders.data || []).filter((r) => r.isActive).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.online ? '(online)' : ''}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!riderId || busy} onClick={() => run(() => api(`/admin/orders/${d.id}/assign`, { method: 'POST', body: { riderId: Number(riderId) } }))}>
            Assign
          </button>
        </div>
      ) : null}
      {live ? (
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => {
            const reason = prompt('Reason for cancelling?');
            if (reason) run(() => api(`/admin/orders/${d.id}/cancel`, { method: 'POST', body: { reason } }));
          }}
        >
          Cancel order
        </button>
      ) : null}
      <button
        className="btn outline"
        disabled={busy}
        onClick={() => {
          const rupees = prompt('Refund amount in rupees?');
          const reason = rupees && prompt('Reason?');
          if (rupees && reason) run(() => api(`/admin/orders/${d.id}/refund`, { method: 'POST', body: { amountPaise: Math.round(parseFloat(rupees) * 100), reason } }));
        }}
      >
        Record refund
      </button>
      {d.refunds.map((r) => (
        <div key={r.id} className="muted">
          Refund {money(r.amountPaise)} · {r.reason} · {r.status}
        </div>
      ))}
    </div>
  );
}
