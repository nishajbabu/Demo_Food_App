// End-to-end tests of the main flows against a real (test) database.
// Run: npm test   (needs TEST_DATABASE_URL in .env; its database name must end with _test)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/_test(\?.*)?$/.test(url)) {
  console.error('Set TEST_DATABASE_URL to a database whose name ends with _test (it gets wiped).');
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.OTP_DEV_MODE = 'true';
process.env.OTP_RESEND_SECONDS = '0';

const { migrate } = await import('../scripts/migrate.js');
const { seed, TEST_USERS } = await import('../db/seed.js');
const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { default: request } = await import('supertest');

let app;
const tokens = {};

async function login(phone, appName) {
  const r1 = await request(app).post('/auth/request-otp').send({ phone });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const r2 = await request(app).post('/auth/verify-otp').send({ phone, otp: r1.body.devOtp, app: appName });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  return r2.body.token;
}

const as = (who) => ({
  get: (path) => request(app).get(path).set('Authorization', `Bearer ${tokens[who]}`),
  post: (path, body = {}) => request(app).post(path).set('Authorization', `Bearer ${tokens[who]}`).send(body),
  patch: (path, body = {}) => request(app).patch(path).set('Authorization', `Bearer ${tokens[who]}`).send(body),
});

before(async () => {
  await migrate({ url, reset: true });
  await seed(url, { quiet: true });
  app = createApp();
  tokens.kavita = await login(TEST_USERS.kavita, 'customer');
  tokens.ram = await login(TEST_USERS.ramPrasad, 'customer');
  tokens.ramesh = await login(TEST_USERS.rameshStore, 'partner');
  tokens.sharma = await login(TEST_USERS.sharmaDhaba, 'partner');
  tokens.yadav = await login(TEST_USERS.yadavDairy, 'partner');
  tokens.suresh = await login(TEST_USERS.suresh, 'partner');
  tokens.raju = await login(TEST_USERS.raju, 'partner');
  tokens.admin = await login(TEST_USERS.admin, 'admin');
  tokens.support = await login(TEST_USERS.support, 'admin');
});

after(async () => {
  await pool.end();
});

describe('login', () => {
  test('wrong OTP is rejected', async () => {
    const r1 = await request(app).post('/auth/request-otp').send({ phone: '9876543210' });
    const wrong = r1.body.devOtp === '000000' ? '111111' : '000000';
    const r2 = await request(app).post('/auth/verify-otp').send({ phone: '9876543210', otp: wrong });
    assert.equal(r2.status, 400);
  });

  test('a new number becomes a customer', async () => {
    const r1 = await request(app).post('/auth/request-otp').send({ phone: '9876543211' });
    const r2 = await request(app).post('/auth/verify-otp').send({ phone: '9876543211', otp: r1.body.devOtp, name: 'Geeta' });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.user.role, 'customer');
  });

  test('unknown numbers cannot log in to the partner app', async () => {
    const r1 = await request(app).post('/auth/request-otp').send({ phone: '9876543212' });
    const r2 = await request(app).post('/auth/verify-otp').send({ phone: '9876543212', otp: r1.body.devOtp, app: 'partner' });
    assert.equal(r2.status, 403);
  });

  test('customers cannot use partner endpoints', async () => {
    const r = await as('kavita').get('/merchant/orders');
    assert.equal(r.status, 403);
  });
});

