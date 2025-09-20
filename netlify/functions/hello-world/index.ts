const fetch = require("node-fetch");
const admin = require("firebase-admin");

// Inicializa o Firebase apenas uma vez
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// Função para gerar PIN aleatório
function generatePin() {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

exports.handler = async function (event, context) {
  // ✅ Permite debug pelo navegador
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      body: "✅ Webhook ativo. Use POST para enviar notificações.",
    };
  }

  // ❌ Rejeita métodos que não sejam POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    console.log("🔔 Webhook recebido");

    const payload = JSON.parse(event.body);
    console.log("📦 Payload recebido:", payload);

    // Verifica se é notificação de pagamento
    if (payload.topic === "payment") {
      const paymentId = payload.data.id;
      console.log("🔍 Consultando pagamento:", paymentId);

      // Consulta o status real do pagamento no Mercado Pago
      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        },
      });

      const paymentStatus = await mpResponse.json();
      console.log("📄 Dados do pagamento:", paymentStatus);

      const customerPhoneNumber = paymentStatus.payer?.phone?.number;

      if (paymentStatus.status === "approved") {
        const pin = generatePin();
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30); // 30 dias

        // Salva no Firestore
        await db.collection("pins").doc(pin).set({
          pin,
          expirationDate,
          isActive: true,
          mercadoPagoPaymentId: paymentId,
        });

        console.log(`✅ PIN ${pin} salvo no Firestore`);

        // Envia via WhatsApp
        const whatsappPayload = {
          messaging_product: "whatsapp",
          to: customerPhoneNumber,
          type: "text",
          text: {
            body: `Seu PIN B13L TV é: ${pin}. O PIN tem validade de 30 dias.`,
          },
        };

        const waResponse = await fetch(`https://graph.facebook.com/v16.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          },
          body: JSON.stringify(whatsappPayload),
        });

        const waResult = await waResponse.json();
        console.log("📤 WhatsApp enviado:", waResult);

        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, message: "PIN gerado e WhatsApp enviado" }),
        };
      } else {
        console.log("⚠️ Pagamento não aprovado:", paymentStatus.status);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Notificação recebida, sem ação necessária" }),
    };
  } catch (error) {
    console.error("❌ Erro:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
