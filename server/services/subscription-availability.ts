import type { Channel } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";

/** Require a configured delivery path and an active subscriber chain. */
export async function subscriptionAvailability() {
  const chains = await db.chain.findMany({
    where: { status: "ACTIVE", trigger: "SUBSCRIBED" },
    select: { channel: true },
  });
  const configured: Record<Channel, boolean> = {
    PUSH: !!(env.ONESIGNAL_APP_ID && env.ONESIGNAL_API_KEY),
    EMAIL: !!(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL),
    SMS: !!(env.BLUEBUBBLES_URL && env.BLUEBUBBLES_PASSWORD),
  };
  const liveDelivery = env.LIVE_DELIVERY === "true";
  const channels = (["PUSH", "EMAIL", "SMS"] as Channel[]).map((channel) => {
    const activeChain = chains.some((chain) => chain.channel === channel);
    return {
      channel,
      configured: configured[channel],
      activeChain,
      available: liveDelivery && configured[channel] && activeChain,
    };
  });
  return {
    liveDelivery,
    channels,
    availableChannels: channels
      .filter((item) => item.available)
      .map((item) => item.channel),
    note: "Configuration checks do not prove provider delivery or worker health. Use provider connection checks, the worker heartbeat, and an authorized delivery test before launch.",
  };
}
