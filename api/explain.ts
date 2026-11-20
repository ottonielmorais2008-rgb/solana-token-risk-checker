import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleExplainHttp } from "../src/lib/explain.js";

export const maxDuration = 30;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handleExplainHttp(req, res);
}
