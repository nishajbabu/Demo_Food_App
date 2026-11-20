// Riders and drivers: who is online, cash each rider holds, add new partners, block.
import { useState } from 'react';
import { api, money, time } from '../api';
import { useAction, useData } from '../hooks';

export default function Partners({ user }) {
  const list = useData('/admin/partners', 15000);
  const villages = useData('/admin/villages');
  const [run, busy] = useAction(list.reload);
  const [f, setF] = useState({ name: '', phone: '', role: 'rider', villageId: '', vehicleType: 'bike', vehicleNo: '' });
  const isAdmin = user.role === 'admin';

  return (
    <>
      <h1>Riders & drivers</h1>
      {list.error ? <div className="error">{list.error.message}</div> : null}
      <div className="card">
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role · vehicle</th>
                <th>Village</th>
                <th>Online</th>
                <th>Cash in hand</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(list.data || []).map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><br /><span className="muted">{p.phone}</span></td>
                  <td>{p.role} · {p.vehicleType} {p.vehicleNo}</td>
                  <td>{p.villageName}</td>
                  <td>
                    {p.isActive ? <span className={`tag ${p.online ? 'green' : 'grey'}`}>{p.online ? 'Online' : 'Offline'}</span> : <span className="tag red">Blocked</span>}
                    <br /><span className="muted">{time(p.lastSeen)}</span>
                  </td>
                  <td>{p.role === 'rider' ? money(p.cashInHandPaise) : '—'}</td>
                  <td className="row">
                    {p.role === 'rider' && p.cashInHandPaise > 0 ? (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          const rupees = prompt(`Cash received from ${p.name} (₹)?`, String(p.cashInHandPaise / 100));
                          if (rupees) run(() => api(`/admin/cash/${p.id}/settle`, { method: 'POST', body: { amountPaise: Math.round(parseFloat(rupees) * 100) } }));
                        }}
                      >
                        Cash received
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button className="btn outline" disabled={busy} onClick={() => run(() => api(`/admin/users/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } }))}>
                        {p.isActive ? 'Block' : 'Unblock'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/admin/partners', { method: 'POST', body: { ...f, villageId: Number(f.villageId), vehicleNo: f.vehicleNo || undefined, vehicleType: f.role === 'support' ? undefined : f.vehicleType } });
              setF({ name: '', phone: '', role: 'rider', villageId: '', vehicleType: 'bike', vehicleNo: '' });
            });
          }}
        >
          <h2>Add a rider, driver or support person</h2>
          <div className="grid">
            <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
            <label>Mobile<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={10} required /></label>
            <label>Role
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, vehicleType: e.target.value === 'rider' ? 'bike' : 'auto' })}>
                <option value="rider">Delivery rider</option>
                <option value="driver">Driver</option>
                <option value="support">Support staff</option>
              </select>
            </label>
            <label>Village
              <select value={f.villageId} onChange={(e) => setF({ ...f, villageId: e.target.value })} required>
                <option value="">Choose…</option>
                {(villages.data || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            {f.role !== 'support' ? (
              <>
                <label>Vehicle
                  <select value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value })}>
                    <option value="bike">Bike</option>
                    <option value="auto">Auto</option>
                    <option value="erick">E-rickshaw</option>
                    <option value="cab">Cab</option>
                  </select>
                </label>
                <label>Vehicle number<input value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} /></label>
              </>
            ) : null}
          </div>
          <button className="btn" disabled={busy}>Add</button>
          <span className="muted">Check driving licence, RC, insurance and police verification before adding a driver.</span>
        </form>
      ) : null}
    </>
  );
}
