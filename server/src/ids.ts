import crypto from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

export function token(): string {
  return crypto.randomBytes(32).toString('hex');
}
