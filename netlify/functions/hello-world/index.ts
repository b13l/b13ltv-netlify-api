import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fetch from "node-fetch";

// 🔐 Inicialização segura do Firebase
let db;

if (!getApps().length) {
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  };

  const app = initializeApp({
    credential: cert(serviceAccount),
  });

  db = getFirestore(app);
} else {
  db = getFirestore();
}

// 🛒 Mercado Pago / WhatsApp tokens
const mercadoPagoAccessToken =
  process.env.MP_ACCESS_TOKEN || process.env.MP_TEST_ACCESS_TOKEN;
const whatsappPhoneId = process.env.WHATSAPP_PHONE_ID;
const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;

// 🔢 Geração de PIN aleatório
function generatePin(): string {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

// 🚀 Função principal
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const payload = JSON.parse(event.body);

    if (
      payload.action === "payment.created" ||
      payload.action === "payment.updated" ||
      payload.topic === "payment"
    ) {
      const paymentId = payload.data.id;

      // 🔍 Consulta o pagamento no Mercado Pago
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${mercadoPagoAccessToken}`,
        },
      });

      if (!mpRes.ok) {
        const err = await mpRes.json();
        console.error("❌ Erro ao consultar pagamento:", err);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Erro ao consultar pagamento no Mercado Pago" }),
        };
      }

      const paymentStatus = await mpRes.json();

      // ✅ Verifica se o pagamento foi aprovado
      if (paymentStatus.status === "approved") {
        // 🔒 Verifica se o telefone está disponível
        const customerPhoneNumber = paymentStatus?.payer?.phone?.number;

        if (!customerPhoneNumber) {
          console.warn("⚠️ Telefone não disponível:", paymentStatus.payer);
          return {
            statusCode: 400,
            body: JSON.stringify({ error: "Número de telefone não encontrado no pagamento." }),
          };
        }

        // 🎟️ Gera e salva o PIN
        const pin = generatePin();
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30);

        await db.collection("pins").doc(pin).set({
          pin,
          expirationDate,
          isActive: true,
          mercadoPagoPaymentId: paymentId,
        });

        console.log(`✅ PIN ${pin} gerado e salvo.`);

        // 📲 Envia mensagem via WhatsApp
        const whatsappPayload = {
          messaging_product: "whatsapp",
          to: customerPhoneNumber,
          type: "text",
          text: {
            body: `Seu PIN B13L TV é: ${pin}. O PIN tem validade de 30 dias.`,
          },
        };

        await fetch(`https://graph.facebook.com/v16.0/${whatsappPhoneId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${whatsappAccessToken}`,
          },
          body: JSON.stringify(whatsappPayload),
        });

        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, message: "PIN gerado e enviado com sucesso" }),
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Notificação ignorada" }),
    };
  } catch (error: any) {
    console.error("❌ Erro interno:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Erro interno" }),
    };
  }
};
