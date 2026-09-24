import { describe, expect, it } from "vitest";
import {
  afterRefusedRefresh,
  isExpired,
  isReconnectError,
  NextcloudReconnectError,
  refreshRefused,
  singleFlight,
} from "./nextcloudAuth";

describe("singleFlight", () => {
  it("renews once when two searches find the token expired together", async () => {
    const run = singleFlight<string>();
    let calls = 0;
    let release!: (v: string) => void;
    const fn = () => {
      calls++;
      return new Promise<string>((r) => (release = r));
    };
    const a = run("user-1", fn);
    const b = run("user-1", fn);
    release("new-token");
    expect(await a).toBe("new-token");
    expect(await b).toBe("new-token");
    expect(calls).toBe(1);
  });

  it("keeps users apart", async () => {
    const run = singleFlight<string>();
    let calls = 0;
    const fn = async () => String(++calls);
    await Promise.all([run("user-1", fn), run("user-2", fn)]);
    expect(calls).toBe(2);
  });

  it("runs again after the first one finished, even if it failed", async () => {
    const run = singleFlight<string>();
    await expect(run("u", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await run("u", async () => "ok")).toBe("ok");
  });
});

describe("afterRefusedRefresh", () => {
  it("uses the stored pair when someone else renewed first", () => {
    expect(afterRefusedRefresh("old", { refresh_token: "new", access_token: "a" })).toBe("use-stored");
  });

  it("asks to reconnect when the token we sent is still the stored one", () => {
    expect(afterRefusedRefresh("old", { refresh_token: "old", access_token: "a" })).toBe("reconnect");
  });

  it("asks to reconnect when the row lost its tokens or is gone", () => {
    expect(afterRefusedRefresh("old", { refresh_token: null, access_token: null })).toBe("reconnect");
    expect(afterRefusedRefresh("old", null)).toBe("reconnect");
  });
});

describe("refreshRefused", () => {
  it("counts only a 4xx from the token endpoint as refused", () => {
    expect(refreshRefused(400)).toBe(true);
    expect(refreshRefused(401)).toBe(true);
    // A Nextcloud outage must not cost the user their connection.
    expect(refreshRefused(500)).toBe(false);
    expect(refreshRefused(503)).toBe(false);
  });
});

describe("isExpired", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  it("compares against the stored expiry", () => {
    expect(isExpired("2026-09-24T11:59:59Z", now)).toBe(true);
    expect(isExpired("2026-09-24T12:00:01Z", now)).toBe(false);
  });
  it("does not renew when the expiry is unknown", () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired("garbage", now)).toBe(false);
  });
});

describe("isReconnectError", () => {
  it("recognises the error after it crossed the server boundary as a plain message", () => {
    const crossed = new Error(new NextcloudReconnectError("refresh refused").message);
    expect(isReconnectError(crossed)).toBe(true);
    expect(isReconnectError(new Error("Nextcloud search failed [500]"))).toBe(false);
  });
});
