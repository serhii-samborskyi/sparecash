import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeContext } from "../server/config";
import {
  defaultRuntimeValues,
  type RuntimeConfiguration,
} from "../server/runtime-schema";
import { verifyEmailAddress } from "../server/services/email-verification";

let config: RuntimeConfiguration;
let fetchMock: ReturnType<typeof vi.fn>;
const run = (email: string) =>
  runtimeContext.run(config, () => verifyEmailAddress(email));

beforeEach(() => {
  config = {
    ...defaultRuntimeValues,
    MYEMAILVERIFIER_API_KEY: "test-verifier-key",
  } as RuntimeConfiguration;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("accepts a matching address with Valid status", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      Address: "person@example.com",
      Status: "Valid",
      Diagnosis: "Mailbox Exists and Active",
      catch_all: "false",
      Disposable_Domain: "false",
      Role_Based: "false",
      Free_Domain: "true",
      Greylisted: "false",
    }),
  );
  await expect(run("Person@Example.com")).resolves.toMatchObject({
    valid: true,
    status: "Valid",
  });
  const [url, options] = fetchMock.mock.calls[0];
  expect(new URL(url).pathname).toContain("person%40example.com");
  expect(options).toMatchObject({ method: "GET", redirect: "error" });
});

it("rejects non-valid and mismatched provider results", async () => {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({
        Address: "bad@example.com",
        Status: "Invalid",
        Diagnosis: "Mailbox Does Not Exist",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        Address: "other@example.com",
        Status: "Valid",
        Diagnosis: "Mailbox Exists and Active",
      }),
    );
  await expect(run("bad@example.com")).resolves.toMatchObject({ valid: false });
  await expect(run("bad@example.com")).resolves.toMatchObject({ valid: false });
});

it("fails closed without exposing provider responses", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ secret: config.MYEMAILVERIFIER_API_KEY }, { status: 429 }),
  );
  await expect(run("person@example.com")).rejects.toThrow(
    "temporarily unavailable",
  );
});
