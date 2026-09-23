import { timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getOrder } from '../services/mercadoPagoService';
import { settlePlatformInvoicePayment } from '../services/platformInvoiceService';

const router = Router();
const safeEqual = (received: string, expected: string) => {
  const a = Buffer.from(received); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Segredo na própria URL, mesmo padrão de interWebhookRoutes.ts. O corpo da
// notificação do Mercado Pago só avisa "a order X mudou" — nunca traz o
// valor pago nem confirma o status por si só, então SEMPRE reconsultamos
// GET /v1/orders/:id (getOrder) antes de considerar algo pago.
router.post('/:secret', asyncHandler(async (req, res) => {
  const expected = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
  if (!expected || !safeEqual(String(req.params.secret || ''), expected)) return res.status(404).end();

  // O Mercado Pago manda a notificação tanto por query string (?type=order&data.id=123)
  // quanto por corpo JSON ({type, data:{id}}), dependendo da configuração — aceitamos os dois.
  // topic 'order' é o da API de Orders (não 'payment', que é da API de Pagamentos clássica).
  const orderId = String(req.body?.data?.id || req.query['data.id'] || req.query.id || '');
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
