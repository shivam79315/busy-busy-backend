import { buffer } from "micro";
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

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    await db.collection("orders").add({
      userId: session.metadata.userId,
      amount: session.amount_total,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sessionId: session.id,
      paymentStatus: session.payment_status,
    });

    const userId = session.metadata.userId;

    // Delete all cart items under users/{uid}/cart
    const cartRef = db
    .collection("users")
    .doc(userId)
    .collection("cart");

    const snapshot = await cartRef.get();

    const batch = db.batch();

    snapshot.forEach((doc) => {
    batch.delete(doc.ref);
    });

    await batch.commit();
  }

  res.json({ received: true });
}