import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname !== '/internal/pipeline') {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/pipeline-observatory';

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/internal/pipeline'],
};
