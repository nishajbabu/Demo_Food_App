-- =====================================================================
-- GaonGo database schema (PostgreSQL 14 or newer)
--
-- Read this file top to bottom to understand everything GaonGo stores.
-- Money is always stored in PAISE as whole numbers (Rs 1 = 100 paise),
-- so there are never rounding errors.
--
-- Apply it with:   npm run db:migrate      (safe to run again and again)
-- Start over with: npm run db:reset        (DELETES all data, local only)
-- =====================================================================

-- Switches the team can change without a new app release, e.g. which services are live.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Villages, grouped into clusters. Riders and drivers serve every village in their cluster.
CREATE TABLE IF NOT EXISTS villages (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  cluster    TEXT NOT NULL,
  district   TEXT,
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Well-known spots used for ride pickups and drops: chowk, bus stand, school, temple...
CREATE TABLE IF NOT EXISTS places (
  id         SERIAL PRIMARY KEY,
  village_id INT NOT NULL REFERENCES villages(id),
  name       TEXT NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL
);

-- Everyone who logs in: customers, shop owners, riders, drivers, support staff, admins.
CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  phone      TEXT NOT NULL UNIQUE,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'customer'
             CHECK (role IN ('customer', 'merchant', 'rider', 'driver', 'support', 'admin')),
  village_id INT REFERENCES villages(id),
  landmark   TEXT,                       -- "House 23, blue gate opposite the hand pump"
  language   TEXT NOT NULL DEFAULT 'en', -- 'en' or 'hi'
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time login codes (stored hashed, never in plain text).
CREATE TABLE IF NOT EXISTS otp_codes (
  phone      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shops: dhabas (food), kirana stores (grocery) and dairies.
CREATE TABLE IF NOT EXISTS merchants (
  id             BIGSERIAL PRIMARY KEY,
  owner_id       BIGINT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('food', 'grocery', 'dairy')),
  village_id     INT NOT NULL REFERENCES villages(id),
  landmark       TEXT,
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION,
  description    TEXT,
  is_open        BOOLEAN NOT NULL DEFAULT TRUE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
  fssai_no       TEXT,
  gst_no         TEXT,
  commission_pct NUMERIC(5, 2) NOT NULL DEFAULT 5,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchants_owner_idx ON merchants (owner_id);

-- What each shop sells. is_subscribable = can be delivered daily/weekly (milk, curd, sabzi basket).
CREATE TABLE IF NOT EXISTS products (
  id              BIGSERIAL PRIMARY KEY,
  merchant_id     BIGINT NOT NULL REFERENCES merchants(id),
  name            TEXT NOT NULL,
  name_hi         TEXT,
  name_ta         TEXT,
  description     TEXT,
  unit            TEXT NOT NULL DEFAULT 'piece', -- "1 kg", "litre", "plate"
  category        TEXT,
  price_paise     INT NOT NULL CHECK (price_paise >= 0),
  is_veg          BOOLEAN,
  is_subscribable BOOLEAN NOT NULL DEFAULT FALSE,
  in_stock        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_merchant_idx ON products (merchant_id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS name_ta TEXT;

-- Live status of riders and drivers: online or not, vehicle, last known location.
CREATE TABLE IF NOT EXISTS partner_status (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id),
  online       BOOLEAN NOT NULL DEFAULT FALSE,
  vehicle_type TEXT CHECK (vehicle_type IN ('bike', 'auto', 'erick', 'cab')),
  vehicle_no   TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Food and grocery orders.
--   placed -> accepted (shop) -> ready (shop) -> picked_up (rider) -> delivered (rider, with OTP)
--   placed -> rejected (shop)      placed/accepted -> cancelled (customer or support)
CREATE TABLE IF NOT EXISTS orders (
  id                   BIGSERIAL PRIMARY KEY,
  customer_id          BIGINT NOT NULL REFERENCES users(id),
  merchant_id          BIGINT NOT NULL REFERENCES merchants(id),
  rider_id             BIGINT REFERENCES users(id),
  village_id           INT NOT NULL REFERENCES villages(id),
  service              TEXT NOT NULL CHECK (service IN ('food', 'grocery')),
  status               TEXT NOT NULL DEFAULT 'placed'
                       CHECK (status IN ('awaiting_payment', 'placed', 'accepted', 'ready', 'picked_up', 'delivered', 'cancelled', 'rejected')),
  address_text         TEXT NOT NULL,
  note                 TEXT,
  items_total_paise    INT NOT NULL,
  delivery_fee_paise   INT NOT NULL DEFAULT 0,
  total_paise          INT NOT NULL,
  payment_method       TEXT NOT NULL CHECK (payment_method IN ('cod', 'upi')),
  payment_status       TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded')),
  delivery_otp         TEXT NOT NULL, -- customer tells this to the rider at the door
  pickup_code          TEXT NOT NULL, -- rider tells this to the shop
  cash_collected_paise INT NOT NULL DEFAULT 0,
  cancel_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at          TIMESTAMPTZ,
  ready_at             TIMESTAMPTZ,
  picked_up_at         TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_merchant_idx ON orders (merchant_id, status);
CREATE INDEX IF NOT EXISTS orders_rider_idx ON orders (rider_id, status);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('awaiting_payment', 'placed', 'accepted', 'ready', 'picked_up', 'delivered', 'cancelled', 'rejected'));

CREATE TABLE IF NOT EXISTS order_items (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id),
  product_id  BIGINT NOT NULL REFERENCES products(id),
  name        TEXT NOT NULL,       -- copied at order time, so later price/name edits don't change old orders
  unit        TEXT,
  price_paise INT NOT NULL,
  qty         INT NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- Every status change, for the tracking screen and for settling disputes.
CREATE TABLE IF NOT EXISTS order_events (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES orders(id),
  status     TEXT NOT NULL,
  actor_id   BIGINT REFERENCES users(id),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id);

-- Milk / curd / sabzi-basket subscriptions.
CREATE TABLE IF NOT EXISTS subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES users(id),
  merchant_id  BIGINT NOT NULL REFERENCES merchants(id),
  product_id   BIGINT NOT NULL REFERENCES products(id),
  qty          NUMERIC(6, 2) NOT NULL CHECK (qty > 0), -- 1.5 litres is allowed
  frequency    TEXT NOT NULL CHECK (frequency IN ('daily', 'alternate', 'weekly')),
  slot         TEXT NOT NULL DEFAULT 'morning' CHECK (slot IN ('morning', 'evening')),
  start_date   DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  address_text TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_merchant_idx ON subscriptions (merchant_id, status);

-- Days the customer said "don't deliver".
CREATE TABLE IF NOT EXISTS subscription_skips (
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id),
  skip_date       DATE NOT NULL,
  PRIMARY KEY (subscription_id, skip_date)
);

-- One row per subscription per delivery day; this is the dairy's delivery sheet and the monthly bill.
CREATE TABLE IF NOT EXISTS subscription_deliveries (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT NOT NULL REFERENCES subscriptions(id),
  delivery_date    DATE NOT NULL,
  qty              NUMERIC(6, 2) NOT NULL,
  unit_price_paise INT NOT NULL,
  amount_paise     INT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'delivered', 'missed')),
  delivered_at     TIMESTAMPTZ,
  UNIQUE (subscription_id, delivery_date)
);
CREATE INDEX IF NOT EXISTS subscription_deliveries_date_idx ON subscription_deliveries (delivery_date);

-- Month-end payments from a home to a dairy (cash to the milkman, or UPI).
CREATE TABLE IF NOT EXISTS subscription_payments (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES users(id),
  merchant_id  BIGINT NOT NULL REFERENCES merchants(id),
  month        TEXT NOT NULL, -- '2026-11'
  amount_paise INT NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash', 'upi')),
  recorded_by  BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ride prices per vehicle type. Fare = max(minimum, base + per_km x road km).
CREATE TABLE IF NOT EXISTS ride_fares (
  vehicle_type TEXT PRIMARY KEY CHECK (vehicle_type IN ('bike', 'auto', 'erick', 'cab')),
  label        TEXT NOT NULL,
  base_paise   INT NOT NULL,
  per_km_paise INT NOT NULL,
  min_paise    INT NOT NULL,
  seats        INT NOT NULL
);

-- Private rides: bike taxi, full auto, e-rickshaw, cab.
--   requested -> accepted (driver) -> started (driver, with customer's OTP) -> completed
CREATE TABLE IF NOT EXISTS rides (
  id              BIGSERIAL PRIMARY KEY,
  customer_id     BIGINT NOT NULL REFERENCES users(id),
  driver_id       BIGINT REFERENCES users(id),
  vehicle_type    TEXT NOT NULL REFERENCES ride_fares(vehicle_type),
  pickup_place_id INT NOT NULL REFERENCES places(id),
  drop_place_id   INT NOT NULL REFERENCES places(id),
  distance_km     NUMERIC(6, 1) NOT NULL,
  fare_paise      INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'accepted', 'started', 'completed', 'cancelled')),
  ride_otp        TEXT NOT NULL,
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi')),
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides (status);

-- Share autos run fixed routes at fixed times; customers book seats.
CREATE TABLE IF NOT EXISTS share_routes (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  from_place_id       INT NOT NULL REFERENCES places(id),
  to_place_id         INT NOT NULL REFERENCES places(id),
  fare_per_seat_paise INT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS share_trips (
  id          BIGSERIAL PRIMARY KEY,
  route_id    INT NOT NULL REFERENCES share_routes(id),
  driver_id   BIGINT NOT NULL REFERENCES users(id),
  departs_at  TIMESTAMPTZ NOT NULL,
  seats_total INT NOT NULL CHECK (seats_total BETWEEN 1 AND 12),
  walkins     INT NOT NULL DEFAULT 0 CHECK (walkins >= 0), -- passengers who got in without the app
  status      TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'started', 'completed', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_bookings (
  id             BIGSERIAL PRIMARY KEY,
  trip_id        BIGINT NOT NULL REFERENCES share_trips(id),
  customer_id    BIGINT NOT NULL REFERENCES users(id),
  seats          INT NOT NULL CHECK (seats BETWEEN 1 AND 4),
  fare_paise     INT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi')),
  status         TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drivers pay a flat daily pass instead of a commission on every ride.
CREATE TABLE IF NOT EXISTS driver_passes (
  id           BIGSERIAL PRIMARY KEY,
  driver_id    BIGINT NOT NULL REFERENCES users(id),
  pass_date    DATE NOT NULL,
  amount_paise INT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, pass_date)
);

-- Support tickets from the apps, or logged by staff after a phone call / WhatsApp message.
CREATE TABLE IF NOT EXISTS tickets (
  id          BIGSERIAL PRIMARY KEY,
  created_by  BIGINT NOT NULL REFERENCES users(id),
  subject     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other'
              CHECK (category IN ('order', 'subscription', 'ride', 'payment', 'partner', 'safety', 'other')),
  order_id    BIGINT REFERENCES orders(id),
  ride_id     BIGINT REFERENCES rides(id),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  channel     TEXT NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'phone', 'whatsapp')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id         BIGSERIAL PRIMARY KEY,
  ticket_id  BIGINT NOT NULL REFERENCES tickets(id),
  author_id  BIGINT NOT NULL REFERENCES users(id),
  is_staff   BOOLEAN NOT NULL DEFAULT FALSE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Refunds approved by support. Money goes back by UPI or cash, recorded here.
CREATE TABLE IF NOT EXISTS refunds (
  id           BIGSERIAL PRIMARY KEY,
  order_id     BIGINT NOT NULL REFERENCES orders(id),
  amount_paise INT NOT NULL CHECK (amount_paise > 0),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'done')),
  created_by   BIGINT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cash a rider hands over to the hub at the end of the day.
CREATE TABLE IF NOT EXISTS cash_settlements (
  id           BIGSERIAL PRIMARY KEY,
  rider_id     BIGINT NOT NULL REFERENCES users(id),
  amount_paise INT NOT NULL CHECK (amount_paise > 0),
  settled_by   BIGINT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Online payment attempts (Razorpay payment links).
CREATE TABLE IF NOT EXISTS payments (
  id           BIGSERIAL PRIMARY KEY,
  order_id     BIGINT NOT NULL REFERENCES orders(id),
  provider     TEXT NOT NULL,
  provider_ref TEXT NOT NULL UNIQUE,
  amount_paise INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expo push notification tokens (one user can have tokens on multiple devices).
CREATE TABLE IF NOT EXISTS push_tokens (
  token      TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON push_tokens (user_id);