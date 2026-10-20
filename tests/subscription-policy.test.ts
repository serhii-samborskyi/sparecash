import { expect, it } from "vitest";
import { canReceiveFollowups } from "../server/subscription-policy";

it("suppresses email follow-ups after a non-valid mailbox result", () => {
  for (const emailVerificationState of [
    "INVALID",
    "UNKNOWN",
    "CATCH_ALL",
    "GREYLISTED",
    "ERROR",
  ]) {
    expect(
      canReceiveFollowups({
        channel: "EMAIL",
        status: "ACTIVE",
        emailVerificationState,
      }),
    ).toBe(false);
  }
});

it("keeps verified and legacy unchecked email subscriptions eligible", () => {
  expect(
    canReceiveFollowups({
      channel: "EMAIL",
      status: "ACTIVE",
      emailVerificationState: "VERIFIED",
    }),
  ).toBe(true);
  expect(
    canReceiveFollowups({
      channel: "EMAIL",
      status: "PENDING",
      emailVerificationState: "NOT_CHECKED",
    }),
  ).toBe(true);
});
