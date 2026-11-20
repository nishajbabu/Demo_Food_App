// Switch services on/off for everyone, and manage villages.
import { useState } from 'react';
import { api } from '../api';
import { useAction, useData } from '../hooks';

const LABELS = { grocery: 'Daily needs (grocery)', milk: 'Milk & sabzi subscriptions', food: 'Food delivery', rides: 'Rides & share autos' };

export default function Settings({ user }) {
  const settings = useData('/admin/settings');
  const villages = useData('/admin/villages');
  const [run, busy] = useAction(async () => {
    await settings.reload();
    await villages.reload();
  });
  const [v, setV] = useState({ name: '', cluster: '' });
  const isAdmin = user.role === 'admin';
  const services = settings.data?.services || {};

  return (
    <>
      <h1>Settings</h1>
      <div className="card">
        <h2>Services in the customer app</h2>
        <span className="muted">Turn a service off and it shows as "Coming soon" in the app. No app update needed.</span>
        {Object.entries(LABELS).map(([key, label]) => (
          <label key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              style={{ width: 22, height: 22, minHeight: 0 }}
              checked={Boolean(services[key])}
              disabled={!isAdmin || busy}
              onChange={(e) => run(() => api('/admin/settings', { method: 'PATCH', body: { services: { [key]: e.target.checked } } }))}
            />
            {label}
          </label>
        ))}
      </div>

      <div className="card">
        <h2>Villages</h2>
        <div className="table">
          <table>
            <thead><tr><th>Village</th><th>Cluster</th><th>District</th></tr></thead>
            <tbody>
              {(villages.data || []).map((x) => (
                <tr key={x.id}><td>{x.name}</td><td>{x.cluster}</td><td>{x.district}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin ? (
          <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/admin/villages', { method: 'POST', body: v }); setV({ name: '', cluster: '' }); }); }}>
            <label>Name<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
            <label>Cluster<input value={v.cluster} onChange={(e) => setV({ ...v, cluster: e.target.value })} placeholder="Rampur cluster" required /></label>
            <button className="btn" disabled={busy} style={{ alignSelf: 'flex-end' }}>Add village</button>
          </form>
        ) : null}
      </div>
    </>
  );
}
