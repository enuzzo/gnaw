import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export type StaticServerOptions = {
  publicDir: string;
};

export function createStaticServer({ publicDir }: StaticServerOptions) {
  const root = resolve(publicDir);

  return createServer((request, response) => {
    serveStatic(root, request, response);
  });
}

function serveStatic(root: string, request: IncomingMessage, response: ServerResponse) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname.endsWith("/")
    ? join(pathname, "index.html")
    : pathname;
  const filePath = resolve(root, `.${normalize(relativePath)}`);

  if (!isInsideRoot(root, filePath)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = statSync(filePath);

    if (!fileStat.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-length": fileStat.size,
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function isInsideRoot(root: string, filePath: string) {
  return filePath === root || filePath.startsWith(`${root}${sep}`);
}
