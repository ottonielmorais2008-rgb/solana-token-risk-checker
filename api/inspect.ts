import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleInspectHttp } from "../src/lib/inspect-http";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handleInspectHttp(req, res);
}
