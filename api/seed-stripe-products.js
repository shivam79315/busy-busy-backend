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
    const preview = req.query.preview === "true";

    const snapshot = await db.collection("products").get();

    const products = snapshot.docs.map((doc) => ({
      id: doc.id,
      title: doc.data().title,
      price: doc.data().price
    }));

    // PREVIEW MODE (no Stripe calls)
    if (preview) {
      return res.status(200).json({
        preview: true,
        count: products.length,
        products
      });
    }

    // SEED MODE
    const results = [];

    for (const doc of snapshot.docs) {
      const product = doc.data();

      const stripeProduct = await stripe.products.create({
        name: product.title,
        images: product.image ? [product.image] : [],
        metadata: {
          firestoreId: doc.id
        }
      });

      const price = await stripe.prices.create({
        unit_amount: Math.round(product.price * 100),
        currency: "usd",
        product: stripeProduct.id
      });

      await doc.ref.update({
        stripeProductId: stripeProduct.id,
        stripePriceId: price.id
      });

      results.push({
        firestoreProduct: doc.id,
        stripeProductId: stripeProduct.id,
        stripePriceId: price.id
      });
    }

    res.status(200).json({
      message: "Stripe products created successfully",
      created: results.length,
      results
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
}
