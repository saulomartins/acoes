import { Router } from 'express';
import { config } from '../config';
import { asyncHandler } from '../middleware/asyncHandler';
import { getOrder, verifyWebhookSignature } from '../services/mercadoPagoService';
import { settlePlatformInvoicePayment } from '../services/platformInvoiceService';

const router = Router();

// Webhook do Mercado Pago (tópico 'order', API de Orders). A autenticidade vem
// da assinatura x-signature (verifyWebhookSignature em mercadoPagoService.ts),
// não mais de um segredo na URL. Mesmo com assinatura válida, o corpo só avisa
// "a order X mudou" — nunca traz o valor pago nem confirma o status por si só,
// então SEMPRE reconsultamos GET /v1/orders/:id (getOrder) antes de considerar
// algo pago. Se a assinatura falhar por qualquer motivo, a reconciliação a
// cada 15 min continua confirmando os pagamentos (só atrasa).
//
// '/:legacySecret': o endereço antigo (/webhooks/mercadopago/<segredo>) cai
// aqui também, mas o trecho da URL é ignorado — vale só a assinatura.
router.post(['/', '/:legacySecret'], asyncHandler(async (req, res) => {
  // Só o data.id da query string é assinado — o do corpo não, então não é usado.
  const orderId = typeof req.query['data.id'] === 'string' ? req.query['data.id'] : '';
  const valid = verifyWebhookSignature({
    xSignature: req.header('x-signature'),
    xRequestId: req.header('x-request-id'),
    dataId: orderId,
    secret: config.mercadoPago.webhookSignatureSecret,
  });
  if (!valid) {
    if (!config.mercadoPago.webhookSignatureSecret) console.warn('mercadopago webhook rejected: MERCADOPAGO_WEBHOOK_SIGNATURE_SECRET not configured');
    return res.status(401).json({ message: 'invalid signature' });
  }

  const type = String(req.body?.type || req.query.type || '');
  if (type !== 'order' || !orderId) return res.status(200).json({ ignored: true });

  try {
    const order = await getOrder(orderId);
    if (!order.paid) return res.status(200).json({ received: true, status: order.status, statusDetail: order.statusDetail });

    const updated = await settlePlatformInvoicePayment(order.id);
    return res.status(200).json({ received: true, updated });
  } catch (error) {
    console.error('mercadopago webhook failed', error);
    return res.status(200).json({ received: true, error: true }); // 200 pra não entrar em retry infinito do MP
  }
}));

export default router;
