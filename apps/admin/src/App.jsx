// GaonGo Ops console: login, then a sidebar of sections.
import { useEffect, useState } from 'react';
import { api, getServer, setOnUnauthorized, setServer } from './api';
import { useData } from './hooks';
import Overview from './pages/Overview.jsx';
import Orders from './pages/Orders.jsx';
import Merchants from './pages/Merchants.jsx';
import Partners from './pages/Partners.jsx';
import Subscriptions from './pages/Subscriptions.jsx';
import Rides from './pages/Rides.jsx';
import Support from './pages/Support.jsx';
import Settings from './pages/Settings.jsx';

const SECTIONS = [
  ['overview', 'Overview', Overview],
  ['orders', 'Orders', Orders],
  ['subscriptions', 'Subscriptions', Subscriptions],
  ['rides', 'Rides', Rides],
  ['merchants', 'Shops', Merchants],
  ['partners', 'Riders & drivers', Partners],
  ['support', 'Support', Support],
  ['settings', 'Settings', Settings],
];

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('adminUser') || 'null'));
  const [section, setSection] = useState(() => location.hash.slice(1) || 'overview');

  useEffect(() => {
    setOnUnauthorized(() => {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      setUser(null);
    });
  }, []);
  useEffect(() => {
    location.hash = section;
  }, [section]);

  if (!user) return <Login onLogin={setUser} />;
  const Page = (SECTIONS.find((s) => s[0] === section) || SECTIONS[0])[2];
  return (
    <div className="layout">
      <Sidebar section={section} setSection={setSection} user={user} onLogout={() => {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        setUser(null);
      }} />
      <main>
        <Page user={user} go={setSection} />
      </main>
    </div>
  );
}

function Sidebar({ section, setSection, user, onLogout }) {
  const stats = useData('/admin/stats', 30000);
  const badges = { support: stats.data?.tickets?.open, merchants: stats.data?.pendingMerchants };
  return (
    <nav className="side" aria-label="Sections">
      <div className="brand">GaonGo Ops</div>
      {SECTIONS.map(([key, label]) => (
        <button key={key} className={section === key ? 'on' : ''} onClick={() => setSection(key)}>
          {label}
          {badges[key] ? <span className="badge">{badges[key]}</span> : null}
        </button>
      ))}
      <div className="who">
        {user.name} · {user.role}
        <br />
        <a href="#" style={{ color: '#fff' }} onClick={(e) => { e.preventDefault(); onLogout(); }}>
          Log out
        </a>
      </div>
    </nav>
  );
}

function Login({ onLogin }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState(null);
  const [step, setStep] = useState('phone');
  const [error, setError] = useState(null);
  const [server, setServerField] = useState(getServer());

  async function send(e) {
    e.preventDefault();
    setError(null);
    try {
      setServer(server);
      const r = await api('/auth/request-otp', { method: 'POST', body: { phone } });
      setDevOtp(r.devOtp || null);
      setStep('otp');
    } catch (err) {
      setError(err.message);
    }
  }
  async function verify(e) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/auth/verify-otp', { method: 'POST', body: { phone, otp, app: 'admin' } });
      localStorage.setItem('adminToken', r.token);
      localStorage.setItem('adminUser', JSON.stringify(r.user));
      onLogin(r.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login card">
      <h1 style={{ color: 'var(--green)' }}>GaonGo Ops</h1>
      <p className="muted">Admin and support console</p>
      {step === 'phone' ? (
        <form onSubmit={send} className="card" style={{ padding: 0 }}>
          <label>
            Mobile number
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={10} inputMode="numeric" autoFocus />
          </label>
          <label>
            Server
            <input value={server} onChange={(e) => setServerField(e.target.value)} />
          </label>
          <button className="btn" disabled={phone.length !== 10}>Send code</button>
        </form>
      ) : (
        <form onSubmit={verify} className="card" style={{ padding: 0 }}>
          {devOtp ? <div className="tag amber">Test mode code: {devOtp}</div> : null}
          <label>
            Code from SMS
            <input value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={6} inputMode="numeric" autoFocus />
          </label>
          <button className="btn" disabled={otp.length < 4}>Log in</button>
          <button type="button" className="btn outline" onClick={() => setStep('phone')}>Change number</button>
        </form>
      )}
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
