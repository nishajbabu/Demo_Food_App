// Customer side of rides: private rides (bike, auto, e-rickshaw, cab) and share-auto seats.
import { Router } from 'express';
import { config } from '../config.js';
import { many, one, query, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, notFound } from '../middleware/errors.js';
import { ids, parse, z } from '../lib/validate.js';
import { camel, randomDigits } from '../lib/util.js';
import { roadKm } from '../lib/geo.js';
import { requireService } from '../lib/settings.js';
import { notify } from '../lib/sms.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

export const fareFor = (f, km) => Math.max(f.min_paise, Math.round((f.base_paise + f.per_km_paise * km) / 100) * 100);

async function placesPair(pickupPlaceId, dropPlaceId) {
  if (pickupPlaceId === dropPlaceId) throw badRequest('Pickup and drop are the same place');
  const rows = await many('SELECT * FROM places WHERE id = ANY($1)', [[pickupPlaceId, dropPlaceId]]);
  const pickup = rows.find((p) => p.id === pickupPlaceId);
  const drop = rows.find((p) => p.id === dropPlaceId);
  if (!pickup || !drop) throw notFound('Place not found');
  return { pickup, drop, km: roadKm(pickup, drop, config.rules.roadFactor) };
}

// Prices for every vehicle type: ?pickupPlaceId=1&dropPlaceId=4
router.get('/estimate', async (req, res) => {
  await requireService('rides');
  const q = parse(z.object({ pickupPlaceId: z.coerce.number().int().positive(), dropPlaceId: z.coerce.number().int().positive() }), req.query);
  const { km } = await placesPair(q.pickupPlaceId, q.dropPlaceId);
  const fares = await many('SELECT * FROM ride_fares ORDER BY min_paise');
  const online = await many(
    `SELECT vehicle_type, COUNT(*)::int AS n FROM partner_status ps JOIN users u ON u.id = ps.user_id
      WHERE ps.online AND u.role = 'driver' AND u.is_active GROUP BY vehicle_type`,
  );
  res.json({
    distanceKm: km,
    options: fares.map((f) => ({
      vehicleType: f.vehicle_type,
      label: f.label,
      seats: f.seats,
      farePaise: fareFor(f, km),
      driversOnline: online.find((o) => o.vehicle_type === f.vehicle_type)?.n || 0,
    })),
  });
});

router.post('/', async (req, res) => {
  await requireService('rides');
  const b = parse(
    z.object({
      vehicleType: z.enum(['bike', 'auto', 'erick', 'cab']),
      pickupPlaceId: z.coerce.number().int().positive(),
      dropPlaceId: z.coerce.number().int().positive(),
      paymentMethod: z.enum(['cash', 'upi']).default('cash'),
    }),
    req.body,
  );
  const open = await one("SELECT id FROM rides WHERE customer_id = $1 AND status IN ('requested', 'accepted', 'started')", [req.user.id]);
  if (open) throw conflict('You already have a ride in progress');
  const { km } = await placesPair(b.pickupPlaceId, b.dropPlaceId);
  const fare = await one('SELECT * FROM ride_fares WHERE vehicle_type = $1', [b.vehicleType]);
  const ride = await one(
    `INSERT INTO rides (customer_id, vehicle_type, pickup_place_id, drop_place_id, distance_km, fare_paise, ride_otp, payment_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.user.id, b.vehicleType, b.pickupPlaceId, b.dropPlaceId, km, fareFor(fare, km), randomDigits(4), b.paymentMethod],
  );
  res.status(201).json(await loadRide(ride.id, req.user.id));
});

export async function loadRide(id, customerId = null) {
  const ride = await one(
    `SELECT r.*, pp.name AS pickup_name, dp.name AS drop_name, f.label AS vehicle_label,
            d.name AS driver_name, d.phone AS driver_phone, ps.vehicle_no
       FROM rides r
       JOIN places pp ON pp.id = r.pickup_place_id
       JOIN places dp ON dp.id = r.drop_place_id
       JOIN ride_fares f ON f.vehicle_type = r.vehicle_type
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN partner_status ps ON ps.user_id = r.driver_id
      WHERE r.id = $1 AND ($2::bigint IS NULL OR r.customer_id = $2)`,
    [id, customerId],
  );
  if (!ride) throw notFound('Ride not found');
  return camel(ride);
}

router.get('/mine', async (req, res) => {
  const rides = await many(
    `SELECT r.id, r.status, r.vehicle_type, r.fare_paise, r.created_at, pp.name AS pickup_name, dp.name AS drop_name
       FROM rides r JOIN places pp ON pp.id = r.pickup_place_id JOIN places dp ON dp.id = r.drop_place_id
      WHERE r.customer_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
    [req.user.id],
  );
  const seats = await many(
    `SELECT b.id, b.seats, b.fare_paise, b.status, t.departs_at, t.status AS trip_status, sr.name AS route_name,
            d.name AS driver_name, d.phone AS driver_phone
       FROM share_bookings b
       JOIN share_trips t ON t.id = b.trip_id
       JOIN share_routes sr ON sr.id = t.route_id
       JOIN users d ON d.id = t.driver_id
      WHERE b.customer_id = $1 ORDER BY t.departs_at DESC LIMIT 20`,
    [req.user.id],
  );
  res.json({ rides: camel(rides), shareBookings: camel(seats) });
});