describe('grocery order from cart to doorstep', () => {
  let orderId;
  let otp;

  test('customer sees shops and places a cash order', async () => {
    const shops = await as('kavita').get('/merchants?type=grocery');
    assert.equal(shops.status, 200);
    const ramesh = shops.body.find((m) => m.name === 'Ramesh General Store');
    assert.ok(ramesh, 'Ramesh store listed');
    assert.ok(!shops.body.find((m) => m.name === 'Laxmi Kirana'), 'pending shop hidden');

    const shop = await as('kavita').get(`/merchants/${ramesh.id}`);
    const atta = shop.body.products.find((p) => p.name === 'Chakki Atta');
    const sugar = shop.body.products.find((p) => p.name === 'Sugar');
    const r = await as('kavita').post('/orders', {
      merchantId: ramesh.id,
      items: [
        { productId: atta.id, qty: 1 },
        { productId: sugar.id, qty: 2 },
      ],
      paymentMethod: 'cod',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.itemsTotalPaise, 24500 + 2 * 4600);
    assert.equal(r.body.deliveryFeePaise, 0, 'free delivery above Rs 199');
    assert.match(r.body.deliveryOtp, /^\d{4}$/);
    orderId = r.body.id;
    otp = r.body.deliveryOtp;
  });

  test('rider sees no offer before the shop accepts', async () => {
    await as('suresh').patch('/rider/status', { online: true, lat: 25.6, lng: 81.2 });
    const r = await as('suresh').get('/rider/tasks');
    assert.equal(r.body.offers.length, 0);
  });

  test('shop accepts; rider gets the offer and takes it; a second accept fails', async () => {
    const a = await as('ramesh').post(`/merchant/orders/${orderId}/accept`);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.status, 'accepted');

    const tasks = await as('suresh').get('/rider/tasks');
    assert.equal(tasks.body.offers.length, 1);
    assert.equal(tasks.body.offers[0].id, orderId);

    const take = await as('suresh').post(`/rider/orders/${orderId}/accept`);
    assert.equal(take.status, 200, JSON.stringify(take.body));
    const again = await as('suresh').post(`/rider/orders/${orderId}/accept`);
    assert.equal(again.status, 409);
  });

  test('rider cannot pick up before the shop marks it ready', async () => {
    const r = await as('suresh').post(`/rider/orders/${orderId}/picked-up`);
    assert.equal(r.status, 409);
  });

  test('ready -> picked up -> wrong OTP fails -> right OTP delivers', async () => {
    assert.equal((await as('ramesh').post(`/merchant/orders/${orderId}/ready`)).status, 200);
    assert.equal((await as('suresh').post(`/rider/orders/${orderId}/picked-up`)).status, 200);
    const wrong = await as('suresh').post(`/rider/orders/${orderId}/delivered`, { otp: otp === '0000' ? '1111' : '0000' });
    assert.equal(wrong.status, 400);
    const ok = await as('suresh').post(`/rider/orders/${orderId}/delivered`, { otp });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'delivered');
    assert.equal(ok.body.cashInHandPaise, 24500 + 9200);
    assert.equal(ok.body.deliveriesToday, 1);
  });

  test('customer sees the full timeline', async () => {
    const r = await as('kavita').get(`/orders/${orderId}`);
    assert.deepEqual(
      r.body.events.map((e) => e.status),
      ['placed', 'accepted', 'accepted', 'ready', 'picked_up', 'delivered'],
    );
  });

  test('admin sees stats and settles the rider cash', async () => {
    const s = await as('admin').get('/admin/stats');
    assert.equal(s.status, 200);
    assert.equal(s.body.orders.find((o) => o.service === 'grocery').delivered, 1);
    const p = await as('admin').get('/admin/partners?role=rider');
    const suresh = p.body.find((x) => x.name === 'Suresh');
    assert.equal(suresh.cashInHandPaise, 33700);
    const settle = await as('admin').post(`/admin/cash/${suresh.id}/settle`, { amountPaise: 33700 });
    assert.equal(settle.status, 201);
    const me = await as('suresh').get('/rider/me');
    assert.equal(me.body.cashInHandPaise, 0);
  });

  test('closed shop refuses orders; small orders pay a delivery fee', async () => {
    const shops = await as('ram').get('/merchants?type=grocery');
    const ramesh = shops.body.find((m) => m.name === 'Ramesh General Store');
    const shop = await as('ram').get(`/merchants/${ramesh.id}`);
    const potato = shop.body.products.find((p) => p.name === 'Potato');
    const small = await as('ram').post('/orders', { merchantId: ramesh.id, items: [{ productId: potato.id, qty: 1 }] });
    assert.equal(small.status, 201);
    assert.equal(small.body.deliveryFeePaise, 2000);
    const cancel = await as('ram').post(`/orders/${small.body.id}/cancel`, { reason: 'Changed my mind' });
    assert.equal(cancel.body.status, 'cancelled');

    await as('ramesh').patch('/merchant/me', { isOpen: false });
    const closed = await as('ram').post('/orders', { merchantId: ramesh.id, items: [{ productId: potato.id, qty: 1 }] });
    assert.equal(closed.status, 409);
    await as('ramesh').patch('/merchant/me', { isOpen: true });
  });

  test('switching a service off blocks new orders', async () => {
    assert.equal((await as('support').patch('/admin/settings', { services: { food: false } })).status, 403, 'support cannot change settings');
    assert.equal((await as('admin').patch('/admin/settings', { services: { food: false } })).status, 200);
    const shops = await as('kavita').get('/merchants?type=food');
    const sharma = shops.body[0];
    const menu = await as('kavita').get(`/merchants/${sharma.id}`);
    const r = await as('kavita').post('/orders', { merchantId: sharma.id, items: [{ productId: menu.body.products[0].id, qty: 1 }] });
    assert.equal(r.status, 403);
    await as('admin').patch('/admin/settings', { services: { food: true } });
  });
});

