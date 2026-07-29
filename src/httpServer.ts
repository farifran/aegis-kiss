/**
 * Servidor HTTP, Parser & Roteador Middleware
 */

export interface HTTPRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS';
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

export interface HTTPResponse {
  statusCode: number;
  headers: Record<string, string>;
  body?: string;
  json(data: unknown): void;
  send(content: string, code?: number): void;
}

export type HTTPMiddleware = (
  req: HTTPRequest,
  res: HTTPResponse,
  next: () => void | Promise<void>
) => void | Promise<void>;

interface RouteHandler {
  method: string;
  path: string;
  handler: HTTPMiddleware;
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const keyName = name.toLowerCase();
  return headers[keyName];
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const keyName = name.toLowerCase();
  headers[keyName] = value;
}

/**
 * Construtor Principal do Servidor e Roteador HTTP
 */
export class HTTPServer {
  private globalMiddlewares: HTTPMiddleware[] = [];
  private routes: RouteHandler[] = [];

  use(middleware: HTTPMiddleware): this {
    this.globalMiddlewares.push(middleware);
    return this;
  }

  get(path: string, handler: HTTPMiddleware): this {
    this.routes.push({ method: 'GET', path, handler });
    return this;
  }

  post(path: string, handler: HTTPMiddleware): this {
    this.routes.push({ method: 'POST', path, handler });
    return this;
  }

  put(path: string, handler: HTTPMiddleware): this {
    this.routes.push({ method: 'PUT', path, handler });
    return this;
  }

  delete(path: string, handler: HTTPMiddleware): this {
    this.routes.push({ method: 'DELETE', path, handler });
    return this;
  }

  private parseQuery(queryString: string): Record<string, string> {
    const query: Record<string, string> = {};
    if (!queryString) return query;
    for (const param of queryString.split('&')) {
      const [k, v] = param.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
    return query;
  }

  private parseHeaders(lines: string[]): { headers: Record<string, string>; bodyLineIdx: number } {
    const headers: Record<string, string> = {};
    let lineIdx = 1;
    while (lineIdx < lines.length && lines[lineIdx] !== '') {
      const headerLine = lines[lineIdx]!;
      const colonIdx = headerLine.indexOf(':');
      if (colonIdx !== -1) {
        const key = headerLine.substring(0, colonIdx).trim();
        const val = headerLine.substring(colonIdx + 1).trim();
        setHeader(headers, key, val);
      }
      lineIdx++;
    }
    return { headers, bodyLineIdx: lineIdx };
  }

  parseRawRequest(raw: string): HTTPRequest {
    const lines = raw.trim().split('\r\n');
    const firstLine = lines[0] ?? 'GET / HTTP/1.1';
    const [methodStr, fullPath] = firstLine.split(' ');

    const method = (methodStr ?? 'GET') as HTTPRequest['method'];
    const pathParts = (fullPath ?? '/').split('?');
    const path = pathParts[0] ?? '/';
    const query = this.parseQuery(pathParts[1] ?? '');

    const { headers, bodyLineIdx } = this.parseHeaders(lines);
    const rawBody = lines.slice(bodyLineIdx + 1).join('\r\n');
    let body: unknown = rawBody;

    const contentType = getHeader(headers, 'content-type');
    if (contentType?.includes('application/json') && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    return { method, path, headers, query, body };
  }

  formatRawResponse(res: HTTPResponse): string {
    const statusTextMap: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      400: 'Bad Request',
      404: 'Not Found',
      500: 'Internal Server Error',
    };

    const statusText = statusTextMap[res.statusCode] ?? 'OK';
    let output = `HTTP/1.1 ${res.statusCode} ${statusText}\r\n`;

    const resHeaders = { ...res.headers };
    if (res.body && !getHeader(resHeaders, 'content-length')) {
      const len = String(new TextEncoder().encode(res.body).length);
      setHeader(resHeaders, 'content-length', len);
    }

    for (const [k, v] of Object.entries(resHeaders)) {
      output += `${k}: ${v}\r\n`;
    }

    output += '\r\n';
    if (res.body) {
      output += res.body;
    }

    return output;
  }

  async handleRequest(rawRequest: string): Promise<string> {
    const req = this.parseRawRequest(rawRequest);

    let resBody = '';
    let statusCode = 200;
    const resHeaders: Record<string, string> = {};
    setHeader(resHeaders, 'content-type', 'text/plain');

    const res: HTTPResponse = {
      statusCode,
      headers: resHeaders,
      get body() {
        return resBody;
      },
      json(data: unknown) {
        setHeader(resHeaders, 'content-type', 'application/json');
        resBody = JSON.stringify(data);
      },
      send(content: string, code = 200) {
        res.statusCode = code;
        resBody = content;
      },
    };

    const matchedRoutes = this.routes.filter(
      (r) => r.method === req.method && r.path === req.path
    );

    const pipeline: HTTPMiddleware[] = [
      ...this.globalMiddlewares,
      ...matchedRoutes.map((r) => r.handler),
    ];

    if (matchedRoutes.length === 0 && this.globalMiddlewares.length === 0) {
      res.send('Not Found', 404);
      return this.formatRawResponse(res);
    }

    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx < pipeline.length) {
        const fn = pipeline[idx++]!;
        await fn(req, res, next);
      }
    };

    await next();

    if (!resBody && res.statusCode === 200) {
      res.send('OK', 200);
    }

    return this.formatRawResponse(res);
  }
}
