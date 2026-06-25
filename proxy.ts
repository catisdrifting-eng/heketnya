import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// 보호 경로 패턴
const PROTECTED_PATHS = ['/dashboard', '/project'];

// 공개 경로 패턴
const PUBLIC_PATHS = ['/', '/login', '/auth', '/join'];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + '/'),
  );
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + '/'),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase 세션 갱신을 위한 response 생성
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 세션 갱신 (getUser()를 호출해야 토큰이 자동 갱신됨)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 미로그인 + 보호 경로 → /login?redirect=경로 로 redirect
  if (!user && isProtectedPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // 로그인 + /login 접근 → /dashboard로 redirect
  if (user && pathname === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * 다음 경로를 제외한 모든 요청에 미들웨어 적용:
     * - _next/static (정적 파일)
     * - _next/image (이미지 최적화)
     * - favicon.ico, sitemap.xml, robots.txt
     * - 이미지 파일 확장자
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
