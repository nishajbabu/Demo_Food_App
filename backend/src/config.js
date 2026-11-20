// All settings come from environment variables (the .env file on your laptop,
// or the "Environment" page on your hosting provider). Nothing secret lives in code.
import 'dotenv/config';

const bool = (v, fallback = false) =>
  v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const int = (v, fallback) => (v === undefined || v === '' ? fallback : parseInt(v, 10));

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProduction: env === 'production',
  port: int(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:gaongo@localhost:5433/gaongo',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  timezone: 'Asia/Kolkata',

  otp: {
    devMode: bool(process.env.OTP_DEV_MODE, env !== 'production'),
    digits: 6,
    ttlMinutes: 5,
    maxAttempts: 5,
    resendSeconds: int(process.env.OTP_RESEND_SECONDS, 30),
  },

  sms: {
    provider: process.env.SMS_PROVIDER || 'console',
    httpUrl: process.env.SMS_HTTP_URL || '',
    httpToken: process.env.SMS_HTTP_TOKEN || '',
    senderId: process.env.SMS_SENDER_ID || 'GAONGO',
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  money: {
    deliveryFeePaise: int(process.env.DELIVERY_FEE_PAISE, 2000),
    freeDeliveryAbovePaise: int(process.env.FREE_DELIVERY_ABOVE_PAISE, 19900),
    riderPayPerDeliveryPaise: int(process.env.RIDER_PAY_PER_DELIVERY_PAISE, 3500),
    driverDailyPassPaise: int(process.env.DRIVER_DAILY_PASS_PAISE, 2500),
  },

  rules: {
    maxActiveOrdersPerRider: int(process.env.MAX_ACTIVE_ORDERS_PER_RIDER, 2),
    // Customers can change tomorrow's milk until this hour (24h clock, India time).
    subscriptionCutoffHour: int(process.env.SUBSCRIPTION_CUTOFF_HOUR, 21),
    requireDriverPass: bool(process.env.REQUIRE_DRIVER_PASS, false),
    roadFactor: 1.3, // straight-line km x 1.3 is a fair guess of road km in villages
  },

  support: {
    phone: process.env.SUPPORT_PHONE || '',
    whatsapp: process.env.SUPPORT_WHATSAPP || '',
  },

  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
};

// Refuse to start production with unsafe settings.
if (config.isProduction) {
  const problems = [];
  if (config.jwtSecret === 'dev-only-change-me' || config.jwtSecret.length < 32) problems.push('JWT_SECRET must be a long random value');
  if (config.otp.devMode) problems.push('OTP_DEV_MODE must be false');
  if (config.sms.provider === 'console') problems.push('SMS_PROVIDER must be a real provider, not console');
  if (problems.length) {
    console.error('Unsafe production settings:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}
