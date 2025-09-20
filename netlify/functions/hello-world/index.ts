const fetch = require("node-fetch");
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

function generatePin() {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const payload = JSON.parse(event.body);

    if (payload.topic === "payment") {
      const paymentId = payload.data.id;

      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        },
      });

      const paymentStatus = await mpResponse.json();
      const customerPhoneNumber = paymentStatus.payer.phone.number;

      if (paymentStatus.status === "approved") {
        const pin = generatePin();
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30);

        await db.collection("pins").doc(pin).set({
          pin: pin,
          expirationDate: expirationDate,
          isActive: true,
          mercadoPagoPaymentId: paymentId,
        });

        const whatsappPayload = {
          messaging_product: "whatsapp",
          to: customerPhoneNumber,
          type: "text",
          text: {
            body: `Seu PIN B13L TV é: ${pin}. O PIN tem validade de 30 dias.`,
          },
        };

        await fetch(`https://graph.facebook.com/v16.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          },
          body: JSON.stringify(whatsappPayload),
        });

        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, message: "PIN gerado e enviado" }),
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Notificação ignorada" }),
    };
  } catch (error) {
    console.error("Erro:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
