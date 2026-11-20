import { clientIp, allow } from "./rate-limit.js";
import { cors, methodOf, readJsonBody, tooLarge, type HttpRequest, type HttpResponse } from "./http.js";
import { inspectMint, type InspectRequest } from "./inspect.js";
import type { LoadMintDeps } from "./rpc.js";

export const INSPECT_LIMIT = 30;
export const INSPECT_WINDOW_MS = 60_000;

export async function handleInspectHttp(
  req: HttpRequest,
  res: HttpResponse,
  deps: LoadMintDeps = {},
): Promise<void> {
  cors(res);
  if (methodOf(req) === "OPTIONS") {
    res.status(204).json(null);
    return;
  }
  if (methodOf(req) !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (tooLarge(req)) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }

  const ip = clientIp(req.headers ?? {}, req.socket?.remoteAddress ?? "unknown");
  if (!allow(`inspect:${ip}`, INSPECT_LIMIT, INSPECT_WINDOW_MS)) {
    res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
    return;
  }

  const body = readJsonBody(req);
  if (!body.ok) {
    res.status(400).json({ error: body.error });
    return;
  }
  const payload = (body.value ?? {}) as InspectRequest;
  const result = await inspectMint(payload, deps);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.setHeader?.("Cache-Control", "no-store");
  res.status(200).json(result.report);
}
