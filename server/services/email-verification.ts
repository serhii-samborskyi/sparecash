import { z } from "zod";
import { env } from "../config.js";

const booleanText = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");
const responseSchema = z.object({
  Address: z.string().email().max(254),
  Status: z.string().min(1).max(100),
  Diagnosis: z.string().max(500).optional().default(""),
  catch_all: booleanText.optional().default(false),
  Disposable_Domain: booleanText.optional().default(false),
  Role_Based: booleanText.optional().default(false),
  Free_Domain: booleanText.optional().default(false),
  Greylisted: booleanText.optional().default(false),
});

export type EmailVerification = {
  valid: boolean;
  status: string;
  diagnosis: string;
};

export async function verifyEmailAddress(
  email: string,
): Promise<EmailVerification> {
  if (!env.MYEMAILVERIFIER_API_KEY)
    throw new Error("Email verification is not configured");
  const address = email.trim().toLowerCase();
  const url = new URL(
    `/verifier/validate_single/${encodeURIComponent(address)}/${encodeURIComponent(env.MYEMAILVERIFIER_API_KEY)}`,
    "https://client.myemailverifier.com",
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("Email verification is temporarily unavailable");
  }
  if (!response.ok)
    throw new Error("Email verification is temporarily unavailable");
  let data: z.infer<typeof responseSchema>;
  try {
    data = responseSchema.parse(await response.json());
  } catch {
    throw new Error("Email verification returned an unexpected response");
  }
  return {
    valid:
      data.Status.trim().toLowerCase() === "valid" &&
      data.Address.trim().toLowerCase() === address,
    status: data.Status,
    diagnosis: data.Diagnosis,
  };
}
