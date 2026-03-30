import crypto from "crypto";

const TELEGRAM_EVENTS = new Set([
  "checkout.completed",
  "subscription.past_due",
  "subscription.canceled",
  "subscription.scheduled_cancel",
]);

function buildTelegramMessage(eventType: string, event: { object?: { id?: string; customer?: { id?: string; email?: string }; product?: { id?: string; name?: string }; order?: { type?: string }; currentPeriodEnd?: number } }): string {
  const obj = event.object ?? {};
  const customer = obj.customer?.email ?? obj.customer?.id ?? "unknown";

  switch (eventType) {
    case "checkout.completed":
      return [
        "💰 *New Payment*",
        `Customer: ${customer}`,
        `Product: ${obj.product?.name ?? obj.product?.id ?? "unknown"}`,
        `Type: ${obj.order?.type ?? "unknown"}`,
      ].join("\n");

    case "subscription.past_due":
      return [
        "⚠️ *Payment Failed*",
        `Customer: ${customer}`,
        `Subscription: ${obj.id ?? "unknown"}`,
      ].join("\n");

    case "subscription.canceled":
      return [
        "❌ *Subscription Canceled*",
        `Customer: ${customer}`,
        `Subscription: ${obj.id ?? "unknown"}`,
      ].join("\n");

    case "subscription.scheduled_cancel":
      return [
        "🕐 *Cancellation Scheduled*",
        `Customer: ${customer}`,
        `Subscription: ${obj.id ?? "unknown"}`,
        `Ends: ${obj.currentPeriodEnd ? new Date(obj.currentPeriodEnd * 1000).toUTCString() : "unknown"}`,
      ].join("\n");

    default:
      return `📌 *${eventType}*`;
  }
}

function sendTelegramMessage(eventType: string, event: Parameters<typeof buildTelegramMessage>[1]) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping");
    return;
  }

  const text = buildTelegramMessage(eventType, event);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) {
        console.error(`[telegram] send failed: ${res.status} ${res.statusText}`);
      } else {
        console.log(`[telegram] sent message for ${eventType}`);
      }
    })
    .catch((err) => console.error("[telegram] send error:", err))
    .finally(() => clearTimeout(timeout));
}

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

  if (TELEGRAM_EVENTS.has(event.eventType)) {
    sendTelegramMessage(event.eventType, event);
  }

  return Response.json({ received: true });
}
