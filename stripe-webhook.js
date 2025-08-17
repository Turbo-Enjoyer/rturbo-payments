// /api/stripe-webhook.js
const Stripe = require("stripe");
const admin = require("firebase-admin");
const getRawBody = require("raw-body");

const stripe = new Stripe(process.env.STRIPE_API_KEY);

if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const db = admin.database();

function isValidSteamID32(s) {
  return typeof s === "string" && /^[1-9]\d{0,15}$/.test(s);
}

async function creditTokensIdempotent(eventId, steamid32, tokens) {
  if (tokens <= 0) return;
  const seen = await db.ref(`stripe_events/${eventId}`).get();
  if (seen.exists()) return; // already processed
  await db.ref("/").update({
    [`stripe_events/${eventId}`]: admin.database.ServerValue.TIMESTAMP,
    [`tokens/${steamid32}`]: admin.database.ServerValue.increment(tokens)
  });
}

async function tokensFromSession(session) {
  const override = parseInt(session?.metadata?.tokens, 10);
  if (Number.isFinite(override) && override > 0) return override;

  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"]
  });
  let qty = 0;
  for (const li of expanded.line_items?.data || []) {
    qty += parseInt(li.quantity, 10) || 0;
  }
  return Math.max(1, qty || 1);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Missing STRIPE_WEBHOOK_SECRET");
    return res.status(500).send("Webhook not configured");
  }

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe signature verification failed:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      if (s.payment_status === "paid") {
        const steamid32 = s?.metadata?.steamid32 || s?.client_reference_id || "";
        if (!isValidSteamID32(steamid32)) {
          console.warn("Missing/invalid steamid32 for session", s.id);
        } else {
          const tokens = await tokensFromSession(s);
          await creditTokensIdempotent(event.id, steamid32, tokens);
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("webhook handler error:", err);
    return res.status(500).send("Internal error");
  }
};
