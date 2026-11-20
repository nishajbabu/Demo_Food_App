// Fills an EMPTY database with sample villages, shops, products, riders and drivers,
// so you can try every screen straight away. All names and numbers are made up.
// Runs as part of: npm run db:setup  /  npm run db:reset
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { createPool } from '../src/db.js';
import { addDays, todayIST } from '../src/lib/time.js';

// Test phone numbers. In development, log in with any of them; the OTP appears on screen.
export const TEST_USERS = {
  admin: '9000000001',
  support: '9000000002',
  kavita: '9000000101',
  ramPrasad: '9000000102',
  sunita: '9000000103',
  sharmaDhaba: '9000000201',
  rameshStore: '9000000202',
  yadavDairy: '9000000203',
  laxmiKirana: '9000000204',
  suresh: '9000000301',
  mahesh: '9000000302',
  raju: '9000000401',
  anwar: '9000000402',
  bablu: '9000000403',
};

export async function seed(url = config.databaseUrl, { quiet = false } = {}) {
  const pool = createPool(url);
  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  try {
    const existing = await one('SELECT COUNT(*)::int AS n FROM users');
    if (existing.n > 0) {
      if (!quiet) console.log('Database already has data - seed skipped. Use "npm run db:reset" to start fresh.');
      return;
    }

    await q(`INSERT INTO settings (key, value) VALUES ('services', $1)`, [
      JSON.stringify({ grocery: true, milk: true, food: true, rides: true }),
    ]);

    // Villages (sample coordinates).
    const V = {};
    for (const [key, name, lat, lng] of [
      ['rampur', 'Rampur', 25.6, 81.2],
      ['kheda', 'Kheda', 25.625, 81.22],
      ['bhawanipur', 'Bhawanipur', 25.585, 81.235],
      ['nayaGaon', 'Naya Gaon', 25.57, 81.18],
      ['tehsil', 'Tehsil Town', 25.64, 81.26],
    ]) {
      V[key] = (await one('INSERT INTO villages (name, cluster, district, lat, lng) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
        name,
        'Rampur cluster',
        'Sample District',
        lat,
        lng,
      ])).id;
    }

    const P = {};
    for (const [key, village, name, lat, lng] of [
      ['rampurChowk', 'rampur', 'Rampur Chowk', 25.6, 81.2],
      ['panchayat', 'rampur', 'Panchayat Bhavan, Rampur', 25.602, 81.203],
      ['school', 'rampur', 'Primary School stop, Rampur', 25.598, 81.206],
      ['khedaBus', 'kheda', 'Kheda Bus Stop', 25.625, 81.22],
      ['mandir', 'bhawanipur', 'Bhawanipur Mandir', 25.585, 81.235],
      ['pond', 'nayaGaon', 'Naya Gaon Pond', 25.57, 81.18],
      ['busStand', 'tehsil', 'Tehsil Bus Stand', 25.64, 81.26],
      ['hospital', 'tehsil', 'Tehsil Hospital', 25.642, 81.255],
    ]) {
      P[key] = (await one('INSERT INTO places (village_id, name, lat, lng) VALUES ($1, $2, $3, $4) RETURNING id', [V[village], name, lat, lng])).id;
    }

    const user = async (phone, name, role, village, landmark = null) =>
      (await one('INSERT INTO users (phone, name, role, village_id, landmark) VALUES ($1, $2, $3, $4, $5) RETURNING id', [
        phone,
        name,
        role,
        V[village],
        landmark,
      ])).id;

    const U = {};
    U.admin = await user(TEST_USERS.admin, 'GaonGo Admin', 'admin', 'rampur');
    U.support = await user(TEST_USERS.support, 'Priya (Support)', 'support', 'rampur');
    U.kavita = await user(TEST_USERS.kavita, 'Kavita', 'customer', 'rampur', 'House 23, Ward 4, blue gate opposite the hand pump');
    U.ramPrasad = await user(TEST_USERS.ramPrasad, 'Ram Prasad', 'customer', 'rampur', 'House 14, Mandir Gali');
    U.sunita = await user(TEST_USERS.sunita, 'Sunita Devi', 'customer', 'rampur', 'House 12, Mandir Gali');
    U.sharma = await user(TEST_USERS.sharmaDhaba, 'Mr Sharma', 'merchant', 'rampur');
    U.ramesh = await user(TEST_USERS.rameshStore, 'Ramesh', 'merchant', 'rampur');
    U.yadav = await user(TEST_USERS.yadavDairy, 'Yadav ji', 'merchant', 'rampur');
    U.laxmi = await user(TEST_USERS.laxmiKirana, 'Laxmi', 'merchant', 'kheda');
    U.suresh = await user(TEST_USERS.suresh, 'Suresh', 'rider', 'rampur');
    U.mahesh = await user(TEST_USERS.mahesh, 'Mahesh', 'rider', 'kheda');
    U.raju = await user(TEST_USERS.raju, 'Raju Kumar', 'driver', 'rampur');
    U.anwar = await user(TEST_USERS.anwar, 'Anwar', 'driver', 'rampur');
    U.bablu = await user(TEST_USERS.bablu, 'Bablu', 'driver', 'rampur');

    for (const [id, type, no] of [
      [U.suresh, 'bike', 'XX 01 A 1111'],
      [U.mahesh, 'bike', 'XX 01 A 2222'],
      [U.raju, 'auto', 'XX 01 B 3333'],
      [U.anwar, 'cab', 'XX 01 C 4444'],
      [U.bablu, 'erick', 'XX 01 E 5555'],
    ]) {
      await q('INSERT INTO partner_status (user_id, online, vehicle_type, vehicle_no) VALUES ($1, FALSE, $2, $3)', [id, type, no]);
    }

    const merchant = async (owner, name, type, village, landmark, status, fssai, description) =>
      (await one(
        `INSERT INTO merchants (owner_id, name, type, village_id, landmark, status, fssai_no, description, lat, lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [owner, name, type, V[village], landmark, status, fssai, description, 25.6 + Math.random() * 0.004, 81.2 + Math.random() * 0.004],
      )).id;

    const M = {};
    M.sharma = await merchant(U.sharma, 'Sharma Dhaba', 'food', 'rampur', 'Main road, near Rampur Chowk', 'approved', 'SAMPLE-FSSAI-001', 'Thali, North Indian, veg and egg');
    M.ramesh = await merchant(U.ramesh, 'Ramesh General Store', 'grocery', 'rampur', 'Main Bazaar, next to the post office', 'approved', null, 'Atta, dal, oil, daily needs and sabzi');
    M.yadav = await merchant(U.yadav, 'Yadav Dairy', 'dairy', 'rampur', 'Behind Panchayat Bhavan', 'approved', 'SAMPLE-FSSAI-002', 'Fresh cow and buffalo milk every morning');
    M.laxmi = await merchant(U.laxmi, 'Laxmi Kirana', 'grocery', 'kheda', 'Kheda Bus Stop', 'pending', null, 'Waiting for approval');

    const product = async (m, name, nameHi, unit, category, rupees, extra = {}) =>
      (await one(
        `INSERT INTO products (merchant_id, name, name_hi, unit, category, price_paise, is_veg, is_subscribable, description, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [m, name, nameHi, unit, category, rupees * 100, extra.veg ?? null, extra.sub ?? false, extra.desc ?? null, extra.sort ?? 0],
      )).id;

    // Sharma Dhaba (food)
    await product(M.sharma, 'Veg Thali', 'वेज थाली', 'plate', 'Thali', 120, { veg: true, desc: 'Dal, sabzi, 4 roti, rice, salad', sort: 1 });
    await product(M.sharma, 'Egg Curry & Rice', 'अंडा करी चावल', 'plate', 'Mains', 110, { veg: false, desc: '2 eggs, home-style gravy', sort: 2 });
    await product(M.sharma, 'Paneer Butter Masala + 2 Roti', 'पनीर बटर मसाला', 'plate', 'Mains', 160, { veg: true, sort: 3 });
    await product(M.sharma, 'Samosa (2 pcs)', 'समोसा', 'plate', 'Snacks', 30, { veg: true, desc: 'With green and imli chutney', sort: 4 });
    await product(M.sharma, 'Sweet Lassi', 'मीठी लस्सी', 'glass', 'Drinks', 30, { veg: true, sort: 5 });

    // Ramesh General Store (grocery)
    const g = [
      ['Chakki Atta', 'चक्की आटा', '5 kg', 'Atta & Rice', 245],
      ['Sona Masoori Rice', 'चावल', '5 kg', 'Atta & Rice', 320],
      ['Toor Dal', 'अरहर दाल', '1 kg', 'Dal', 165],
      ['Chana Dal', 'चना दाल', '1 kg', 'Dal', 95],
      ['Mustard Oil', 'सरसों का तेल', '1 litre', 'Oil & Masala', 175],
      ['Haldi Powder', 'हल्दी', '200 g', 'Oil & Masala', 48],
      ['Sugar', 'चीनी', '1 kg', 'Daily Use', 46],
      ['Tea Leaves', 'चाय पत्ती', '250 g', 'Daily Use', 125],
      ['Washing Soap', 'कपड़े का साबुन', '4 bars', 'Daily Use', 80],
      ['Onion', 'प्याज़', '1 kg', 'Sabzi', 38],
      ['Potato', 'आलू', '1 kg', 'Sabzi', 30],
      ['Tomato', 'टमाटर', '1 kg', 'Sabzi', 40],
    ];
    let sort = 1;
    for (const [name, hi, unit, cat, rs] of g) await product(M.ramesh, name, hi, unit, cat, rs, { sort: sort++ });
    const sabziBasket = await product(M.ramesh, 'Sabzi Basket (seasonal)', 'सब्ज़ी टोकरी', '5 kg basket', 'Sabzi', 249, {
      sub: true,
      desc: 'Seasonal vegetables picked by the shop, weekly',
      sort: sort++,
    });

    // Yadav Dairy
    const buffalo = await product(M.yadav, 'Buffalo Milk', 'भैंस का दूध', 'litre', 'Milk', 64, { sub: true, sort: 1 });
    const cow = await product(M.yadav, 'Cow Milk', 'गाय का दूध', 'litre', 'Milk', 56, { sub: true, sort: 2 });
    await product(M.yadav, 'Fresh Curd', 'दही', '500 g pack', 'Curd', 35, { sub: true, sort: 3 });
    await product(M.yadav, 'Paneer', 'पनीर', '200 g', 'Paneer', 90, { sort: 4 });
    await product(M.yadav, 'Desi Ghee', 'देसी घी', '500 ml', 'Ghee', 380, { sort: 5 });

    // Ride prices (sample): fare = max(min, base + per_km x km)
    for (const [type, label, base, perKm, min, seats] of [
      ['bike', 'Bike taxi', 15, 5, 25, 1],
      ['erick', 'E-rickshaw', 20, 7, 30, 4],
      ['auto', 'Auto', 30, 9, 40, 3],
      ['cab', 'Cab', 60, 14, 100, 4],
    ]) {
      await q('INSERT INTO ride_fares (vehicle_type, label, base_paise, per_km_paise, min_paise, seats) VALUES ($1, $2, $3, $4, $5, $6)', [
        type,
        label,
        base * 100,
        perKm * 100,
        min * 100,
        seats,
      ]);
    }

    // Share-auto routes and two departures by Raju.
    const r1 = (await one('INSERT INTO share_routes (name, from_place_id, to_place_id, fare_per_seat_paise) VALUES ($1, $2, $3, 2000) RETURNING id', [
      'Rampur Chowk → Tehsil Bus Stand',
      P.rampurChowk,
      P.busStand,
    ])).id;
    await q('INSERT INTO share_routes (name, from_place_id, to_place_id, fare_per_seat_paise) VALUES ($1, $2, $3, 2000)', [
      'Tehsil Bus Stand → Rampur Chowk',
      P.busStand,
      P.rampurChowk,
    ]);
    const inTwoHours = new Date(Date.now() + 2 * 3600 * 1000);
    inTwoHours.setMinutes(Math.ceil(inTwoHours.getMinutes() / 10) * 10, 0, 0);
    await q('INSERT INTO share_trips (route_id, driver_id, departs_at, seats_total) VALUES ($1, $2, $3, 6)', [r1, U.raju, inTwoHours.toISOString()]);
    await q("INSERT INTO share_trips (route_id, driver_id, departs_at, seats_total) VALUES ($1, $2, ($3::date + time '10:40') AT TIME ZONE 'Asia/Kolkata', 6)", [
      r1,
      U.raju,
      addDays(todayIST(), 1),
    ]);

    // Two milk subscriptions that started 10 days ago, with the last 5 days delivered.
    const today = todayIST();
    const subs = [
      [U.sunita, buffalo, 64, 1, 'House 12, Mandir Gali'],
      [U.ramPrasad, cow, 56, 2, 'House 14, Mandir Gali'],
    ];
    for (const [customer, productId, rupees, qty, address] of subs) {
      const s = await one(
        `INSERT INTO subscriptions (customer_id, merchant_id, product_id, qty, frequency, slot, start_date, address_text)
         VALUES ($1, $2, $3, $4, 'daily', 'morning', $5, $6) RETURNING id`,
        [customer, M.yadav, productId, qty, addDays(today, -10), address],
      );
      for (let d = 5; d >= 1; d -= 1) {
        await q(
          `INSERT INTO subscription_deliveries (subscription_id, delivery_date, qty, unit_price_paise, amount_paise, status, delivered_at)
           VALUES ($1, $2, $3, $4, $5, 'delivered', now() - make_interval(days => $6))`,
          [s.id, addDays(today, -d), qty, rupees * 100, rupees * 100 * qty, d],
        );
      }
    }
    // A weekly sabzi basket for Kavita.
    await q(
      `INSERT INTO subscriptions (customer_id, merchant_id, product_id, qty, frequency, slot, start_date, address_text)
       VALUES ($1, $2, $3, 1, 'weekly', 'evening', $4, $5)`,
      [U.kavita, M.ramesh, sabziBasket, addDays(today, 2), 'House 23, Ward 4, blue gate opposite the hand pump'],
    );

    // One open support ticket so the console isn't empty.
    const t = await one(
      "INSERT INTO tickets (created_by, subject, category, priority, channel) VALUES ($1, 'Milk came late today', 'subscription', 'medium', 'phone') RETURNING id",
      [U.sunita],
    );
    await q('INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body) VALUES ($1, $2, TRUE, $3)', [
      t.id,
      U.support,
      '[phone] Customer says milk came at 8:15 AM instead of 6-7 AM.',
    ]);

    if (!quiet) {
      console.log('Sample data added. Test logins (OTP is shown on screen in development):');
      for (const [k, v] of Object.entries(TEST_USERS)) console.log(`  ${k.padEnd(12)} ${v}`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().catch((err) => {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  });
}
