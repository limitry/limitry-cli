import { brand } from "./brand/index.ts";
import { ApiError } from "@limitry/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

// A product's own hint (./product/index.ts) answers first by design, so
// these tests set it themselves: product-proof (Reminix's names its
// quick choice, 2026-11-20).
const hint = vi.hoisted(() => ({ fn: undefined as unknown }));
vi.mock("./product/index.ts", () => ({
  productCommands: [],
  get productErrorHint() {
    return hint.fn;
  },
}));

const { scopeHint } = await import("./cli.ts");

const refused = new ApiError(
  403,
  "forbidden",
  "This credential is not granted the scripts:write scope",
);

afterEach(() => {
  hint.fn = undefined;
});

describe("a refusal for a missing permission says how to fix it (owner, 2026-11-20)", () => {
  it("names the scope and the sign-in to redo", () => {
    expect(scopeHint(refused)).toBe(
      `Sign in again with \`${brand.name} login\` and choose access that includes scripts:write.`,
    );
  });

  it("lets a product word it, naming its quick choice", () => {
    hint.fn = () => "Sign in again and choose Publish and run scripts.";
    expect(scopeHint(refused)).toBe(
      "Sign in again and choose Publish and run scripts.",
    );
  });

  it("says nothing for other errors", () => {
    expect(scopeHint(new ApiError(404, "not_found", "No such script"))).toBe(
      null,
    );
    expect(
      scopeHint(
        new ApiError(403, "forbidden", "This route requires the owner role"),
      ),
    ).toBe(null);
  });
});
