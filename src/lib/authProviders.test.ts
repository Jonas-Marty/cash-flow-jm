import { describe, expect, it } from "vitest";
import {
  OIDC_PROVIDER_ID,
  authReturnUrl,
  oauthErrorFromUrl,
  providerLabel,
  toSupabaseProvider,
  withoutOAuthError,
} from "./authProviders";

describe("toSupabaseProvider", () => {
  it("maps the generic OIDC row to the auth service's custom provider", () => {
    expect(toSupabaseProvider("oidc")).toBe(OIDC_PROVIDER_ID);
    expect(OIDC_PROVIDER_ID).toBe("custom:oidc");
  });

  it("no longer maps the old keycloak row, which never worked with Authentik", () => {
    expect(toSupabaseProvider("keycloak")).toBeNull();
  });

  it("keeps the built-in ones", () => {
    expect(toSupabaseProvider("google")).toBe("google");
    expect(toSupabaseProvider("microsoft")).toBe("azure");
  });
});

describe("providerLabel", () => {
  it("prefers the display name, and names identities by their provider id", () => {
    expect(providerLabel("oidc", " Authentik ")).toBe("Authentik");
    expect(providerLabel(OIDC_PROVIDER_ID)).toBe("OIDC");
    expect(providerLabel("azure")).toBe("Microsoft");
    expect(providerLabel("email")).toBe("E-Mail");
  });
});

describe("authReturnUrl", () => {
  // The allow list entry is https://app/*, which a bare origin does not match;
  // the auth service then sent people to its API host instead.
  it("always has a path, so the allow list matches it", () => {
    expect(authReturnUrl("https://cash-flow.wi-wo.ch")).toBe("https://cash-flow.wi-wo.ch/");
    expect(authReturnUrl("https://cash-flow.wi-wo.ch/", "/settings")).toBe(
      "https://cash-flow.wi-wo.ch/settings",
    );
    expect(authReturnUrl("https://cash-flow.wi-wo.ch", "settings")).toBe(
      "https://cash-flow.wi-wo.ch/settings",
    );
  });
});

describe("oauthErrorFromUrl", () => {
  it("reads the error the auth service puts in the fragment", () => {
    expect(
      oauthErrorFromUrl(
        "https://app/#error=server_error&error_code=provider_email_needs_verification&error_description=Unverified+email+with+custom%3Aoidc",
      ),
    ).toEqual({
      code: "provider_email_needs_verification",
      description: "Unverified email with custom:oidc",
    });
  });

  it("and in the query, for the PKCE flow", () => {
    expect(
      oauthErrorFromUrl("https://app/?error=access_denied&error_description=User%20cancelled"),
    ).toEqual({
      code: "access_denied",
      description: "User cancelled",
    });
  });

  it("returns null for a normal return, tokens included", () => {
    expect(oauthErrorFromUrl("https://app/#access_token=abc&refresh_token=def")).toBeNull();
    expect(oauthErrorFromUrl("https://app/settings")).toBeNull();
    expect(oauthErrorFromUrl("not a url")).toBeNull();
  });
});

describe("withoutOAuthError", () => {
  it("drops only the error parameters", () => {
    expect(withoutOAuthError("https://app/x?keep=1&error=a&error_description=b#error_code=c")).toBe(
      "https://app/x?keep=1",
    );
  });
});
