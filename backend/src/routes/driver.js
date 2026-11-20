// Driver side: daily pass, go online, accept ride requests, run share-auto trips.
import { Router } from 'express';
import { config } from '../config.js';
import { many, one, query } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { ids, parse, z } from '../lib/validate.js';
import { camel } from '../lib/util.js';
import { notify } from '../lib/sms.js';
import { todayIST } from '../lib/time.js';
import { loadRide } from './rides.js';

const router = Router();
router.use(requireAuth, requireRole('driver'));

async function driverSummary(driverId) {
  const status = await one('SELECT online, vehicle_type, vehicle_no FROM partner_status WHERE user_id = $1', [driverId]);
  const pass = await one('SELECT id FROM driver_passes WHERE driver_id = $1 AND pass_date = $2', [driverId, todayIST()]);
  const rides = await one(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(fare_paise), 0)::int AS paise FROM rides
      WHERE driver_id = $1 AND status = 'completed' AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
    [driverId, todayIST()],
  );
  const share = await one(
    `SELECT COUNT(DISTINCT t.id)::int AS n,
            COALESCE(SUM(b.fare_paise) FILTER (WHERE b.status = 'booked'), 0)::int
            + COALESCE((SELECT SUM(t2.walkins * sr2.fare_per_seat_paise) FROM share_trips t2 JOIN share_routes sr2 ON sr2.id = t2.route_id
                         WHERE t2.driver_id = $1 AND t2.status = 'completed' AND (t2.departs_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date), 0)::int AS paise
       FROM share_trips t LEFT JOIN share_bookings b ON b.trip_id = t.id
      WHERE t.driver_id = $1 AND t.status = 'completed' AND (t.departs_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
    [driverId, todayIST()],
  );
  return {
    online: status?.online || false,
    vehicleType: status?.vehicle_type || 'auto',
    vehicleNo: status?.vehicle_no || null,
    passActive: Boolean(pass),
    passPricePaise: config.money.driverDailyPassPaise,
    passRequired: config.rules.requireDriverPass,
    tripsToday: rides.n + share.n,
    earnedTodayPaise: rides.paise + Number(share.paise),
  };
}

router.get('/me', async (req, res) => res.json(await driverSummary(req.user.id)));

router.patch('/status', async (req, res) => {
  const b = parse(
    z.object({ online: z.boolean().optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }),
    req.body,
  );
  if (b.online && config.rules.requireDriverPass) {
    const pass = await one('SELECT id FROM driver_passes WHERE driver_id = $1 AND pass_date = $2', [req.user.id, todayIST()]);
    if (!pass) throw forbidden("Buy today's pass to go online");
  }
  await query(
    `INSERT INTO partner_status (user_id, online, lat, lng, vehicle_type, updated_at)
     VALUES ($1, COALESCE($2, FALSE), $3, $4, 'auto', now())
     ON CONFLICT (user_id) DO UPDATE SET online = COALESCE($2, partner_status.online),
       lat = COALESCE($3, partner_status.lat), lng = COALESCE($4, partner_status.lng), updated_at = now()`,
    [req.user.id, b.online ?? null, b.lat ?? null, b.lng ?? null],
  );
  res.json(await driverSummary(req.user.id));
});

// Today's flat pass. Collecting the money (cash to the hub or UPI) is recorded here.
router.post('/pass', async (req, res) => {
  await query(
    'INSERT INTO driver_passes (driver_id, pass_date, amount_paise) VALUES ($1, $2, $3) ON CONFLICT (driver_id, pass_date) DO NOTHING',
    [req.user.id, todayIST(), config.money.driverDailyPassPaise],
  );
  res.json(await driverSummary(req.user.id));
});

// Ride requests for my vehicle type in my cluster, plus my current ride.
router.get('/requests', async (req, res) => {
  const summary = await driverSummary(req.user.id);
  const current = await one("SELECT id FROM rides WHERE driver_id = $1 AND status IN ('accepted', 'started')", [req.user.id]);
  let requests = [];
  if (summary.online && !current) {
    requests = await many(
      `SELECT r.id, r.vehicle_type, r.distance_km, r.fare_paise, r.payment_method, r.created_at,
              pp.name AS pickup_name, dp.name AS drop_name, c.name AS customer_name
         FROM rides r
         JOIN places pp ON pp.id = r.pickup_place_id
         JOIN places dp ON dp.id = r.drop_place_id
         JOIN users c ON c.id = r.customer_id
         JOIN villages v ON v.id = pp.village_id
        WHERE r.status = 'requested' AND r.vehicle_type = $2
          AND v.cluster = (SELECT cluster FROM villages WHERE id = (SELECT village_id FROM users WHERE id = $1))
        ORDER BY r.created_at LIMIT 10`,
      [req.user.id, summary.vehicleType],
    );
  }
  const currentRide = current ? await loadRide(current.id) : null;
  if (currentRide) delete currentRide.rideOtp; // the driver must ask the customer for it
  res.json({ ...summary, current: currentRide, requests: camel(requests) });
});

router.post('/rides/:id/accept', async (req, res) => {
  const summary = await driverSummary(req.user.id);
  if (summary.passRequired && !summary.passActive) throw forbidden("Buy today's pass first");
  const busy = await one("SELECT id FROM rides WHERE driver_id = $1 AND status IN ('accepted', 'started')", [req.user.id]);
  if (busy) throw conflict('Finish your current ride first');
  const ride = await one(
    "UPDATE rides SET driver_id = $2, status = 'accepted', accepted_at = now() WHERE id = $1 AND status = 'requested' AND driver_id IS NULL RETURNING *",
    [ids(req), req.user.id],
  );
  if (!ride) throw conflict('Another driver already took this ride');
  notify(ride.customer_id, `${req.user.name || 'Your driver'} is coming to pick you up`);
  const out = await loadRide(ride.id);
  delete out.rideOtp;
  res.json(out);
});

router.post('/rides/:id/start', async (req, res) => {
  const b = parse(z.object({ otp: z.string().trim().regex(/^\d{4}$/, 'Ask the customer for the 4-digit code') }), req.body);
  const ride = await one('SELECT * FROM rides WHERE id = $1 AND driver_id = $2', [ids(req), req.user.id]);
  if (!ride) throw notFound('Ride not found');
  if (ride.status !== 'accepted') throw conflict(`This ride is ${ride.status}`);
  if (ride.ride_otp !== b.otp) throw badRequest('Wrong code. Ask the customer to check the app.');
  await query("UPDATE rides SET status = 'started', started_at = now() WHERE id = $1", [ride.id]);
  const out = await loadRide(ride.id);
  delete out.rideOtp;
  res.json(out);
});

router.post('/rides/:id/complete', async (req, res) => {
  const ride = await one(
    "UPDATE rides SET status = 'completed', completed_at = now() WHERE id = $1 AND driver_id = $2 AND status = 'started' RETURNING *",
    [ids(req), req.user.id],
  );
  if (!ride) throw conflict('Start the ride first');
  res.json({ ride: camel(ride), ...(await driverSummary(req.user.id)) });
});

router.post('/rides/:id/cancel', async (req, res) => {
  // Driver gives the ride back; it becomes available to other drivers again.
  const ride = await one(
    "UPDATE rides SET driver_id = NULL, status = 'requested', accepted_at = NULL WHERE id = $1 AND driver_id = $2 AND status = 'accepted' RETURNING *",
    [ids(req), req.user.id],
  );
  if (!ride) throw conflict('This ride cannot be given back now');
  notify(ride.customer_id, 'Your driver could not come. We are finding another driver.');
  res.json({ ok: true });
});

// ---------------- Share-auto trips ----------------
router.get('/routes', async (req, res) => {
  res.json(
    camel(
      await many(
        `SELECT sr.id, sr.name, sr.fare_per_seat_paise FROM share_routes sr WHERE sr.is_active ORDER BY sr.name`,
      ),
    ),
  );
});

async function myTrips(driverId) {
  const trips = await many(
    `SELECT t.*, sr.name AS route_name, sr.fare_per_seat_paise,
            COALESCE((SELECT SUM(seats) FROM share_bookings b WHERE b.trip_id = t.id AND b.status = 'booked'), 0)::int AS seats_booked
       FROM share_trips t JOIN share_routes sr ON sr.id = t.route_id
      WHERE t.driver_id = $1 AND t.status IN ('scheduled', 'started')
      ORDER BY t.departs_at`,
    [driverId],
  );
  for (const t of trips) {
    t.bookings = await many(
      `SELECT b.id, b.seats, b.fare_paise, b.payment_method, u.name AS customer_name, u.phone AS customer_phone
         FROM share_bookings b JOIN users u ON u.id = b.customer_id
        WHERE b.trip_id = $1 AND b.status = 'booked' ORDER BY b.id`,
      [t.id],
    );
    t.seats_free = t.seats_total - t.walkins - t.seats_booked;
  }
  return camel(trips);
}

router.get('/share-trips', async (req, res) => res.json(await myTrips(req.user.id)));

router.post('/share-trips', async (req, res) => {
  const b = parse(
    z.object({
      routeId: z.coerce.number().int().positive(),
      departsAt: z.string().datetime({ offset: true }),
      seatsTotal: z.coerce.number().int().min(1).max(12).default(6),
    }),
    req.body,
  );
  if (new Date(b.departsAt) < new Date()) throw badRequest('Departure time must be in the future');
  const route = await one('SELECT id FROM share_routes WHERE id = $1 AND is_active', [b.routeId]);
  if (!route) throw notFound('Route not found');
  await query('INSERT INTO share_trips (route_id, driver_id, departs_at, seats_total) VALUES ($1, $2, $3, $4)', [
    b.routeId,
    req.user.id,
    b.departsAt,
    b.seatsTotal,
  ]);
  res.status(201).json(await myTrips(req.user.id));
});

// A passenger got in without the app (+1) or got out (-1).
router.post('/share-trips/:id/walkins', async (req, res) => {
  const b = parse(z.object({ delta: z.union([z.literal(1), z.literal(-1)]) }), req.body);
  const trip = await one(
    `UPDATE share_trips t SET walkins = walkins + $3
      WHERE t.id = $1 AND t.driver_id = $2 AND t.status IN ('scheduled', 'started') AND walkins + $3 >= 0
        AND walkins + $3 + COALESCE((SELECT SUM(seats) FROM share_bookings b WHERE b.trip_id = t.id AND b.status = 'booked'), 0) <= seats_total
      RETURNING id`,
    [ids(req), req.user.id, b.delta],
  );
  if (!trip) throw conflict(b.delta > 0 ? 'The auto is full' : 'No walk-in passengers to remove');
  res.json(await myTrips(req.user.id));
});

const tripMove = (from, to) => async (req, res) => {
  const trip = await one(`UPDATE share_trips SET status = $3 WHERE id = $1 AND driver_id = $2 AND status = $4 RETURNING id`, [
    ids(req),
    req.user.id,
    to,
    from,
  ]);
  if (!trip) throw conflict(`This trip is not ${from}`);
  res.json({ trips: await myTrips(req.user.id), ...(await driverSummary(req.user.id)) });
};
router.post('/share-trips/:id/start', tripMove('scheduled', 'started'));
router.post('/share-trips/:id/complete', tripMove('started', 'completed'));
router.post('/share-trips/:id/cancel', tripMove('scheduled', 'cancelled'));

export default router;
