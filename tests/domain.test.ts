import { describe, it, expect } from "vitest";
import {
  sourceDecision,
  settingsSchema,
  chooseVariant,
  nextLeadStatus,
  canSend,
  withinSendingHours,
  shouldStop,
  normalizePhone,
} from "../server/domain";
describe("traffic decisions", () => {
  const rules = settingsSchema.parse({});
  const old = new Date(Date.now() - 48 * 3600000);
  it("requires a mature sample even when all requests appear suspicious", () => {
    expect(
      sourceDecision({ total: 10, bad: 10, oldest: old }, rules).eligible,
    ).toBe(false);
    expect(
      sourceDecision({ total: 200, bad: 200, oldest: new Date() }, rules)
        .eligible,
    ).toBe(false);
  });
  it("uses the lower confidence bound instead of the observed bot rate", () => {
    expect(
      sourceDecision({ total: 100, bad: 85, oldest: old }, rules).eligible,
    ).toBe(false);
    expect(
      sourceDecision({ total: 200, bad: 195, oldest: old }, rules).eligible,
    ).toBe(true);
  });
  it("does not exclude sources merely for zero conversions", () => {
    expect(
      sourceDecision({ total: 10000, bad: 0, oldest: old }, rules).eligible,
    ).toBe(false);
  });
  it("respects weighted allocation and excludes zero-weight variants", () => {
    const variants = [
      { id: "off", weight: 0 },
      { id: "a", weight: 25 },
      { id: "b", weight: 75 },
    ];
    expect(chooseVariant(variants, 0).id).toBe("a");
    expect(chooseVariant(variants, 0.249).id).toBe("a");
    expect(chooseVariant(variants, 0.25).id).toBe("b");
  });
});
describe("journey rules", () => {
  it("never downgrades funded or approved outcomes with late postbacks", () => {
    expect(nextLeadStatus("FUNDED", "DECLINED")).toBe("FUNDED");
    expect(nextLeadStatus("APPROVED", "SOLD")).toBe("APPROVED");
    expect(nextLeadStatus("DECLINED", "FUNDED")).toBe("FUNDED");
  });
  it("distinguishes a lead sale from funded money", () => {
    expect(shouldStop("SOLD", "FUNDED")).toBe(false);
    expect(shouldStop("FUNDED", "FUNDED")).toBe(true);
    expect(shouldStop("APPROVED", "SOLD")).toBe(true);
  });
  it("enforces a rolling daily cap", () => {
    const now = new Date("2026-10-07T16:00:00Z");
    expect(canSend(new Date("2026-10-06T17:00:00Z"), now)).toBe(false);
    expect(canSend(new Date("2026-10-06T16:00:00Z"), now)).toBe(true);
  });
  it("uses recipient timezone for the sending window", () => {
    const now = new Date("2026-10-07T16:00:00Z");
    expect(withinSendingHours("America/Chicago", 10, 18, now)).toBe(true);
    expect(withinSendingHours("America/Los_Angeles", 10, 18, now)).toBe(false);
  });
  it("normalizes only US-format telephone numbers", () => {
    expect(normalizePhone("(312) 555-0100")).toBe("+13125550100");
    expect(normalizePhone("+1 312 555 0100")).toBe("+13125550100");
    expect(normalizePhone("+44 20 1234 1234")).toBe(null);
  });
});