describe('milk subscription', () => {
  let subId;
  let startDate;

  test('customer subscribes from the earliest allowed date', async () => {
    const list = await as('kavita').get('/subscriptions/products');
    assert.equal(list.status, 200);
    startDate = list.body.earliestStartDate;
    const cow = list.body.products.find((p) => p.name === 'Cow Milk');
    const r = await as('kavita').post('/subscriptions', { productId: cow.id, qty: 1.5, frequency: 'daily', startDate });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    subId = r.body.id;
    assert.equal(r.body.days.length, 7);
  });

  test('a day can be skipped and un-skipped', async () => {
    const r = await as('kavita').post(`/subscriptions/${subId}/skip`, { date: startDate, skip: true });
    assert.equal(r.status, 200);
    const day = r.body.days.find((d) => d.date === startDate);
    assert.ok(day.skipped);
    const back = await as('kavita').post(`/subscriptions/${subId}/skip`, { date: startDate, skip: false });
    assert.ok(!back.body.days.find((d) => d.date === startDate).skipped);
  });

  test('past dates cannot be changed', async () => {
    const r = await as('kavita').post(`/subscriptions/${subId}/skip`, { date: '2020-01-01' });
    assert.equal(r.status, 400);
  });

  test('dairy sheet lists the delivery; ticking it adds to the bill', async () => {
    const sheet = await as('yadav').get(`/merchant/subscriptions/sheet?date=${startDate}`);
    assert.equal(sheet.status, 200);
    const row = sheet.body.deliveries.find((d) => d.customerName === 'Kavita');
    assert.ok(row, 'Kavita on the sheet');
    assert.equal(row.qty, 1.5);
    assert.equal(row.amountPaise, 8400);
    const tick = await as('yadav').post(`/merchant/subscription-deliveries/${row.id}`, { status: 'delivered' });
    assert.equal(tick.status, 200);
    const bill = await as('kavita').get(`/subscriptions/${subId}/bill?month=${startDate.slice(0, 7)}`);
    assert.equal(bill.body.totalPaise, 8400);
  });

  test('seeded homes show month-end dues', async () => {
    const dues = await as('yadav').get('/merchant/subscriptions/dues');
    assert.equal(dues.status, 200);
    assert.ok(Array.isArray(dues.body.homes));
  });

  test('pausing removes future deliveries', async () => {
    const r = await as('kavita').patch(`/subscriptions/${subId}`, { status: 'paused' });
    assert.equal(r.body.status, 'paused');
    assert.ok(r.body.days.every((d) => !d.delivery));
  });
});

