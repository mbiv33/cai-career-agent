/**
 * Tiny static file server for the test-portal fixtures — no framework, just
 * `node:http`. Serves everything under this directory; any path with no
 * matching file (e.g. the fake `/recaptcha/anchor` iframe target) gets a
 * trivial 200 HTML response so a same-origin iframe pointed at it resolves
 * instantly with no network dependency.
 */
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ROOT = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer(async (req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(FIXTURE_ROOT, safePath === "/" ? "index.html" : safePath);

    try {
      const body = await readFile(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { "content-type": MIME_TYPES[ext] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      // No matching file — used deliberately by the fake reCAPTCHA iframe
      // target (`/recaptcha/anchor`): a fast, network-free 200 so the outer
      // page's `load` event isn't left waiting on a real external request.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body></body></html>");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server failed to bind to a port.");
  }
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
