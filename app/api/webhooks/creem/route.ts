import crypto from "crypto";

const TELEGRAM_EVENTS = new Set([
  "checkout.completed",
  "subscription.past_due",
  "subscription.canceled",
  "subscription.scheduled_cancel",
  "subscription.expired",
]);

function buildMessage(
  eventType: string,
  event: {
    object?: {
      id?: string;
      customer?: { id?: string; email?: string };
      product?: { id?: string; name?: string };
      order?: { type?: string };
      current_period_end_date?: string;
    };
  },
): string {
  const obj = event.object ?? {};
  const customer = obj.customer?.email ?? obj.customer?.id ?? "unknown";

  switch (eventType) {
    case "checkout.completed":
      return [
        "💰 <b>New Payment</b>",
        `Customer: ${customer}`,
        `Product: ${obj.product?.name ?? obj.product?.id ?? "unknown"}`,
        `Type: ${obj.order?.type ?? "unknown"}`,
      ].join("\n");

    case "subscription.past_due":
      return [
        "⚠️ <b>Payment Failed</b>",
        `Customer: ${customer}`,
        `Product: ${obj.product?.name ?? obj.product?.id ?? "unknown"}`,
        `Subscription: ${obj.id ?? "unknown"}`,
      ].join("\n");

    case "subscription.canceled":
      return [
        "❌ <b>Churn Risk: Subscription Canceled</b>",
        `Customer: ${customer}`,
        `Product: ${obj.product?.name ?? obj.product?.id ?? "unknown"}`,
        `Subscription: ${obj.id ?? "unknown"}`,
      ].join("\n");

    case "subscription.scheduled_cancel":
      return [
        "🕐 <b>Churn Risk: Cancellation Scheduled</b>",
        `Customer: ${customer}`,
        `Product: ${obj.product?.name ?? obj.product?.id ?? "unknown"}`,
        `Subscription: ${obj.id ?? "unknown"}`,
        `Ends: ${obj.current_period_end_date ?? "unknown"}`,
      ].join("\n");

    case "subscription.expired":
      return [
        "⏰ <b>Churn Confirmed: Subscription Expired</b>",
        `Customer: ${customer}`,
        `Product: ${obj.product?.name ?? obj.product?.id ?? "unknown"}`,
        `Subscription: ${obj.id ?? "unknown"}`,
      ].join("\n");

    default:
      return `📌 <b>${eventType}</b>`;
  }
}

async function sendOpenclawHook(
  eventType: string,
  event: Parameters<typeof buildMessage>[1],
) {
  const baseUrl = process.env.OPENCLAW_BASE_URL;
  const hookToken = process.env.OPENCLAW_HOOK_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!baseUrl || !hookToken || !chatId) {
    console.warn(
      "[openclaw] OPENCLAW_BASE_URL, OPENCLAW_HOOK_TOKEN, or TELEGRAM_CHAT_ID not set, skipping",
    );
    return;
  }

  const message = buildMessage(eventType, event);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${baseUrl}/hooks/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hookToken}`,
      },
      body: JSON.stringify({
        message,
        name: "Creem",
        wakeMode: "now",
        deliver: true,
        channel: "telegram",
        to: chatId,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[openclaw] hook failed: ${res.status} ${res.statusText}`);
    } else {
      console.log(`[openclaw] hook sent for ${eventType}`);
    }
  } catch (err) {
    console.error("[openclaw] hook error:", err);
  } finally {
    clearTimeout(timeout);
  }
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
          currentPeriodEnd: event.object.current_period_end_date,
        },
      );
      break;

    case "subscription.past_due":
      console.log("[creem] subscription.past_due — payment failed, retrying", {
        subscriptionId: event.object.id,
        customerId: event.object.customer?.id,
      });
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
    await sendOpenclawHook(event.eventType, event);
  }

  return Response.json({ received: true });
}
