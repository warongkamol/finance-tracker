import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];
const API_PREFIX = "/api";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow all API routes (auth is checked per-route)
  if (pathname.startsWith(API_PREFIX)) return NextResponse.next();

  const isLoggedIn = !!req.auth;
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!isLoggedIn && !isPublicPath) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isPublicPath) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|.*\\..*).*)"],
};
