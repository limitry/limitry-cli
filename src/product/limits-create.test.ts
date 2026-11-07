import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { brand } from "../brand/index.ts";
import { describe, expect, it } from "vitest";

import { run, type Io } from "../cli.ts";

/**
 * `limits create` asks for one sentence (design-limiters.md "Creating a
 * limit"): the subject's kind, the amount and the window; the API names
 * it and fills in every action and units.
 */
const KEY = "lim_test_abcdefghijklmnop";
const TOKEN = `${brand.identifier.toUpperCase()}_TOKEN`;

function terminal(answer: unknown) {
  const calls: { path: string; body: unknown }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    env: { [TOKEN]: KEY },
    homeDir: mkdtempSync(join(tmpdir(), "create-home-")),
    fetch: async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const text = await req.text();
      calls.push({
        path: new URL(req.url).pathname,
        body: text ? JSON.parse(text) : undefined,
      });
      return Response.json(answer, {
        status: 201,
        headers: { "x-environment": "test" },
      });
    },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    stdin: async () => "",
  };
  return { io, calls, out, err };
}

describe("limits create", () => {
  it("needs only the subject's kind, the amount and the window", async () => {
    const t = terminal({ id: "lmt_1", name: "100 units per user per month" });
    const code = await run(
      [
        "limits",
        "create",
        "--subject",
        '{"kind":"user"}',
        "--amount",
        "100",
        "--window",
        "month",
      ],
      t.io,
    );
    expect(t.err.filter((line) => !line.startsWith("Environment:"))).toEqual(
      [],
    );
    expect(code).toBe(0);
    expect(t.calls).toEqual([
      {
        path: "/v1/limits",
        body: { subject: { kind: "user" }, amount: 100, window: "month" },
      },
    ]);
  });

  it("has no --counting flag: every count is saved", async () => {
    const t = terminal({});
    const code = await run(["limits", "create", "--help"], t.io);
    const help = t.out.join("\n");
    expect(code).toBe(0);
    expect(help).toContain("--subject");
    expect(help).not.toContain("--counting");
    expect(help).not.toContain("--subject-kind");
  });
});
