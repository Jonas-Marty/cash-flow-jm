// Reading an OpenID Connect discovery document. Pure, so the rules are testable.

/**
 * The discovery document's URL for what an admin typed: the issuer
 * (`https://auth.example.com/application/o/app/`) or the document itself.
 */
export function discoveryUrlFor(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("URL must use http(s)");
  if (!url.pathname.includes("/.well-known/")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
  }
  return url.toString();
}

export interface Discovery {
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  scopes?: string[];
  /** Required fields the document lacks. Empty when it is usable. */
  missing: string[];
}

export function readDiscovery(doc: unknown): Discovery {
  const d = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" && d[k] ? (d[k] as string) : undefined);
  const out: Discovery = {
    issuer: str("issuer"),
    authorizationEndpoint: str("authorization_endpoint"),
    tokenEndpoint: str("token_endpoint"),
    jwksUri: str("jwks_uri"),
    scopes: Array.isArray(d.scopes_supported)
      ? d.scopes_supported.filter((s): s is string => typeof s === "string")
      : undefined,
    missing: [],
  };
  if (!out.issuer) out.missing.push("issuer");
  if (!out.authorizationEndpoint) out.missing.push("authorization_endpoint");
  if (!out.tokenEndpoint) out.missing.push("token_endpoint");
  if (!out.jwksUri) out.missing.push("jwks_uri");
  return out;
}

/**
 * The body GoTrue's admin API takes for the generic OIDC provider. The secret
 * is only sent when one was entered: on an update, leaving it out keeps the
 * stored one.
 */
export function customOidcProviderBody(p: {
  identifier: string;
  name: string;
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret?: string;
  enabled: boolean;
}) {
  return {
    provider_type: "oidc",
    identifier: p.identifier,
    name: p.name,
    issuer: p.issuer,
    discovery_url: p.discoveryUrl,
    client_id: p.clientId,
    ...(p.clientSecret ? { client_secret: p.clientSecret } : {}),
    scopes: ["openid", "email", "profile"],
    pkce_enabled: true,
    enabled: p.enabled,
  };
}
