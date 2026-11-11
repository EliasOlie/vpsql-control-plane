import { NextRequest, NextResponse } from 'next/server';

function getTargetBaseUrl(): string {
  // In Docker, the Go API container is at http://api:8080
  // Fallback to http://localhost:8080 for local development
  return process.env.API_URL || 'http://api:8080';
}

async function handleProxy(req: NextRequest, pathParts: string[]) {
  const base = getTargetBaseUrl().replace(/\/+$/, '');
  const subPath = pathParts.join('/');
  const query = req.nextUrl.search;
  const targetUrl = `${base}/${subPath}${query}`;

  const headers = new Headers();
  req.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (lower !== 'host' && lower !== 'content-length' && lower !== 'connection') {
      headers.set(key, val);
    }
  });

  const method = req.method.toUpperCase();
  let body: BodyInit | undefined = undefined;
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data') || contentType.includes('application/octet-stream')) {
        body = await req.arrayBuffer();
      } else {
        body = await req.text();
      }
    } catch {
      body = undefined;
    }
  }

  try {
    const backendRes = await fetch(targetUrl, {
      method,
      headers,
      body,
      cache: 'no-store',
    });

    const responseBody = await backendRes.arrayBuffer();
    const resHeaders = new Headers();
    const contentType = backendRes.headers.get('content-type') || 'application/json';
    resHeaders.set('content-type', contentType);

    return new NextResponse(responseBody, {
      status: backendRes.status,
      headers: resHeaders,
    });
  } catch (err: any) {
    console.error(`[VPSQL Proxy] Error forwarding ${method} to ${targetUrl}:`, err);
    return NextResponse.json(
      {
        error: `VPSQL Control Plane API unreachable at ${targetUrl}`,
        detail: err.message,
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path || []);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path || []);
}

export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path || []);
}

export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path || []);
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return handleProxy(req, params.path || []);
}
