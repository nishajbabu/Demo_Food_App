// Shops: approve new ones, suspend, sign up a new shop, export & bulk import products from CSV.
import { useState } from 'react';
import { api } from '../api';
import { useAction, useData } from '../hooks';

const SAMPLE_CSV = `name,nameTa,nameHi,unit,category,priceRupees,isVeg,isSubscribable
Ponni Rice,பொன்னி அரிசி,पोन्नी चावल,5 kg,Rice,320,true,false
Toor Dal,துவரம் பருப்பு,अरहर दाल,1 kg,Dal,165,true,false
Cow Milk,பசு பால்,गाय का दूध,litre,Milk,56,true,true`;

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseBool(v) {
  const s = (v || '').trim().toLowerCase();
  if (!s) return undefined;
  if (['true', 'yes', '1', 'y'].includes(s)) return true;
  if (['false', 'no', '0', 'n'].includes(s)) return false;
  return undefined;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { error: 'Include the header row and at least one item row.', items: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name) => headers.indexOf(name.toLowerCase());
  if (col('name') === -1 || col('priceRupees') === -1) {
    return { error: 'Header must include at least "name" and "priceRupees".', items: [] };
  }

  const items = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const get = (h) => {
      const idx = col(h);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const name = get('name');
    const price = parseFloat(get('priceRupees'));
    if (!name || Number.isNaN(price) || price < 0) {
      return { error: `Row ${i + 1}: invalid name or priceRupees.`, items: [] };
    }
    items.push({
      name,
      nameTa: get('nameTa') || undefined,
      nameHi: get('nameHi') || undefined,
      unit: get('unit') || 'piece',
      category: get('category') || undefined,
      pricePaise: Math.round(price * 100),
      isVeg: parseBool(get('isVeg')),
      isSubscribable: parseBool(get('isSubscribable')) ?? false,
    });
  }
  return { error: null, items };
}

