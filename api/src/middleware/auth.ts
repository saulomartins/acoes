import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/authService';
import type { UserRole } from '../types';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    return res.status(401).json({ message: 'authorization token is required' });
  }

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return res.status(401).json({ message: 'invalid or expired token' });
  }
};

export const authorize = (...roles: UserRole[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ message: 'authorization token is required' });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'insufficient permissions' });
  }

  return next();
};
