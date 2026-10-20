import { z } from "zod";
import { env } from "../config.js";

const booleanText = z
  .union([
    z.boolean(),
    z.literal(0),
    z.literal(1),
    z.enum(["true", "false", "0", "1"]),
  ])
  .transform(
    (value) =>
      value === true || value === 1 || value === "true" || value === "1",
  );
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

export class EmailVerificationInconclusiveError extends Error {
  constructor(message = "The mailbox server did not respond in time") {
    super(message);
    this.name = "EmailVerificationInconclusiveError";
  }
}

export class EmailVerificationConfigurationError extends Error {
  constructor(message = "Email verification is not configured") {
    super(message);
    this.name = "EmailVerificationConfigurationError";
  }
}

export function emailVerificationState(result: EmailVerification) {
  if (result.valid) return "VERIFIED";
  const status = result.status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (status === "invalid") return "INVALID";
  if (status === "catch_all" || status === "catchall") return "CATCH_ALL";
  if (status === "grey_listed" || status === "greylisted") return "GREYLISTED";
  return "UNKNOWN";
}

export async function verifyEmailAddress(
  email: string,
): Promise<EmailVerification> {
  if (!env.MYEMAILVERIFIER_API_KEY)
    throw new EmailVerificationConfigurationError();
  const address = email.trim().toLowerCase();
  const url = new URL(
    `/verifier/validate_single/${encodeURIComponent(address)}/${encodeURIComponent(env.MYEMAILVERIFIER_API_KEY)}`,
    "https://client.myemailverifier.com",
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "SpareCash/1.0 (+https://sparecash.fit)",
      },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    )
      throw new EmailVerificationInconclusiveError();
    throw new EmailVerificationInconclusiveError(
      "The verification service did not return a result",
    );
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new EmailVerificationConfigurationError(
        "The email verifier rejected its credentials",
      );
    throw new EmailVerificationInconclusiveError(
      "The verification provider did not return a mailbox result",
    );
  }
  let data: z.infer<typeof responseSchema>;
  try {
    data = responseSchema.parse(await response.json());
  } catch {
    throw new EmailVerificationInconclusiveError(
      "The verification provider returned an inconclusive response",
    );
  }
  return {
    valid:
      data.Status.trim().toLowerCase() === "valid" &&
      data.Address.trim().toLowerCase() === address,
    status: data.Status,
    diagnosis: data.Diagnosis,
  };
}
