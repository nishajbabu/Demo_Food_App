// Dates are always worked out in India time, whatever timezone the server runs in.
// A "date" here is a plain string like "2026-11-21".

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' });

export const todayIST = () => dayFormat.format(new Date());
export const hourIST = () => parseInt(hourFormat.format(new Date()), 10);

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

// '2026-11' -> ['2026-11-01', '2026-11-30']
export function monthRange(month) {
  const first = `${month}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return [first, d.toISOString().slice(0, 10)];
}

export const thisMonth = () => todayIST().slice(0, 7);
