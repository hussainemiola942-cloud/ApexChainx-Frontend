/** ApexChain Network Operations Intelligence Platform */
/**
 * Logout failures were invisible: session.tsx's `logout` swallowed the
 * server-side POST /auth/logout error internally and never reported it,
 * so a failed server logout looked identical to a successful one — the UI
 * cleared tokens and moved on, while the httpOnly session cookie could
 * still be valid server-side.
 *
 * `logout` now returns a `LogoutResult` so callers can tell the two apart,
 * while still always clearing local state (refusing to clear would leave
 * the UI stuck trusting a session it can no longer verify).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { useSession } from "@/hooks/useSession";
import { SessionProvider } from "@/providers/session";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockClearTokens = vi.fn();
const mockGetAccessToken = vi.fn();
const mockSetTokens = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  clearTokens: () => mockClearTokens(),
  getAccessToken: () => mockGetAccessToken(),
  setTokens: (...args: unknown[]) => mockSetTokens(...args),
}));

// Isolate provider logic from cross-tab sync / SSE / heartbeat noise, same
// as tests/preferences-logout.test.tsx — this test only cares about the
// logout() return value and that clearSession still runs on failure.
vi.mock("@/lib/session-sync", () => ({
  createSessionSync: () => null,
}));
vi.mock("@/lib/session-sse", () => ({
  connectSessionSse: () => ({ close: () => {} }),
}));
vi.mock("@/lib/session-heartbeat", () => ({
  startHeartbeat: () => ({ stop: () => {} }),
}));

const mockUser = {
  id: "u1",
  email: "op@example.com",
  role: "engineer",
};

function renderSessionHook() {
  return renderHook(() => useSession(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <SessionProvider>{children}</SessionProvider>
    ),
  });
}

async function renderAuthenticated() {
  mockGetAccessToken.mockReturnValue(null);
  window.localStorage.setItem("noc_session_seen", "1");
  mockGet.mockImplementation((url: string) => {
    if (url === "/auth/session") return Promise.resolve({ data: mockUser });
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });

  const rendered = renderSessionHook();
  await waitFor(() => {
    expect(rendered.result.current.state).toBe("authenticated");
  });
  return rendered;
}

describe("logout() reports server-side failure while still clearing local state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockPost.mockReset();
    mockClearTokens.mockReset();
    mockGetAccessToken.mockReset();
    mockSetTokens.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns serverRevoked: true and clears local state on a successful server logout", async () => {
    mockPost.mockResolvedValue({ data: {} });
    const { result } = await renderAuthenticated();

    let outcome: { serverRevoked: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.logout();
    });

    expect(outcome).toEqual({ serverRevoked: true });
    expect(result.current.state).toBe("unauthenticated");
    expect(mockClearTokens).toHaveBeenCalled();
  });

  it("returns serverRevoked: false but still clears local state when the server logout request fails", async () => {
    mockPost.mockRejectedValue(new Error("Network Error"));
    const { result } = await renderAuthenticated();

    let outcome: { serverRevoked: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.logout();
    });

    // The failure must be visible to the caller...
    expect(outcome).toEqual({ serverRevoked: false });
    // ...but local state is cleared regardless, so the UI never gets stuck
    // trusting a session it can no longer confirm server-side.
    expect(result.current.state).toBe("unauthenticated");
    expect(mockClearTokens).toHaveBeenCalled();
  });
});