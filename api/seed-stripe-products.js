import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  try {

    // 1️⃣ Delete previously created Stripe products
    const existing = await stripe.products.list({ limit: 100 });

    for (const product of existing.data) {
      await stripe.products.del(product.id);
    }

    // 2️⃣ Fetch Firestore products
    const snapshot = await db.collection("products").get();

    const results = [];

    for (const doc of snapshot.docs) {

      const p = doc.data();

      const stripeProduct = await stripe.products.create({
        name: p.title,
        images: p.image ? [p.image] : [],
        metadata: {
          firestoreId: doc.id
        }
      });

      const price = await stripe.prices.create({
        unit_amount: Math.round(p.price * 100),
        currency: "usd",
        product: stripeProduct.id
      });

      await doc.ref.update({
        stripeProductId: stripeProduct.id,
        stripePriceId: price.id
      });

      results.push({
        firestoreId: doc.id,
        stripeProductId: stripeProduct.id,
        stripePriceId: price.id
      });
    }

    res.status(200).json({
      message: "Stripe catalog reset and recreated",
      created: results.length,
      results
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
