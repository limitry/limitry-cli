import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { brand } from "../brand/index.ts";
import { describe, expect, it } from "vitest";

import { run, type Io } from "../cli.ts";

const KEY = "lim_live_abcdefghijklmnop";
const PAT = `pat_${brand.identifier}_abcdefghijklmnop`;
const TOKEN = `${brand.identifier.toUpperCase()}_TOKEN`;

const budget = {
  name: "AI budget",
  subject: { kind: "user" },
  action: "ai-call",
  amount: 200,
  unit: "cents",
  window: "month",
};

function terminal(token: string, answer: unknown, status = 200) {
  const calls: { path: string; body: unknown; headers: Headers }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    env: { [TOKEN]: token },
    homeDir: mkdtempSync(join(tmpdir(), "sync-home-")),
    fetch: async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      calls.push({
        path: new URL(req.url).pathname,
        body: JSON.parse(await req.text()),
        headers: req.headers,
      });
      return Response.json(answer, {
        status,
        headers: { "x-environment": "live" },
      });
    },
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    stdin: async () => "",
  };
  return { io, calls, out, err };
}

function file(contents: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "sync-file-"));
  const path = join(dir, "limitry.json");
  writeFileSync(
    path,
    typeof contents === "string" ? contents : JSON.stringify(contents),
  );
  return path;
}

const plan = {
  preview: true,
  created: ["Exports at once"],
  updated: [{ name: "AI budget", changes: { amount: { from: 100, to: 200 } } }],
  archived: ["Old limit"],
  unchanged: ["API requests per minute"],
};

describe("limits sync", () => {
  it("sends the file's limits with an API key, and prints what it would do", async () => {
    const t = terminal(KEY, plan);
    const code = await run(
      [
        "limits",
        "sync",
        file({ limits: [budget] }),
        "--preview",
        "--archive-missing",
      ],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].path).toBe("/v1/limits/sync");
    expect(t.calls[0].body).toEqual({
      limits: [budget],
      archiveMissing: true,
      preview: true,
    });
    // A key is its workspace: no X-Workspace, and none needed.
    expect(t.calls[0].headers.get("x-workspace")).toBeNull();
    expect(t.calls[0].headers.get("idempotency-key")).toBeTruthy();
    expect(t.out).toEqual([
      "Would create: Exports at once",
      "Would update: AI budget (amount 100 → 200)",
      "Would archive: Old limit",
      "Unchanged: 1",
      "Preview: nothing was changed.",
    ]);
    expect(t.err).toEqual(["Environment: live"]);
  });

  it("reads ./limitry.json by default and prints the API's JSON with --json", async () => {
    const applied = {
      ...plan,
      preview: false,
      created: [],
      updated: [],
      archived: [],
    };
    const t = terminal(KEY, applied);
    const dir = mkdtempSync(join(tmpdir(), "sync-cwd-"));
    writeFileSync(join(dir, "limitry.json"), JSON.stringify({ limits: [] }));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(await run(["limits", "sync", "--json"], t.io)).toBe(0);
    } finally {
      process.chdir(cwd);
    }
    expect(t.calls[0].body).toEqual({
      limits: [],
      archiveMissing: false,
      preview: false,
    });
    expect(JSON.parse(t.out.join("\n"))).toEqual(applied);

    const quiet = terminal(KEY, applied);
    await run(["limits", "sync", file({ limits: [budget] })], quiet.io);
    expect(quiet.out).toEqual(["No changes: 1 limit already match."]);
  });

  it("names the workspace for a person's token", async () => {
    const t = terminal(PAT, { ...plan, preview: false });
    const code = await run(
      ["limits", "sync", file({ limits: [budget] }), "--workspace", "acme"],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.calls[0].headers.get("x-workspace")).toBe("acme");
    expect(t.out[0]).toBe("Created: Exports at once");
  });

  it("fails, calling nothing, on a missing or malformed file", async () => {
    for (const path of [
      join(tmpdir(), "no-such-dir", "limitry.json"),
      file("{ not json"),
      file({ limit: [budget] }),
    ]) {
      const t = terminal(KEY, plan);
      expect(await run(["limits", "sync", path], t.io)).toBe(1);
      expect(t.calls).toHaveLength(0);
      expect(t.err.join("\n")).toMatch(/no such file|not valid JSON|expected/);
    }
  });

  it("exits 1 with the API's message when it refuses the list", async () => {
    const t = terminal(
      KEY,
      {
        error: {
          code: "invalid_request",
          message:
            'Nothing was changed. limits.1.name: "AI budget" is also limits.0; names must be unique',
          details: [
            {
              path: "limits.1.name",
              message: '"AI budget" is also limits.0; names must be unique',
            },
          ],
        },
      },
      400,
    );
    const code = await run(
      ["limits", "sync", file({ limits: [budget, budget] })],
      t.io,
    );
    expect(code).toBe(1);
    expect(t.err.join("\n")).toContain("limits.1.name");
  });

  it("has a shortcut, `sync`, that is the same command", async () => {
    const path = file({ limits: [budget] });
    const long = terminal(KEY, plan);
    const short = terminal(KEY, plan);
    const flags = ["--preview", "--archive-missing"];
    expect(await run(["limits", "sync", path, ...flags], long.io)).toBe(0);
    expect(await run(["sync", path, ...flags], short.io)).toBe(0);
    expect(short.calls.map((c) => [c.path, c.body])).toEqual(
      long.calls.map((c) => [c.path, c.body]),
    );
    expect(short.out).toEqual(long.out);

    const json = terminal(KEY, plan);
    await run(["sync", path, "--json"], json.io);
    expect(JSON.parse(json.out.join("\n"))).toEqual(plan);

    const help = terminal(KEY, plan);
    await run(["--help"], help.io);
    expect(help.out.join("\n")).toMatch(
      new RegExp(
        `sync \\[options\\] \\[file\\]\\s+Short for \`${brand.name} limits sync\``,
      ),
    );
  });

  it("takes the list as --limits instead of a file, as the API reference shows", async () => {
    const t = terminal(KEY, plan);
    const code = await run(
      ["limits", "sync", "--limits", JSON.stringify([budget]), "--preview"],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.calls[0].body).toEqual({
      limits: [budget],
      archiveMissing: false,
      preview: true,
    });
    const bad = terminal(KEY, plan);
    expect(await run(["sync", "--limits", "{}"], bad.io)).toBe(1);
    expect(bad.calls).toHaveLength(0);
  });
});
