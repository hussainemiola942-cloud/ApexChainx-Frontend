/** ApexChain Frontend Test Suite */
/**
 * Before this fix, `logout()` in session.tsx swallowed its own errors and
 * never rethrew, so the settings page's `catch { setSessionActionError(...) }`
 * branch in handleSignOut was dead code — it typechecked but could never
 * run. `logout()` now returns `{ serverRevoked: boolean }`, and
 * handleSignOut reads that result directly instead of relying on an
 * exception that never comes.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/i18n";
import SettingsPage from "@/app/setting/page";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockToast = vi.fn();
const mockLogout = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace, back: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  getAccessToken: () => null,
  clearTokens: vi.fn(),
  setTokens: vi.fn(),
}));
vi.mock("@/lib/explorer", () => ({ explorerLink: () => null, STELLAR_NETWORK: "testnet" }));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => mockToast,
}));

const mockUser = { id: "u1", email: "op@example.com", role: "engineer" };

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    state: "authenticated",
    user: mockUser,
    logout: mockLogout,
  }),
}));

function renderSettingsPage() {
  return render(
    <I18nProvider>
      <SettingsPage />
    </I18nProvider>
  );
}

describe("Settings page sign-out error branch (previously unreachable)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockLogout.mockReset();
    mockReplace.mockReset();

    // jsdom does not implement matchMedia; the settings page's theme effect
    // calls it on every render regardless of what this test is checking.
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the failure message when the server logout did not succeed", async () => {
    mockLogout.mockResolvedValue({ serverRevoked: false });
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(
      await screen.findByText(/couldn't confirm the server session was revoked/i)
    ).toBeInTheDocument();

    // Local state was still cleared, so navigation to /login still happens —
    // the warning surfaces alongside the redirect, not instead of it.
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("shows no error and still redirects on a successful server logout", async () => {
    mockLogout.mockResolvedValue({ serverRevoked: true });
    renderSettingsPage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
      await vi.waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/login");
      });
    });

    expect(
      screen.queryByText(/couldn't confirm the server session was revoked/i)
    ).not.toBeInTheDocument();
  });
});