function triggerCsvDownload(filename, content) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Merchants({ user }) {
  const list = useData('/admin/merchants');
  const villages = useData('/admin/villages');
  const [run, busy] = useAction(list.reload);
  const [f, setF] = useState({ ownerPhone: '', ownerName: '', name: '', type: 'grocery', villageId: '', landmark: '', fssaiNo: '' });
  const [importShop, setImportShop] = useState(null);
  const [csvText, setCsvText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const isAdmin = user.role === 'admin';
  const tag = { pending: 'amber', approved: 'green', suspended: 'red' };

  const parsed = csvText.trim() ? parseCsv(csvText) : { error: null, items: [] };

  async function exportShopCsv(shop) {
    const products = await api(`/admin/merchants/${shop.id}/products`);
    const header = 'name,nameTa,nameHi,unit,category,priceRupees,isVeg,isSubscribable';
    const rows = products.map((p) =>
      [
        p.name,
        p.nameTa,
        p.nameHi,
        p.unit,
        p.category,
        (p.pricePaise / 100).toString(),
        p.isVeg ?? '',
        p.isSubscribable ? 'true' : 'false',
      ]
        .map(csvCell)
        .join(','),
    );
    const slug = shop.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    triggerCsvDownload(`${slug}-products.csv`, [header, ...rows].join('\n'));
  }

  return (
    <>
      <h1>Shops</h1>
      {list.error ? <div className="error">{list.error.message}</div> : null}
      <div className="card">
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Type</th>
                <th>Owner</th>
                <th>Village</th>
                <th>Documents</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(list.data || []).map((m) => (
                <tr key={m.id}>
                  <td><b>{m.name}</b><br /><span className="muted">{m.productCount} items · {m.isOpen ? 'open' : 'closed'}</span></td>
                  <td>{m.type}</td>
                  <td>{m.ownerName}<br /><span className="muted">{m.ownerPhone}</span></td>
                  <td>{m.villageName}</td>
                  <td className="muted">FSSAI: {m.fssaiNo || '—'}<br />GST: {m.gstNo || '—'}</td>
                  <td><span className={`tag ${tag[m.status]}`}>{m.status}</span></td>
                  <td className="row">
                    {isAdmin && m.status !== 'approved' ? (
                      <button className="btn" disabled={busy} onClick={() => run(() => api(`/admin/merchants/${m.id}`, { method: 'PATCH', body: { status: 'approved' } }))}>
                        Approve
                      </button>
                    ) : null}
                    {isAdmin && m.status === 'approved' ? (
                      <button className="btn danger" disabled={busy} onClick={() => confirm(`Suspend ${m.name}?`) && run(() => api(`/admin/merchants/${m.id}`, { method: 'PATCH', body: { status: 'suspended' } }))}>
                        Suspend
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button className="btn outline" disabled={busy} onClick={() => { setImportShop(m); setImportMsg(''); }}>
                        Import / Export CSV
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && importShop ? (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Products CSV · {importShop.name}</h2>
            <button className="btn outline" onClick={() => setImportShop(null)}>Close</button>
          </div>
          <div className="row">
            <button type="button" className="btn outline" disabled={busy} onClick={() => run(() => exportShopCsv(importShop))}>
              Export current items CSV
            </button>
            <button type="button" className="btn outline" onClick={() => triggerCsvDownload('gaongo-products-sample.csv', SAMPLE_CSV)}>
              Download sample CSV
            </button>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setCsvText(String(reader.result || ''));
                reader.readAsText(file, 'UTF-8');
              }}
            />
          </div>
          <label>
            Paste CSV rows (matching name + unit updates existing price; new items are added)
            <textarea
              rows={6}
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); setImportMsg(''); }}
              placeholder={SAMPLE_CSV}
            />
          </label>
          {parsed.error ? <div className="error">{parsed.error}</div> : null}
          {parsed.items.length ? <span className="tag green">Ready to upload {parsed.items.length} item(s)</span> : null}
          {importMsg ? <span className="tag blue">{importMsg}</span> : null}
          <div className="row">
            <button
              className="btn"
              disabled={busy || !parsed.items.length}
              onClick={() =>
                run(async () => {
                  const res = await api(`/admin/merchants/${importShop.id}/products/import`, {
                    method: 'POST',
                    body: { items: parsed.items },
                  });
                  setCsvText('');
                  setImportMsg(`Added ${res.inserted}, updated ${res.updated} item(s) in ${importShop.name}.`);
                })
              }
            >
              Upload {parsed.items.length || ''} items
            </button>
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/admin/merchants', { method: 'POST', body: { ...f, villageId: Number(f.villageId), fssaiNo: f.fssaiNo || undefined, landmark: f.landmark || undefined } });
              setF({ ownerPhone: '', ownerName: '', name: '', type: 'grocery', villageId: '', landmark: '', fssaiNo: '' });
            });
          }}
        >
          <h2>Sign up a new shop</h2>
          <div className="grid">
            <label>Shop name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
            <label>Type
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="grocery">Grocery / kirana</option>
                <option value="dairy">Dairy</option>
                <option value="food">Food / dhaba</option>
              </select>
            </label>
            <label>Owner name<input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} required /></label>
            <label>Owner mobile<input value={f.ownerPhone} onChange={(e) => setF({ ...f, ownerPhone: e.target.value })} maxLength={10} required /></label>
            <label>Village
              <select value={f.villageId} onChange={(e) => setF({ ...f, villageId: e.target.value })} required>
                <option value="">Choose…</option>
                {(villages.data || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label>Landmark<input value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} /></label>
            <label>FSSAI no. (food & dairy)<input value={f.fssaiNo} onChange={(e) => setF({ ...f, fssaiNo: e.target.value })} /></label>
          </div>
          <button className="btn" disabled={busy}>Add shop (starts as pending)</button>
          <span className="muted">The owner can now log in to the GaonGo Partner app with this number and add items.</span>
        </form>
      ) : null}
    </>
  );
}