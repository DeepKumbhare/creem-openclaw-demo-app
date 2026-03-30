import crypto from "crypto";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("creem-signature");

  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 401 });
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET!)
    .update(body)
    .digest("hex");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature),
    )
  ) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body);

  console.log(`[creem webhook] ${event.eventType}`, {
    id: event.id,
    createdAt: event.created_at,
    object: event.object,
  });

  switch (event.eventType) {
    // One-time purchase
    case "checkout.completed":
      console.log("[creem] checkout.completed", {
        checkoutId: event.object.id,
        customerId: event.object.customer?.id,
        productId: event.object.product?.id,
        orderType: event.object.order?.type,
      });
      break;

    // Subscription lifecycle
    case "subscription.active":
      console.log("[creem] subscription.active — new subscription started", {
        subscriptionId: event.object.id,
        customerId: event.object.customer?.id,
        productId: event.object.product?.id,
        currentPeriodStart: event.object.currentPeriodStart,
        currentPeriodEnd: event.object.currentPeriodEnd,
      });
      break;

    case "subscription.trialing":
      console.log("[creem] subscription.trialing — trial started", {
        subscriptionId: event.object.id,
        customerId: event.object.customer?.id,
        currentPeriodStart: event.object.currentPeriodStart,
        currentPeriodEnd: event.object.currentPeriodEnd,
      });
      break;

    case "subscription.paid":
      console.log("[creem] subscription.paid — recurring payment collected", {
        subscriptionId: event.object.id,
        customerId: event.object.customer?.id,
        currentPeriodStart: event.object.currentPeriodStart,
        currentPeriodEnd: event.object.currentPeriodEnd,
      });
      break;

    case "subscription.canceled":
      console.log("[creem] subscription.canceled — subscription terminated", {
        subscriptionId: event.object.id,
        customerId: event.object.customer?.id,
      });
      break;

    case "subscription.scheduled_cancel":
      console.log(
        "[creem] subscription.scheduled_cancel — cancellation queued for period end",
        {
          subscriptionId: event.object.id,
          customerId: event.object.customer?.id,
          currentPeriodEnd: event.object.currentPeriodEnd,
        },
      );
      break;

    case "subscription.past_due":
      console.log(
        "[creem] subscription.past_due — payment failed, retrying",
        {
          subscriptionId: event.object.id,
          customerId: event.object.customer?.id,
        },
      );
      break;

    case "subscription.expired":
      console.log(
        "[creem] subscription.expired — billing period ended without payment",
        {
          subscriptionId: event.object.id,
          customerId: event.object.customer?.id,
        },
      );
      break;

    case "subscription.paused":
      console.log("[creem] subscription.paused", {
        subscriptionId: event.object.id,
        customerId: event.object.customer?.id,
      });
      break;

    case "subscription.update":
      console.log("[creem] subscription.update — subscription modified", {
        subscriptionId: event.object.id,
        customerId: event.object.customer?.id,
        autoRenew: event.object.autoRenew,
        currentPeriodStart: event.object.currentPeriodStart,
        currentPeriodEnd: event.object.currentPeriodEnd,
      });
      break;

    // Refunds & disputes
    case "refund.created":
      console.log("[creem] refund.created", {
        refundId: event.object.id,
        customerId: event.object.customer?.id,
        amount: event.object.amount,
      });
      break;

    case "dispute.created":
      console.log("[creem] dispute.created — chargeback initiated", {
        disputeId: event.object.id,
        customerId: event.object.customer?.id,
      });
      break;

    default:
      console.warn("[creem] unhandled event type:", event.eventType, event);
  }

  return Response.json({ received: true });
}
