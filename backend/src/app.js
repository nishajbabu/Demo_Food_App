// The web server: which URL goes to which piece of code.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import orderRoutes from './routes/orders.js';
import merchantRoutes from './routes/merchant.js';
import riderRoutes from './routes/rider.js';
import subscriptionRoutes from './routes/subscriptions.js';
import rideRoutes, { shareRouter } from './routes/rides.js';
import driverRoutes from './routes/driver.js';
import supportRoutes from './routes/support.js';
import adminRoutes from './routes/admin.js';
import { razorpayWebhook } from './routes/payments.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins }));

  // The payment webhook needs the raw body to check Razorpay's signature, so it comes first.
  app.post('/payments/razorpay/webhook', express.raw({ type: '*/*', limit: '1mb' }), razorpayWebhook);

  app.use(express.json({ limit: '200kb' }));
  if (config.env === 'development') app.use(morgan('dev'));

  const skipTest = () => config.env === 'test';
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 200,
      skip: skipTest,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please slow down.' },
    }),
  );
  const otpLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 15,
    skip: skipTest,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please wait 15 minutes.' },
  });
  const orderLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    skip: skipTest,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many orders placed. Please wait a few minutes.' },
  });

  app.get('/', (req, res) => res.json({ name: 'GaonGo API', ok: true }));
  app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/auth/request-otp', otpLimiter);
  app.use('/auth/verify-otp', otpLimiter);
  app.use('/auth', authRoutes); //           login with OTP
  app.use('/', catalogRoutes); //            /config /villages /merchants /search /places
  app.use('/orders', orderLimiter, orderRoutes); // customer: food & grocery orders
  app.use('/subscriptions', subscriptionRoutes); // customer: milk & sabzi
  app.use('/rides', rideRoutes); //          customer: private rides
  app.use('/share', shareRouter); //         customer: share-auto seats
  app.use('/support', supportRoutes); //     everyone: help tickets
  app.use('/merchant', merchantRoutes); //   shop owners
  app.use('/rider', riderRoutes); //         delivery riders
  app.use('/driver', driverRoutes); //       auto / cab drivers
  app.use('/admin', adminRoutes); //         operations & support team

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}