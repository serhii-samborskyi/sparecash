type Pixel = { id: string; url: string; action: string };

// Resource loads are receipts for attempts, not proof that the provider enrolled
// anyone. No retry: a lost response could already have changed provider cookies.
export function createPixelRunner(
  visitToken: string,
  permission: () => boolean,
) {
  let running: Promise<void> | undefined;
  let again = false;
  async function request(path: string, body: object) {
    const response = await fetch(`/api/public/retargeting/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitToken, ...body }),
      signal: AbortSignal.timeout(4000),
      keepalive: true,
    });
    if (!response.ok) throw new Error("Retargeting check unavailable");
    return response.json();
  }
  async function fire(pixel: Pixel) {
    if (!permission()) {
      await request("receipt", { id: pixel.id, state: "FAILED" }).catch(
        () => {},
      );
      return;
    }
    // Defense in depth; the server only approves this adapter as well.
    const url = new URL(pixel.url);
    if (url.origin !== "https://my.rtmark.net" || url.pathname !== "/img.gif")
      return;
    const state = await new Promise<"LOADED" | "FAILED" | "UNCERTAIN">(
      (resolve) => {
        const img = new Image();
        const finish = (state: "LOADED" | "FAILED" | "UNCERTAIN") => {
          clearTimeout(timer);
          img.onload = null;
          img.onerror = null;
          resolve(state);
        };
        const timer = setTimeout(() => finish("UNCERTAIN"), 1800);
        img.referrerPolicy = "no-referrer";
        img.onload = () => finish("LOADED");
        img.onerror = () => finish("FAILED");
        img.src = pixel.url;
      },
    );
    await request("receipt", { id: pixel.id, state }).catch(() => {});
  }
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        const result = await request("qualify", {});
        await Promise.all((result.pixels as Pixel[]).map(fire));
      } while (again);
    })()
      .catch(() => {})
      .finally(() => {
        running = undefined;
      });
    return running;
  };
}

// Advertising must never prevent the visitor from continuing to loan options.
export async function beforeApplicationNavigation(run?: () => Promise<void>) {
  if (!run) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    run(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 2500);
    }),
  ]);
  clearTimeout(timer);
}
