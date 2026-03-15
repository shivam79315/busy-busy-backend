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

    const userId = session.metadata.userId;
    const items = JSON.parse(session.metadata.items);
    const shippingAddress = session.metadata.shippingAddress;

    // ---------------------------
    // CREATE ORDER
    // ---------------------------
    await db
      .collection("users")
      .doc(userId)
      .collection("orders")
      .add({
        items,
        shippingAddress,
        amount: session.amount_total,
        sessionId: session.id,
        paymentStatus: session.payment_status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // ---------------------------
    // CLEAR USER CART
    // ---------------------------
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

    // ---------------------------
    // SEND EMAIL
    // ---------------------------
    const emailPayload = {
      email: session.customer_details.email,
      customerName: session.customer_details.name || "Customer",
      orderId: session.id,
      amount: session.amount_total / 100,
      shippingAddress,
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price
      }))
    };

    try {

      await fetch(
        "https://busy-busy-auto.onrender.com/api/email/order-confirmation",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(emailPayload)
        }
      );

    } catch (err) {
      console.error("Email sending failed:", err);
    }

  }

  res.json({ received: true });
}
