import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";
import { handleExplainHttp } from "./src/lib/explain";
import { handleInspectHttp } from "./src/lib/inspect-http";
import type { HttpRequest, HttpResponse } from "./src/lib/http";

async function readBody(req: IncomingMessage, max = 32_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    chunks.push(buf);
    if (size > max) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function headersOf(req: IncomingMessage): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key] = value;
  return headers;
}

function wrapResponse(res: ServerResponse): HttpResponse {
  const wrapper: HttpResponse = {
    status(code: number) {
      res.statusCode = code;
      return wrapper;
    },
    json(body: unknown) {
      if (!res.getHeader("Content-Type")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      if (body == null && res.statusCode === 204) {
        res.end();
        return;
      }
      res.end(JSON.stringify(body));
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value);
    },
  };
  return wrapper;
}

function apiPlugin(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url !== "/api/inspect" && url !== "/api/explain") {
          next();
          return;
        }
        const raw = req.method === "POST" ? await readBody(req) : "";
        const httpReq: HttpRequest = {
          method: req.method,
          headers: headersOf(req),
          body: raw ? raw : undefined,
          socket: { remoteAddress: req.socket.remoteAddress },
        };
        const httpRes = wrapResponse(res);
        if (url === "/api/inspect") {
          await handleInspectHttp(httpReq, httpRes);
          return;
        }
        await handleExplainHttp(httpReq, httpRes);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
