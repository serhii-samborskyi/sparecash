import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { checkOrigin, verifyToken } from "../security.js";
import { verifyVisitor } from "../services/visitor-verification.js";
import {
  qualifyPixels,
  reportPixel,
  saveAdvertisingChoice,
} from "../services/retargeting.js";

export const retargetingRouter = Router();
retargetingRouter.use(checkOrigin);
const session = z.object({ visitToken: z.string().max(500) });
async function boundVisit(req: import("express").Request) {
  const { visitToken } = session.parse(req.body);
  const visitId = verifyToken(visitToken, "visit");
  const journeyId = verifyToken(
    String(req.cookies.sc_journey ?? ""),
    "journey",
  );
  if (!visitId || !journeyId)
    throw new Error("Visit session expired. Refresh this page.");
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  if (visit.journeyId !== journeyId)
    throw new Error("Visit does not belong to this browser journey");
  if (req.headers["sec-gpc"] === "1") {
    const journey = await db.visitorJourney.findUniqueOrThrow({
      where: { id: journeyId },
    });
    if (journey.privacy !== "DENIED")
      await saveAdvertisingChoice(journeyId, "DENIED", "GPC");
  }
  return { visitId, journeyId };
}
retargetingRouter.post("/verify-visit", async (req, res) => {
  const input = session
    .extend({ turnstileToken: z.string().min(1).max(2048) })
    .strict()
    .parse(req.body);
  const { visitId } = await boundVisit(req);
  const result = await verifyVisitor(visitId, input.turnstileToken, req.ip);
  res.set("Cache-Control", "no-store").json(result);
});
retargetingRouter.post("/advertising-choice", async (req, res) => {
  const input = session
    .extend({
      choice: z.enum(["GRANTED", "DENIED"]),
      gpc: z.boolean().default(false),
    })
    .strict()
    .parse(req.body);
  const { journeyId } = await boundVisit(req);
  const gpc = input.gpc || req.headers["sec-gpc"] === "1";
  const journey = await saveAdvertisingChoice(
    journeyId,
    gpc ? "DENIED" : input.choice,
    gpc ? "GPC" : "CHOICE",
  );
  res.set("Cache-Control", "no-store").json({ privacy: journey.privacy });
});
retargetingRouter.post("/retargeting/qualify", async (req, res) => {
  session.strict().parse(req.body);
  const { visitId, journeyId } = await boundVisit(req);
  res
    .set("Cache-Control", "no-store")
    .json(await qualifyPixels(visitId, journeyId));
});
retargetingRouter.post("/retargeting/receipt", async (req, res) => {
  const input = session
    .extend({
      id: z.string().uuid(),
      state: z.enum(["LOADED", "FAILED", "UNCERTAIN"]),
    })
    .strict()
    .parse(req.body);
  const { journeyId } = await boundVisit(req);
  res
    .set("Cache-Control", "no-store")
    .json(await reportPixel(journeyId, input.id, input.state));
});
