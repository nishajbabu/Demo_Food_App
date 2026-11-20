# GaonGo — rural super app (starter code)

One app for a cluster of villages: **food delivery, daily needs (kirana), milk & sabzi subscriptions,
and rides (auto, share auto, e-rickshaw, cab)** — plus the apps for shops, riders and drivers, and a
web console for the operations and support team.

> This is a working starter, not a finished product. Every name, price and phone number in the
> sample data is made up. Read `docs/PRODUCTION-CHECKLIST.md` before real customers use it.

## What is in this folder

| Folder | What it is | Built with | Who uses it |
| --- | --- | --- | --- |
| `backend/` | The API server and database (all the rules and records) | Node.js, Express, PostgreSQL | Every app talks to it |
| `apps/customer/` | Customer app: food, daily needs, milk subscriptions, rides, help (English + Hindi) | React Native + Expo | Villagers |
| `apps/partner/` | Partner app with 3 modes: shop, delivery rider, driver | React Native + Expo | Shops, riders, drivers |
| `apps/admin/` | Admin & support web console | React + Vite | Your ops and support team |
| `docs/` | API list, production checklist | — | Developers |
| `render.yaml` | One-click hosting setup for Render (API + database + admin) | — | Developers |

## Run everything on your laptop

You need **Node.js (LTS)** installed. Open 4 terminal windows.

**1. Database** (terminal 1, keep it open)

```bash
cd backend
npm install
npm run db:local
```

This runs PostgreSQL on your laptop with nothing else to install. If it fails on your computer,
make a free database at Neon or Supabase instead, and put its connection string in
`backend/.env` as `DATABASE_URL` (add `DATABASE_SSL=true`).

**2. API server** (terminal 2)

```bash
cd backend
cp .env.example .env          # Windows: copy .env.example .env
npm run db:setup              # creates tables + sample data
npm run dev
```

It prints the address phones should use, e.g. `For phone apps: http://192.168.1.5:4000`.

**3. Customer app** (terminal 3) — install **Expo Go** on an Android phone on the same Wi-Fi

```bash
cd apps/customer
npm install
npx expo start
```

Scan the QR code with Expo Go. The app finds your laptop's server automatically.
If it can't, open "Developer settings" on the login screen and type the address from step 2.

**4. Partner app or admin console** (terminal 4)

```bash
cd apps/partner && npm install && npx expo start --port 8082
# or
cd apps/admin && npm install && npm run dev      # then open http://localhost:5173
```

### Test logins (development only — the OTP is shown on screen)

| Who | Phone | App |
| --- | --- | --- |
| Kavita (customer) | 9000000101 | Customer |
| Ram Prasad (customer, milk subscription) | 9000000102 | Customer |
| Ramesh General Store (grocery) | 9000000202 | Partner |
| Sharma Dhaba (food) | 9000000201 | Partner |
| Yadav Dairy (milk) | 9000000203 | Partner |
| Suresh (delivery rider) | 9000000301 | Partner |
| Raju Kumar (auto / share auto) | 9000000401 | Partner |
| Admin | 9000000001 | Admin console |
| Support (Priya) | 9000000002 | Admin console |

**Try a full order:** Kavita orders from Ramesh General Store → Ramesh accepts → Suresh goes online
and accepts → Ramesh taps "items ready" → Suresh taps "Picked up", then types Kavita's 4-digit code →
delivered. Watch it all in the admin console.

## Automated tests

```bash
cd backend
npm test        # needs TEST_DATABASE_URL in .env (a database whose name ends in _test)
```

22 tests cover login, the full grocery order, cash settlement, milk subscriptions (skip, pause,
delivery sheet, bill), rides with OTP, share-auto seat limits, and support tickets.

## Put it online

1. Push this folder to a private GitHub repository.
2. **API + database:** on Render, choose New → Blueprint and pick the repo. `render.yaml` creates
   the database, the API (it creates the tables on start) and the admin console. Set
   `SMS_PROVIDER`, `SUPPORT_PHONE` and the admin's `VITE_API_URL` when asked.
3. Load sample data only on a test server: `npm run db:setup` with that server's `DATABASE_URL`.
   For the real server, add your first admin by hand (see `docs/PRODUCTION-CHECKLIST.md`).
4. **Phone apps:** in `apps/customer` and `apps/partner`, put your API address in `eas.json`, then
   `npx eas-cli@latest build --platform android --profile preview` for a test APK, or
   `--profile production` for the Play Store file.

## Changing things

- Prices, delivery fee, rider pay, driver pass: `backend/.env` (no code change)
- Which services are live: admin console → Settings
- Hindi text: `apps/customer/src/i18n.js`, `apps/partner/src/state.js`
- Database tables: `backend/db/schema.sql`
- Each API: `backend/src/routes/*.js` (one file per group, with comments)
