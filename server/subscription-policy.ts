import type { Channel, SubscriptionStatus } from "@prisma/client";

type SubscriptionState = {
  channel: Channel;
  status: SubscriptionStatus;
  emailVerificationState?: string;
};

// Email and text consent is captured on the landing page. Address
// confirmation is an optional trust signal, so a consented contact may enter
// the warm-up sequence while it is still pending confirmation. Browser push
// remains gated on OneSignal confirming a usable subscription id.
export function canReceiveFollowups(subscription: SubscriptionState) {
  if (
    subscription.channel === "EMAIL" &&
    subscription.emailVerificationState &&
    !["NOT_CHECKED", "VERIFIED"].includes(subscription.emailVerificationState)
  )
    return false;
  return (
    subscription.status === "ACTIVE" ||
    (subscription.status === "PENDING" && subscription.channel !== "PUSH")
  );
}
