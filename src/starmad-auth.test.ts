import { describe, expect, it } from "vitest";
import { createManagedCredentials } from "./starmad-auth";

describe("managed STARMAD credentials", () => {
  it("creates unique service accounts with policy-compliant passwords", () => {
    const first = createManagedCredentials();
    const second = createManagedCredentials();
    expect(first.username).toMatch(/^orbit-copilot-[a-f0-9]{16}$/);
    expect(first.password.length).toBeGreaterThan(40);
    expect(first.password).toMatch(/[A-Za-z]/);
    expect(first.password).toMatch(/\d/);
    expect(second.username).not.toBe(first.username);
    expect(second.password).not.toBe(first.password);
  });
});
