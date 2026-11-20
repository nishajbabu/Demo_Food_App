# Before real customers use GaonGo

The starter code runs end to end, but these must be done before launch. Tick them off in a GitHub issue.

## Must do before the pilot (milestone M3)
- [ ] **Real SMS for OTP.** Pick an Indian SMS provider, register your sender ID and OTP template on DLT,
      adapt `backend/src/lib/sms.js`, set `SMS_PROVIDER=http`. `OTP_DEV_MODE=false` on every online server.
- [ ] **Secrets only in environment variables.** Long random `JWT_SECRET`. Nothing secret in GitHub.
- [ ] **Two servers:** staging (test data, `npm run db:setup`) and production (no sample data; create
      the first admin with `npm run admin:create -- <phone> "<name>"`).
- [ ] **Daily database backups** and one practice restore. Use a paid database plan.
- [ ] **HTTPS** for the API (Render gives this by default). The production apps must use `https://`.
- [ ] **Push notifications** for shops and riders (Expo Notifications / Firebase) so new orders ring with
      the app closed. Today the apps check every few seconds while open.
- [ ] **Crash and error reports** for apps and server (e.g. Sentry).
- [ ] **Rate limits** on login and order APIs (e.g. `express-rate-limit`), and a request-size limit (already 200 kb).
- [ ] **Privacy policy and terms** pages, linked in the apps and on the Play Store listing.
- [ ] **Data protection:** only collect what you need; tell users why; let them ask for deletion
      (Digital Personal Data Protection Act, 2023).
- [ ] **Cash process:** riders hand over cash every evening; support records it in the admin console.

## Must do before adding food (M5)
- [ ] Platform FSSAI licence; every food shop's FSSAI number checked before approval (the API already
      refuses to approve a food shop without one).
- [ ] Food photos and veg / non-veg marks correct for every item.

## Must do before adding rides (M6)
- [ ] State aggregator licence under the Motor Vehicle Aggregator Guidelines 2025 and your state's rules.
- [ ] Driver documents and police verification checked before adding a driver.
- [ ] 24×7 helpline and someone on call for SOS tickets (the app already creates an urgent ticket).
- [ ] Driver earnings rule: drivers using their own vehicle must keep at least 80% of the fare (the daily-pass
      model keeps 100% with the driver).
- [ ] Bike taxis only where your state allows them.

## Before the Play Store
- [ ] Google Play developer account (one-time fee), app name, icon, screenshots, short description in Hindi too.
- [ ] Replace `in.gaongo.customer` / `in.gaongo.partner` in `app.json` with your own package names, **once**
      (they can't change after the first upload).
- [ ] Production API address in `eas.json` for both apps.
- [ ] Internal testing track with 10–20 testers before production.

## Good to have soon
- [ ] Convert to TypeScript; add a shared package for the API client used by both apps.
- [ ] Database migration tool (node-pg-migrate or similar) once more than one person changes `schema.sql`.
- [ ] Order and ride events streamed to the admin console (WebSockets) instead of 10–15 s refresh.
- [ ] Map pins for addresses; nearest-rider-first dispatch when a village has many riders.