router.get('/:id', async (req, res) => {
  res.json(await loadRide(ids(req), req.user.id));
});

router.post('/:id/cancel', async (req, res) => {
  const ride = await one(
    "UPDATE rides SET status = 'cancelled', cancel_reason = 'Cancelled by customer' WHERE id = $1 AND customer_id = $2 AND status IN ('requested', 'accepted') RETURNING *",
    [ids(req), req.user.id],
  );
  if (!ride) throw conflict('This ride can no longer be cancelled');
  if (ride.driver_id) notify(ride.driver_id, `Ride ${ride.id} was cancelled by the customer`);
  res.json(await loadRide(ride.id, req.user.id));
});

// Emergency button: creates an urgent ticket for the support team at once.
router.post('/:id/sos', async (req, res) => {
  const ride = await loadRide(ids(req), req.user.id);
  const ticket = await one(
    `INSERT INTO tickets (created_by, subject, category, ride_id, priority, channel)
     VALUES ($1, $2, 'safety', $3, 'high', 'app') RETURNING id`,
    [req.user.id, `SOS during ride ${ride.id}`, ride.id],
  );
  await query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1, $2, $3)', [
    ticket.id,
    req.user.id,
    `SOS pressed. Driver: ${ride.driverName || 'not assigned'} ${ride.driverPhone || ''}. Route: ${ride.pickupName} to ${ride.dropName}.`,
  ]);
  console.warn(`!!! SOS from user ${req.user.id} on ride ${ride.id} - ticket ${ticket.id}`);
  res.json({ ok: true, ticketId: ticket.id, message: 'Help is on the way. Our team will call you now.' });
});

// ---------------- Share autos ----------------
export const shareRouter = Router();
shareRouter.use(requireAuth, requireRole('customer'));

shareRouter.get('/routes', async (req, res) => {
  await requireService('rides');
  res.json(
    camel(
      await many(
        `SELECT sr.id, sr.name, sr.fare_per_seat_paise, fp.name AS from_name, tp.name AS to_name
           FROM share_routes sr JOIN places fp ON fp.id = sr.from_place_id JOIN places tp ON tp.id = sr.to_place_id
          WHERE sr.is_active ORDER BY sr.name`,
      ),
    ),
  );
});

// Upcoming departures with free seats: ?routeId=1
shareRouter.get('/trips', async (req, res) => {
  await requireService('rides');
  const q = parse(z.object({ routeId: z.coerce.number().int().positive().optional() }), req.query);
  const rows = await many(
    `SELECT t.id, t.departs_at, t.seats_total, t.status, sr.name AS route_name, sr.fare_per_seat_paise,
            d.name AS driver_name, ps.vehicle_no,
            t.seats_total - t.walkins - COALESCE((SELECT SUM(seats) FROM share_bookings b WHERE b.trip_id = t.id AND b.status = 'booked'), 0) AS seats_free
       FROM share_trips t
       JOIN share_routes sr ON sr.id = t.route_id
       JOIN users d ON d.id = t.driver_id
       LEFT JOIN partner_status ps ON ps.user_id = t.driver_id
      WHERE t.status = 'scheduled' AND t.departs_at > now() - interval '10 minutes'
        AND ($1::int IS NULL OR t.route_id = $1)
      ORDER BY t.departs_at LIMIT 20`,
    [q.routeId ?? null],
  );
  res.json(camel(rows));
});

shareRouter.post('/trips/:id/book', async (req, res) => {
  await requireService('rides');
  const b = parse(z.object({ seats: z.coerce.number().int().min(1).max(4), paymentMethod: z.enum(['cash', 'upi']).default('cash') }), req.body);
  const tripId = ids(req);
  const booking = await tx(async (db) => {
    // Lock the trip row so two people can't grab the last seat at the same moment.
    const trip = await db.one(
      `SELECT t.*, sr.fare_per_seat_paise FROM share_trips t JOIN share_routes sr ON sr.id = t.route_id WHERE t.id = $1 FOR UPDATE OF t`,
      [tripId],
    );
    if (!trip || trip.status !== 'scheduled') throw notFound('This departure is not available');
    const taken = await db.one("SELECT COALESCE(SUM(seats), 0)::int AS n FROM share_bookings WHERE trip_id = $1 AND status = 'booked'", [tripId]);
    const free = trip.seats_total - trip.walkins - taken.n;
    if (b.seats > free) throw conflict(free > 0 ? `Only ${free} seat(s) left` : 'This auto is full');
    return db.one(
      `INSERT INTO share_bookings (trip_id, customer_id, seats, fare_paise, payment_method)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tripId, req.user.id, b.seats, b.seats * trip.fare_per_seat_paise, b.paymentMethod],
    );
  });
  res.status(201).json(camel(booking));
});

shareRouter.post('/bookings/:id/cancel', async (req, res) => {
  const row = await one(
    `UPDATE share_bookings b SET status = 'cancelled'
       FROM share_trips t
      WHERE b.id = $1 AND b.customer_id = $2 AND b.status = 'booked' AND t.id = b.trip_id AND t.status = 'scheduled'
      RETURNING b.*`,
    [ids(req), req.user.id],
  );
  if (!row) throw conflict('This booking can no longer be cancelled');
  res.json(camel(row));
});

export default router;
