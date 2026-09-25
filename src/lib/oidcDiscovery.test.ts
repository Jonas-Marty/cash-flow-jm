import { describe, expect, it } from "vitest";
import { customOidcProviderBody, discoveryUrlFor, readDiscovery } from "./oidcDiscovery";

describe("discoveryUrlFor", () => {
  it("adds the well-known path to an issuer, with or without its trailing slash", () => {
    expect(discoveryUrlFor("https://auth.example.com/application/o/cashflow/")).toBe(
      "https://auth.example.com/application/o/cashflow/.well-known/openid-configuration",
    );
    expect(discoveryUrlFor(" https://auth.example.com/realms/home ")).toBe(
      "https://auth.example.com/realms/home/.well-known/openid-configuration",
    );
  });

  it("leaves a discovery URL as it is", () => {
    const u = "https://auth.example.com/application/o/cashflow/.well-known/openid-configuration";
    expect(discoveryUrlFor(u)).toBe(u);
  });

  it("refuses anything but http(s)", () => {
    expect(() => discoveryUrlFor("file:///etc/passwd")).toThrow(/http/);
    expect(() => discoveryUrlFor("nonsense")).toThrow();
  });
});

describe("readDiscovery", () => {
  const doc = {
    issuer: "https://auth.example.com/application/o/cashflow/",
    authorization_endpoint: "https://auth.example.com/application/o/authorize/",
    token_endpoint: "https://auth.example.com/application/o/token/",
    jwks_uri: "https://auth.example.com/application/o/cashflow/jwks/",
    scopes_supported: ["openid", "email", 3],
  };

  it("reads a usable document", () => {
    expect(readDiscovery(doc)).toEqual({
      issuer: doc.issuer,
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      jwksUri: doc.jwks_uri,
      scopes: ["openid", "email"],
      missing: [],
    });
  });

  it("names every required field that is missing or empty", () => {
    expect(readDiscovery({ ...doc, jwks_uri: "", token_endpoint: undefined }).missing).toEqual([
      "token_endpoint",
      "jwks_uri",
    ]);
    expect(readDiscovery(null).missing).toEqual([
      "issuer",
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ]);
  });
});

describe("customOidcProviderBody", () => {
  const base = {
    identifier: "custom:oidc",
    name: "Authentik",
    issuer: "https://auth.example.com/application/o/cashflow/",
    discoveryUrl:
      "https://auth.example.com/application/o/cashflow/.well-known/openid-configuration",
    clientId: "abc",
    enabled: true,
  };

  it("asks for openid, email and profile, with PKCE", () => {
    const body = customOidcProviderBody({ ...base, clientSecret: "s3cret" });
    expect(body).toMatchObject({
      provider_type: "oidc",
      identifier: "custom:oidc",
      client_secret: "s3cret",
      scopes: ["openid", "email", "profile"],
      pkce_enabled: true,
    });
  });

  // On an update the auth service keeps the stored secret when none is sent;
  // sending an empty one would wipe it.
  it("leaves the secret out when none was entered", () => {
    expect(customOidcProviderBody({ ...base, clientSecret: "" })).not.toHaveProperty(
      "client_secret",
    );
    expect(customOidcProviderBody(base)).not.toHaveProperty("client_secret");
  });
});
