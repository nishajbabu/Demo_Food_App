// Recent rides.
import { money, time } from '../api';
import { useData } from '../hooks';

const TAG = { requested: 'amber', accepted: 'blue', started: 'blue', completed: 'green', cancelled: 'red' };

export default function Rides() {
  const { data, error } = useData('/admin/rides', 10000);
  return (
    <>
      <h1>Rides</h1>
      {error ? <div className="error">{error.message}</div> : null}
      <div className="card">
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Ride</th>
                <th>Route</th>
                <th>Customer</th>
                <th>Driver</th>
                <th>Fare</th>
                <th>Status</th>
                <th>Booked</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((r) => (
                <tr key={r.id}>
                  <td><b>#{r.id}</b><br /><span className="muted">{r.vehicleType}</span></td>
                  <td>{r.pickupName} → {r.dropName}<br /><span className="muted">{r.distanceKm} km</span></td>
                  <td>{r.customerName || r.customerPhone}</td>
                  <td>{r.driverName ? `${r.driverName} ${r.driverPhone}` : '—'}</td>
                  <td>{money(r.farePaise)}</td>
                  <td><span className={`tag ${TAG[r.status]}`}>{r.status}</span></td>
                  <td>{time(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !data.length ? <p className="muted">No rides yet.</p> : null}
        </div>
      </div>
    </>
  );
}
