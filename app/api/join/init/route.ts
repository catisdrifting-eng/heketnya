import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  let token: string;
  try {
    const body = await request.json();
    token = body.token;
    if (!token) throw new Error('token missing');
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });

  response.cookies.set('invite_token', token, {
    httpOnly: true,
    maxAge: 900, // 15분
    path: '/',
    sameSite: 'lax',
  });

  return response;
}
