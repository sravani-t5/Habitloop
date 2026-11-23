import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { HttpError } from "./errors";

export interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  token: string; // raw bearer token, forwarded on service-to-service calls
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: AuthContext;
    }
  }
}

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export function signToken(c: Omit<AuthContext, "token">, expiresIn = "8h"): string {
  return jwt.sign(c, secret(), { expiresIn } as jwt.SignOptions);
}

/** Verifies the bearer JWT and exposes {userId, tenantId} on req.ctx. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  if (!token) return next(new HttpError(401, "Missing bearer token"));
  try {
    const p = jwt.verify(token, secret()) as jwt.JwtPayload;
    req.ctx = { userId: p.userId, tenantId: p.tenantId, email: p.email, name: p.name, token };
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

/** Service-to-service calls (Lambda -> Activity, Activity -> Analytics...). */
export function requireInternal(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_API_KEY || "";
  const got = String(req.headers["x-internal-key"] || "");
  const ok = expected.length > 0 && got.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) return next(new HttpError(401, "Invalid internal key"));
  next();
}
