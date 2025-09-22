const fetch = require("node-fetch");

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

async function getPayment(paymentId) {
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

async function getMerchantOrder(orderId) {
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

exports.handler = async (event) => {
  try {
    // Verificar se é POST
    if (event.httpMethod !== 'POST') {
      return { 
        statusCode: 405, 
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    // Parse seguro do JSON
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch (parseError) {
      console.error("❌ Erro ao fazer parse do JSON:", parseError);
      console.error("Body recebido:", event.body);
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'Invalid JSON format' })
      };
    }

    console.log("🔥 Webhook recebido:", JSON.stringify(payload, null, 2));

    let paymentId = null;
    let topic = null;

    // webhook novo (action + data.id)
    if (payload.data && payload.data.id) {
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
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "invalid webhook format" })
      };
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
      return { 
        statusCode: 404, 
        body: JSON.stringify({ error: "payment not found" })
      };
    }

    // AQUI VOCÊ PODE PROCESSAR O PAGAMENTO
    console.log("🎉 Pagamento processado com sucesso!");
    
    // Exemplo de processamento baseado no status
    if (paymentData.status === "approved") {
      console.log("💰 Pagamento APROVADO - Liberar acesso");
      // Aqui você pode:
      // - Salvar no Firebase
      // - Enviar WhatsApp
      // - Ativar assinatura no app
    } else if (paymentData.status === "pending") {
      console.log("⏳ Pagamento PENDENTE - Aguardando");
    } else if (paymentData.status === "rejected") {
      console.log("❌ Pagamento REJEITADO");
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        success: true, 
        paymentId: paymentId,
        status: paymentData.status,
        message: "Webhook processado com sucesso"
      }),
    };

  } catch (err) {
    console.error("🔥 Erro inesperado:", err);
    return { 
      statusCode: 500, 
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: "Internal server error",
        message: err.message 
      })
    };
  }
};