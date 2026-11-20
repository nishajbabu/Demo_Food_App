// Support console: ticket queue, conversation, order/ride details, quick actions.
import { useState } from 'react';
import { api, money, time } from '../api';
import { useAction, useData } from '../hooks';
import { STATUS_TAG } from '../status';

const PRIO = { high: 'red', medium: 'amber', low: 'grey' };

export default function Support() {
  const [status, setStatus] = useState('open');
  const [sel, setSel] = useState(null);
  const queue = useData(`/admin/tickets?status=${status}`, 15000);
  const [showNew, setShowNew] = useState(false);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Support</h1>
        <button className="btn" onClick={() => setShowNew((s) => !s)}>Log a phone / WhatsApp complaint</button>
      </div>
      {showNew ? <NewTicket onDone={() => { setShowNew(false); queue.reload(); }} /> : null}
      <div className="row">
        {['open', 'resolved', 'all'].map((s) => (
          <button key={s} className={`pill ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {queue.error ? <div className="error">{queue.error.message}</div> : null}
      <div className="cols">
        <div className="narrow" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(queue.data || []).map((t) => (
            <div key={t.id} className="card" style={{ cursor: 'pointer', border: sel === t.id ? '2px solid var(--green)' : '2px solid transparent' }} onClick={() => setSel(t.id)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">#{t.id} · {time(t.createdAt)}</span>
                <span className={`tag ${t.status === 'resolved' ? 'green' : PRIO[t.priority]}`}>{t.status === 'resolved' ? 'resolved' : t.priority}</span>
              </div>
              <b>{t.subject}</b>
              <span className="muted">{t.userName || t.userPhone} · {t.userRole} · {t.channel}</span>
            </div>
          ))}
          {queue.data && !queue.data.length ? <p className="muted">Nothing here.</p> : null}
        </div>
        {sel ? <Ticket id={sel} onChange={queue.reload} /> : <div className="card wide muted">Choose a ticket.</div>}
      </div>
    </>
  );
}

function Ticket({ id, onChange }) {
  const t = useData(`/admin/tickets/${id}`, 10000);
  const [reply, setReply] = useState('');
  const [run, busy] = useAction(async () => {
    await t.reload();
    await onChange();
  });
  const d = t.data;
  if (!d) return <div className="card wide">Loading…</div>;

  return (
    <div className="wide" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card">
        <span className="muted">#{d.id} · {d.channel} · {d.category}</span>
        <h2>{d.subject}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#f7f8f6', padding: 12, borderRadius: 12 }}>
          {d.messages.map((m) => (
            <div key={m.id} className={`msg ${m.isStaff ? 'staff' : ''}`}>
              <div className="muted">{m.authorName} · {time(m.createdAt)}</div>
              {m.body}
            </div>
          ))}
        </div>
        <label>
          Reply (the customer sees it in the app)
          <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
        </label>
        <div className="row">
          {['Sorry for the trouble. We are checking now.', 'We have sent a replacement today.', 'Your refund has been recorded.'].map((q) => (
            <button key={q} className="pill" onClick={() => setReply(q)}>{q}</button>
          ))}
        </div>
        <div className="row">
          <button className="btn" disabled={!reply || busy} onClick={() => run(async () => { await api(`/admin/tickets/${d.id}/messages`, { method: 'POST', body: { message: reply } }); setReply(''); })}>Send reply</button>
          {d.status === 'open' ? (
            <button className="btn outline" disabled={busy} onClick={() => run(() => api(`/admin/tickets/${d.id}/resolve`, { method: 'POST' }))}>Mark resolved</button>
          ) : (
            <button className="btn outline" disabled={busy} onClick={() => run(() => api(`/admin/tickets/${d.id}/reopen`, { method: 'POST' }))}>Reopen</button>
          )}
        </div>
      </div>
      <div className="card">
        <h2>Details</h2>
        <div><b>{d.userName || 'No name'}</b> · {d.userPhone} · {d.userRole}</div>
        <div className="muted">{d.userVillage} {d.userLandmark ? `· ${d.userLandmark}` : ''}</div>
        {d.order ? (
          <div>
            Order <b>{d.order.code}</b> · {d.order.merchantName} · {money(d.order.totalPaise)} ·{' '}
            <span className={`tag ${STATUS_TAG[d.order.status][0]}`}>{STATUS_TAG[d.order.status][1]}</span>
            <div className="muted">Rider: {d.order.riderName ? `${d.order.riderName} ${d.order.riderPhone}` : 'none'} · Shop: {d.order.merchantPhone}</div>
          </div>
        ) : null}
        {d.ride ? (
          <div>
            Ride #{d.ride.id} · {d.ride.pickupName} → {d.ride.dropName} · {money(d.ride.farePaise)} · {d.ride.status}
            <div className="muted">Driver: {d.ride.driverName ? `${d.ride.driverName} ${d.ride.driverPhone}` : 'none'}</div>
          </div>
        ) : null}
        {d.history.length ? (
          <div className="muted">Earlier tickets: {d.history.map((h) => `#${h.id} ${h.subject} (${h.status})`).join(', ')}</div>
        ) : null}
        <div className="row">
          <a className="btn outline" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} href={`tel:${d.userPhone}`}>Call {d.userName || 'customer'}</a>
        </div>
      </div>
    </div>
  );
}

function NewTicket({ onDone }) {
  const [f, setF] = useState({ phone: '', subject: '', category: 'order', channel: 'phone', priority: 'medium', message: '' });
  const [run, busy] = useAction(onDone);
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); run(() => api('/admin/tickets', { method: 'POST', body: f })); }}>
      <div className="grid">
        <label>Customer mobile<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={10} required /></label>
        <label>Subject<input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required /></label>
        <label>Category
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {['order', 'subscription', 'ride', 'payment', 'partner', 'safety', 'other'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Came by
          <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
            <option value="phone">Phone call</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label>Priority
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>
      <label>What did they say?<textarea rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required /></label>
      <button className="btn" disabled={busy}>Create ticket</button>
    </form>
  );
}
