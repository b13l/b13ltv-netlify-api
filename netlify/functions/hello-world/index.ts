import { Handler } from "@netlify/functions";
import fetch from "node-fetch";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN!;

async function getPayment(paymentId: string) {
  console.log("🔎 Consultando pagamento no /v1/payments/", paymentId);

  const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  if (res.status === 200) {
    const data = await res.json();
    console.log("✅ Pagamento encontrado em /v1/payments:", data.id);
    return data;
  }

  console.warn(`⚠️ Não encontrado em /v1/payments (${res.status})`);
  return null;
}

async function getMerchantOrder(orderId: string) {
  console.log("🔎 Consultando merchant_order:", orderId);

  const url = `https://api.mercadopago.com/merchant_orders/${orderId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  if (res.status === 200) {
    const data = await res.json();
    console.log("✅ Merchant order encontrada:", data.id);
    return data;
  }

  console.warn(`⚠️ Não encontrado em /merchant_orders (${res.status})`);
  return null;
}

export const handler: Handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || "{}");
    console.log("📥 Webhook recebido:", JSON.stringify(payload, null, 2));

    let paymentId: string | null = null;
    let topic: string | null = null;

    // webhook novo (action + data.id)
    if (payload.data?.id) {
      paymentId = String(payload.data.id);
      topic = payload.action || "payment";
    }
    // webhook antigo (topic + id)
    else if (payload.id) {
      paymentId = String(payload.id);
      topic = payload.topic || "payment";
    }

    if (!paymentId) {
      console.error("❌ Nenhum paymentId encontrado no payload");
      return { statusCode: 400, body: "invalid webhook format" };
    }

    console.log(`➡️ ID detectado: ${paymentId}, topic: ${topic}`);

    let paymentData = null;

    if (topic.includes("payment")) {
      // tenta via /v1/payments
      paymentData = await getPayment(paymentId);

      if (!paymentData) {
        // fallback via merchant_orders
        paymentData = await getMerchantOrder(paymentId);
      }
    } else if (topic.includes("merchant_order")) {
      paymentData = await getMerchantOrder(paymentId);
    }

    if (!paymentData) {
      console.error("❌ Nenhum dado encontrado para ID:", paymentId);
      return { statusCode: 404, body: "payment not found" };
    }

    // aqui você pode salvar no banco ou processar
    console.log("🎉 Pagamento processado com sucesso!");

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, data: paymentData }),
    };
  } catch (err: any) {
    console.error("🔥 Erro inesperado:", err);
    return { statusCode: 500, body: err.message };
  }
};