describe('rides', () => {
  test('estimate -> request -> driver accepts -> start with OTP -> complete', async () => {
    const places = await as('kavita').get('/places');
    const chowk = places.body.find((p) => p.name === 'Rampur Chowk');
    const stand = places.body.find((p) => p.name === 'Tehsil Bus Stand');
    const est = await as('kavita').get(`/rides/estimate?pickupPlaceId=${chowk.id}&dropPlaceId=${stand.id}`);
    assert.equal(est.status, 200);
    const auto = est.body.options.find((o) => o.vehicleType === 'auto');
    assert.ok(auto.farePaise >= 4000);

    const ride = await as('kavita').post('/rides', { vehicleType: 'auto', pickupPlaceId: chowk.id, dropPlaceId: stand.id });
    assert.equal(ride.status, 201, JSON.stringify(ride.body));
    const otp = ride.body.rideOtp;

    await as('raju').patch('/driver/status', { online: true });
    const reqs = await as('raju').get('/driver/requests');
    assert.equal(reqs.body.requests[0].id, ride.body.id);
    assert.equal((await as('raju').post(`/driver/rides/${ride.body.id}/accept`)).status, 200);
    assert.equal((await as('raju').post(`/driver/rides/${ride.body.id}/start`, { otp: otp === '0000' ? '1111' : '0000' })).status, 400);
    assert.equal((await as('raju').post(`/driver/rides/${ride.body.id}/start`, { otp })).status, 200);
    const done = await as('raju').post(`/driver/rides/${ride.body.id}/complete`);
    assert.equal(done.status, 200);
    assert.equal(done.body.earnedTodayPaise, auto.farePaise);
  });

  test('share auto: seats are counted and overbooking is blocked', async () => {
    const trips = await as('ram').get('/share/trips');
    assert.ok(trips.body.length >= 1);
    const trip = trips.body[0];
    assert.equal(trip.seatsFree, 6);
    assert.equal((await as('ram').post(`/share/trips/${trip.id}/book`, { seats: 4 })).status, 201);
    assert.equal((await as('raju').post(`/driver/share-trips/${trip.id}/walkins`, { delta: 1 })).status, 200);
    const tooMany = await as('kavita').post(`/share/trips/${trip.id}/book`, { seats: 2 });
    assert.equal(tooMany.status, 409);
    assert.equal((await as('kavita').post(`/share/trips/${trip.id}/book`, { seats: 1 })).status, 201);
    const mine = await as('raju').get('/driver/share-trips');
    assert.equal(mine.body.find((t) => t.id === trip.id).seatsFree, 0);
  });
});

describe('support', () => {
  test('customer raises a ticket; support replies and resolves it', async () => {
    const t = await as('kavita').post('/support/tickets', { subject: 'Wrong item', category: 'order', message: 'Got chana dal instead of toor dal' });
    assert.equal(t.status, 201);
    const list = await as('support').get('/admin/tickets');
    assert.ok(list.body.find((x) => x.id === t.body.id));
    assert.equal((await as('support').post(`/admin/tickets/${t.body.id}/messages`, { message: 'Sorry! Sending toor dal today.' })).status, 201);
    assert.equal((await as('support').post(`/admin/tickets/${t.body.id}/resolve`)).body.status, 'resolved');
    const mine = await as('kavita').get(`/support/tickets/${t.body.id}`);
    assert.equal(mine.body.messages.length, 2);
    assert.equal(mine.body.messages[1].isStaff, true);
  });
});

describe('admin bulk product import', () => {
  test('admin imports products with Tamil/Hindi names; support is blocked', async () => {
    const shops = await as('admin').get('/admin/merchants');
    const ramesh = shops.body.find((m) => m.name === 'Ramesh General Store');
    const items = [
      { name: 'Ponni Rice', nameTa: 'பொன்னி அரிசி', unit: '5 kg', category: 'Rice', pricePaise: 32000, isVeg: true },
    ];
    assert.equal((await as('support').post(`/admin/merchants/${ramesh.id}/products/import`, { items })).status, 403);
    const ok = await as('admin').post(`/admin/merchants/${ramesh.id}/products/import`, { items });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.imported, 1);

    const search = await as('kavita').get('/search?q=பொன்னி');
    assert.equal(search.status, 200);
    assert.ok(search.body.find((p) => p.name === 'Ponni Rice' && p.nameTa === 'பொன்னி அரிசி'));
  });
});

describe('push notifications', () => {
  test('authenticated user can save and remove a push token', async () => {
    const token = 'ExponentPushToken[test-token-12345]';
    const save = await as('kavita').post('/auth/push-token', { token });
    assert.equal(save.status, 200);
    const del = await request(app).delete('/auth/push-token').set('Authorization', `Bearer ${tokens.kavita}`).send({ token });
    assert.equal(del.status, 200);
  });
});