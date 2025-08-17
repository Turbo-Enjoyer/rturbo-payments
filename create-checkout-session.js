// /api/create-checkout-session.js
const Stripe = require("stripe");

const PRICE_ID = "price_1Rx0ZoBmp1Jsxtu5uOwQrOk6";
const SUCCESS_URL = "https://turboenjoyerproductions.my.canva.site/";
const CANCEL_URL = "https://www.youtube.com/watch?v=m1kkTl7KKYI&t=3s";

const stripe = new Stripe(process.env.STRIPE_API_KEY);

function isValidSteamID32(s) {
  return typeof s === "string" && /^[1-9]\d{0,15}$/.test(s);
}

async function readJson(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = await readJson(req);
    const steamid32 = String(body.steamid32 || "");
    const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);

    if (!isValidSteamID32(steamid32)) {
      return res.status(400).json({ error: "Invalid steamid32" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: PRICE_ID, quantity }],
      metadata: { steamid32, tokens: String(quantity) }, // auto attach
      client_reference_id: steamid32,                     // secondary place
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      allow_promotion_codes: true
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};
