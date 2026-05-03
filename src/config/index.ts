import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type SubscriptionPlanId = 'monthly' | 'quarterly' | 'yearly';

export interface SubscriptionPlan {
  id: SubscriptionPlanId;
  label: string;
  pricePaise: number;
  durationDays: number;
}

// Env overrides → price per plan in paise. Fall back to sensible defaults.
// Backward-compat: `SUBSCRIPTION_PRICE_PAISE` (pre-tiered config) maps to monthly.
const legacyMonthlyPrice = Number(process.env.SUBSCRIPTION_PRICE_PAISE) || null;

const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'monthly',
    label: 'Monthly',
    pricePaise:
      Number(process.env.SUBSCRIPTION_PRICE_MONTHLY_PAISE) ||
      legacyMonthlyPrice ||
      49900, // ₹499
    durationDays: 30,
  },
  {
    id: 'quarterly',
    label: 'Quarterly',
    pricePaise: Number(process.env.SUBSCRIPTION_PRICE_QUARTERLY_PAISE) || 219900, // ₹2,199
    durationDays: 90,
  },
  {
    id: 'yearly',
    label: 'Yearly',
    pricePaise: Number(process.env.SUBSCRIPTION_PRICE_YEARLY_PAISE) || 699900, // ₹6,999
    durationDays: 365,
  },
];

export const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  db: {
    url: process.env.DATABASE_URL || '',
    ssl: process.env.DATABASE_SSL !== 'false',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  bcrypt: {
    saltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
  },
  trial: {
    days: Number(process.env.TRIAL_DAYS) || 15,
  },
  referral: {
    // Days added to the referrer's trial when a referee finishes ₹1 verification.
    // Stacked on top of the base trial → typical referrer ends up at 15 + 15 = 30d.
    rewardDays: Number(process.env.REFERRAL_REWARD_DAYS) || 15,
  },
  admin: {
    // Comma-separated list of emails treated as admin even without the DB flag.
    // Useful for bootstrap; promoted admins can be added via `users.is_admin = true`.
    emails: (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },
  subscription: {
    currency: process.env.SUBSCRIPTION_CURRENCY || 'INR',
    plans: subscriptionPlans,
  },
  verification: {
    // Micro-charge used as a spam filter at signup. Keeps cost-per-abuser
    // above zero and makes email recycling economically unattractive.
    pricePaise: Number(process.env.VERIFICATION_PRICE_PAISE) || 100, // ₹1
    currency: process.env.SUBSCRIPTION_CURRENCY || 'INR',
    planId: 'verification',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    // Must be a verified sender on Resend, otherwise sends will fail.
    from: process.env.EMAIL_FROM || 'DocGen <docgensupport@gmail.com>',
  },
  googleAuth: {
    // Master kill-switch. When false, /auth/google + /auth/config gate the
    // feature off so the frontend never renders a Google button.
    enabled: process.env.ENABLE_GOOGLE_AUTH === 'true',
    // ONLY the public client_id — the audience we verify ID tokens against.
    // The OAuth client_secret is NOT used for ID-token sign-in and must
    // never be set here.
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },
  passwordReset: {
    // Short-lived by design. 30 min is the sweet spot for email-based flows.
    ttlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30,
  },
  // ─── Seller block (shown on every invoice) ────────────────────────────────
  // Fill these via env once the legal entity + GST registration are in place.
  // Today: unregistered startup → Bill of Supply; no GST breakdown.
  seller: {
    legalName: process.env.SELLER_LEGAL_NAME || 'DocGen',
    addressLine1: process.env.SELLER_ADDRESS_LINE1 || 'Hyderabad',
    addressLine2: process.env.SELLER_ADDRESS_LINE2 || 'Telangana, India',
    city: process.env.SELLER_CITY || 'Hyderabad',
    state: process.env.SELLER_STATE || 'Telangana',
    country: process.env.SELLER_COUNTRY || 'India',
    pincode: process.env.SELLER_PINCODE || '',
    email: process.env.SELLER_EMAIL || 'docgensupport@gmail.com',
    phone: process.env.SELLER_PHONE || '',
    website: process.env.SELLER_WEBSITE || 'docgen.in',
    pan: process.env.SELLER_PAN || '', // e.g. AAAPL1234C
    gstin: process.env.SELLER_GSTIN || '', // empty → unregistered (Bill of Supply)
    invoicePrefix: process.env.INVOICE_PREFIX || 'DW',
  },
};

export function findPlan(id: string): SubscriptionPlan | null {
  return config.subscription.plans.find((p) => p.id === id) ?? null;
}

export function assertProductionSecrets() {
  if (config.nodeEnv !== 'production') return;
  for (const [path, value] of [
    ['DATABASE_URL', config.db.url],
    ['JWT_ACCESS_SECRET', config.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', config.jwt.refreshSecret],
    ['RAZORPAY_KEY_ID', config.razorpay.keyId],
    ['RAZORPAY_KEY_SECRET', config.razorpay.keySecret],
    ['RAZORPAY_WEBHOOK_SECRET', config.razorpay.webhookSecret],
  ] as const) {
    if (!value || value.includes('change-me')) required(path);
  }
  // If Google auth is turned on, the client_id is mandatory — without it we
  // can't verify ID tokens, and we'd silently authenticate nobody.
  if (config.googleAuth.enabled && !config.googleAuth.clientId) {
    throw new Error(
      'ENABLE_GOOGLE_AUTH=true but GOOGLE_CLIENT_ID is not set',
    );
  }
}
