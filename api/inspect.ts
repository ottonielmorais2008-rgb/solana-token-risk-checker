import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleInspectHttp } from "../src/lib/inspect-http.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handleInspectHttp(req, res);
}
