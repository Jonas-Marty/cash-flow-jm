import type { IncomingMessage, ServerResponse } from "node:http";

export const MIME: Record<string, string>;
export const COMPRESSIBLE: Set<string>;
export function acceptedEncodings(header: string | undefined | null): { encoding: "br" | "gzip"; suffix: string }[];
export function safeJoin(base: string, urlPath: string): string | null;
export function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string): Promise<boolean>;
