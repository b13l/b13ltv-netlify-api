import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { initializeApp, getFirestore, cert } from "npm:firebase-admin@^11.0.0";
import { fetch } from "https://deno.land/x/fetch/mod.ts";

// Configurações do Firebase Admin SDK - usando os segredos do Supabase
const serviceAccount = {
  projectId: Deno.env.get("FIREBASE_PROJECT_ID"),
  clientEmail: Deno.env.get("FIREBASE_CLIENT_EMAIL"),
  privateKey: Deno.env.get("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
};

// Inicializa o Firebase com as credenciais do Admin SDK
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Credenciais do Mercado Pago e URL da API do WhatsApp
const mercadoPagoAccessToken = Deno.env.get("MP_ACCESS_TOKEN");
const whatsappPhoneId = Deno.env.get("WHATSAPP_PHONE_ID");
const whatsappAccessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");

// Função para gerar um PIN aleatório de 6 dígitos
function generatePin(): string {
  const min = 100000;
  const max = 999999;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

// Handler da função de borda
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const payload = await req.json();

    // Verifica se a notificação é sobre um pagamento
    if (payload.action === "payment.created" || payload.action === "payment.updated") {
      const paymentId = payload.data.id;

      // Chama a API do Mercado Pago para verificar o status real do pagamento
      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          "Authorization": `Bearer ${mercadoPagoAccessToken}`,
        },
      });
      const paymentStatus = await mpResponse.json();
      
      const customerPhoneNumber = paymentStatus.payer.phone.number;

      if (paymentStatus.status === "approved") {
        const pin = generatePin();
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 30); // 30 dias de validade

        // Salva o PIN no Firebase Firestore
        await db.collection("pins").doc(pin).set({
          pin: pin,
          expirationDate: expirationDate,
          isActive: true,
          mercadoPagoPaymentId: paymentId,
        });

        console.log(`PIN ${pin} gerado e salvo para o pagamento ${paymentId}`);

        // Lógica para enviar o PIN via WhatsApp
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
            "Authorization": `Bearer ${whatsappAccessToken}`,
          },
          body: JSON.stringify(whatsappPayload),
        });

        return new Response(JSON.stringify({ success: true, message: "PIN gerado e salvo" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ success: true, message: "No relevant action" }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});