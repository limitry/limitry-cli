import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { brand } from "../brand/index.ts";
import { describe, expect, it } from "vitest";

import { run, type Io } from "../cli.ts";

const KEY = "lim_test_abcdefghijklmnop";
const TOKEN = `${brand.identifier.toUpperCase()}_TOKEN`;

function terminal(answer: unknown, status = 200) {
  const calls: { path: string; body: unknown }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    env: { [TOKEN]: KEY },
    homeDir: mkdtempSync(join(tmpdir(), "check-home-")),
    fetch: async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      calls.push({
        path: new URL(req.url).pathname,
        body: JSON.parse(await req.text()),
      });
      return Response.json(answer, {
        status,
        headers: { "x-environment": "test" },
      });
    },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    stdin: async () => "",
  };
  return { io, calls, out, err };
}

const budget = {
  limit: "lim_a",
  name: "AI budget",
  unit: "cents",
  window: "month",
  rolling: false,
  failMode: "closed",
  resetsAt: "2026-11-01T00:00:00.000Z",
};
const allowed = {
  id: "chk_1",
  allowed: true,
  reason: null,
  remaining: [{ ...budget, remaining: 195 }],
  retryAfterSeconds: null,
};
const refused = {
  id: "chk_2",
  allowed: false,
  reason: { code: "limit_exceeded", limit: "lim_a" },
  remaining: [{ ...budget, remaining: 0 }],
  retryAfterSeconds: 3600,
};

describe("check", () => {
  it("sends the check as checks create does, and answers in one line", async () => {
    const t = terminal(allowed);
    const code = await run(
      [
        "check",
        "user:usr_123",
        "ai-call",
        "--cost",
        "5",
        "--shared",
        "team:team_42",
        "--shared",
        "org:o:1",
      ],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.calls).toEqual([
      {
        path: "/v1/checks",
        body: {
          subject: { kind: "user", id: "usr_123" },
          action: "ai-call",
          cost: 5,
          shared: [
            { kind: "team", id: "team_42" },
            { kind: "org", id: "o:1" },
          ],
        },
      },
    ]);
    // The same request as the long form (an API key is its own
    // workspace, so neither names one).
    const long = terminal(allowed);
    await run(
      [
        "checks",
        "create",
        "--subject",
        '{"kind":"user","id":"usr_123"}',
        "--action",
        "ai-call",
        "--cost",
        "5",
        "--shared",
        '[{"kind":"team","id":"team_42"},{"kind":"org","id":"o:1"}]',
      ],
      long.io,
    );
    expect(long.calls[0]).toEqual(t.calls[0]);
    expect(t.out).toEqual([
      "Allowed. AI budget: 195 cents left, resets 2026-11-01T00:00:00.000Z",
    ]);
  });

  it("says why it was refused, and exits 0: a refusal is an answer", async () => {
    const t = terminal(refused);
    expect(await run(["check", "user:usr_123", "ai-call"], t.io)).toBe(0);
    expect(t.calls[0].body).toEqual({
      subject: { kind: "user", id: "usr_123" },
      action: "ai-call",
    });
    expect(t.out).toEqual([
      "Refused by AI budget: 0 cents left, resets 2026-11-01T00:00:00.000Z. Try again in 3600 s.",
    ]);
    const json = terminal(refused);
    await run(["check", "user:usr_123", "ai-call", "--json"], json.io);
    expect(JSON.parse(json.out.join("\n"))).toEqual(refused);
  });

  it("exits 1 on an error, and on a subject that isn't kind:id", async () => {
    const t = terminal(
      { error: { code: "forbidden", message: "Missing scope checks:write" } },
      403,
    );
    expect(await run(["check", "user:usr_123", "ai-call"], t.io)).toBe(1);
    expect(t.err.join("\n")).toContain("Missing scope");

    const bad = terminal(allowed);
    expect(await run(["check", "usr_123", "ai-call"], bad.io)).toBe(1);
    expect(bad.calls).toHaveLength(0);
    expect(bad.err.join("\n")).toContain("kind:id");
  });

  it("is listed as the short form of checks create", async () => {
    const t = terminal(allowed);
    await run(["--help"], t.io);
    expect(t.out.join("\n")).toContain(
      `Short for \`${brand.name} checks create\``,
    );
  });
});
