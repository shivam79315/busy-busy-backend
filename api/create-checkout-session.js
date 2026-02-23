import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { items } = req.body;

    const line_items = [];

    for (const item of items) {
      // Fetch product from Stripe
      const product = await stripe.products.retrieve(item.productId);

      // Get default price ID
      const priceId = product.default_price;

      if (!priceId) {
        return res.status(400).json({
          error: `No default price found for product ${item.productId}`,
        });
      }

      line_items.push({
        price: priceId,
        quantity: item.quantity,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      success_url: `${req.headers.origin}/success`,
      cancel_url: `${req.headers.origin}/cart`,
    });

    res.status(200).json({ url: session.url });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
