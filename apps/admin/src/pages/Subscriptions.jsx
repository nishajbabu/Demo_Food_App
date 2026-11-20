// Milk and sabzi subscriptions: deliveries per dairy for a date.
import { useState } from 'react';
import { useData } from '../hooks';

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export default function Subscriptions() {
  const [date, setDate] = useState(today());
  const { data, error } = useData(`/admin/subscriptions?date=${date}`, 30000);
  return (
    <>
      <h1>Subscriptions</h1>
      <div className="row">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {data ? <span className="muted">{data.activeSubscriptions} active subscriptions in total</span> : null}
      </div>
      {error ? <div className="error">{error.message}</div> : null}
      <div className="card">
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Dairy / shop</th>
                <th>Deliveries</th>
                <th>Delivered</th>
                <th>Missed</th>
                <th>Total quantity</th>
              </tr>
            </thead>
            <tbody>
              {(data?.byMerchant || []).map((m) => (
                <tr key={m.merchantId}>
                  <td><b>{m.merchantName}</b></td>
                  <td>{m.deliveries}</td>
                  <td><span className="tag green">{m.delivered}</span></td>
                  <td>{m.missed ? <span className="tag red">{m.missed}</span> : 0}</td>
                  <td>{m.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.byMerchant.length ? <p className="muted">No deliveries for this date.</p> : null}
        </div>
      </div>
    </>
  );
}
