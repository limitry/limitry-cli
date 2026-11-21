import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { brand } from "../brand/index.ts";
import type { Schemas } from "@limitry/sdk";
import type { Command as Commander } from "commander";

import type { CliContext, Command } from "../cli.ts";
import { json } from "../output.ts";

/**
 * `limitry limits sync [file]`, and its shortcut `limitry sync [file]` — makes the environment's limits match a
 * file kept in the repository (default `./limitry.json`, shaped
 * `{ "limits": [ … ] }`, each entry what `limits create` takes), through
 * `POST /v1/limits/sync`. Replaces the generated `limits sync`, which
 * would need the whole list as `--limits '<json>'`.
 *
 *   limitry limits sync --preview          # what it would do; changes nothing
 *   limitry limits sync                    # apply it
 *   limitry limits sync --archive-missing  # and archive limits not in the file
 *
 * In CI the token is a workspace API key in LIMITRY_TOKEN: the key is its
 * workspace and environment, so no `--workspace` is needed. A person's
 * token names the workspace as every command does.
 */
export const limitsSyncCommand: Command = (program, ctx) => {
  // Registered before the generated commands, so this file makes the
  // `limits` group; they fill it, but describe only groups they make.
  const group =
    program.commands.find((c) => c.name() === "limits") ??
    program
      .command("limits")
      .description(
        "archive, create, credits, get, list, restore, sync, update",
      );
  syncCommand(
    group.command("sync"),
    ctx,
    `Make your limits match a file (shortcut: ${brand.name} sync)`,
    `\nShortcut: \`${brand.name} sync\`, the same command.`,
  );
  // The shortcut: the same command, at the top level.
  syncCommand(
    program.command("sync"),
    ctx,
    `Short for \`${brand.name} limits sync\``,
    "",
  );
};

function syncCommand(
  command: Commander,
  ctx: CliContext,
  description: string,
  more: string,
) {
  command
    .description(description)
    .argument("[file]", "the file to read", "limitry.json")
    .option("--preview", "show what would change, and change nothing")
    .option("--limits <json>", "the limits as a JSON array, instead of a file")
    .option(
      "--data <json>",
      "the whole JSON body, as every command takes, instead of a file",
    )
    .option(
      "--archive-missing",
      "archive active limits the file doesn't name (restorable)",
    )
    .option(
      "--source <label>",
      "where the limits come from, named on each one in the app (default: the file's name)",
    )
    .option("--workspace <slug>", "act in this workspace for one call")
    .option("--json", "machine-readable output")
    .addHelpText(
      "after",
      '\nThe file: { "limits": [ { "name": "AI budget", "subject": { "kind": "user" }, "action": "ai-call", "amount": 200, "unit": "cents", "window": "month" } ] }' +
        '\nOptional: "kinds": [ { "kind": "cost-center", "displayName": "Cost center", "plural": "Cost centers" } ], top level first, names your kinds in the app.' +
        "\nEach limit is described whole: a field left out is its default, as on `limits create`. Names are the key." +
        "\nWhat a limit counts (subject, action, unit, window, every, start, rolling) is fixed: to change it, give the entry a new name." +
        "\nWhat the sync sets is locked in the app, which names the file (or --source) on each limit." +
        more,
    )
    .action(
      async (
        file: string,
        options: {
          preview?: boolean;
          limits?: string;
          data?: string;
          archiveMissing?: boolean;
          source?: string;
          workspace?: string;
          json?: boolean;
        },
      ) => {
        // --data is the request itself; the flags still apply over it.
        const data = options.data === undefined ? {} : parseData(options.data);
        // The file is read only when no flag gives the limits.
        const fromFile =
          options.limits === undefined && data.limits === undefined
            ? readSyncFile(file)
            : null;
        const limits =
          options.limits !== undefined
            ? parseLimits(options.limits, "--limits")
            : data.limits !== undefined
              ? limitsIn(data.limits)
              : fromFile!.limits;
        // The workspace's kinds, when the file (or --data) names them.
        const kinds =
          data.kinds !== undefined
            ? (data.kinds as KindInput[])
            : fromFile?.kinds;
        // Where the limits come from, which the app's lock names: the
        // file's name as passed, unless a flag or --data says (owner,
        // 2026-11-22).
        const source =
          options.source ??
          (typeof data.source === "string" ? data.source : undefined) ??
          (fromFile ? file : undefined);
        const result = await ctx
          .client({ workspace: options.workspace })
          .limits.sync(
            {
              limits,
              archiveMissing:
                options.archiveMissing ?? data.archiveMissing === true,
              preview: options.preview ?? data.preview === true,
              ...(kinds !== undefined ? { kinds } : {}),
              ...(source !== undefined ? { source } : {}),
            },
            { idempotencyKey: crypto.randomUUID() },
          );
        if (options.json) {
          ctx.io.stdout(json(result));
          return;
        }
        for (const line of summary(result)) ctx.io.stdout(line);
      },
    );
}

type LimitInput = Schemas["LimitSyncEntry"];
type KindInput = NonNullable<Schemas["LimitSyncInput"]["kinds"]>[number];
type SyncResult = Schemas["LimitSyncResult"];

/** The file's limits, or an error saying what's wrong with the file. */
export function readLimitsFile(file: string): LimitInput[] {
  return readSyncFile(file).limits;
}

/**
 * The file's limits and, when it has them, its kinds (`"kinds": [ … ]`,
 * top level first; docs/limitry-json).
 */
export function readSyncFile(file: string): {
  limits: LimitInput[];
  kinds?: KindInput[];
} {
  const path = resolve(file);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${file}: no such file`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: not valid JSON (${(error as Error).message})`, {
      cause: error,
    });
  }
  const body = parsed as { limits?: unknown; kinds?: unknown } | null;
  if (!Array.isArray(body?.limits)) {
    throw new Error(`${file}: expected { "limits": [ … ] }`);
  }
  if (body.kinds !== undefined && !Array.isArray(body.kinds)) {
    throw new Error(`${file}: "kinds" must be a list, top level first`);
  }
  return {
    limits: body.limits as LimitInput[],
    ...(body.kinds !== undefined ? { kinds: body.kinds as KindInput[] } : {}),
  };
}

/** `--limits '[…]'`: the list itself, as the API reference shows it. */
function parseLimits(text: string, flag: string): LimitInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${flag} must be a JSON array of limits`, {
      cause: error,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON array of limits`);
  }
  return parsed as LimitInput[];
}

/** `--data '{…}'`: the whole body, as every generated command takes it. */
function parseData(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("--data must be a JSON object", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--data must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function limitsIn(value: unknown): LimitInput[] {
  if (!Array.isArray(value)) {
    throw new Error("--data's limits must be a JSON array of limits");
  }
  return value as LimitInput[];
}

const show = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

/** A short account of what changed (or, with --preview, what would). */
export function summary(result: SyncResult): string[] {
  const dry = result.preview;
  const lines = [
    ...result.created.map(
      (name) => `${dry ? "Would create" : "Created"}: ${name}`,
    ),
    ...result.updated.map(({ name, changes }) => {
      const fields = Object.entries(changes)
        .map(([field, c]) => `${field} ${show(c.from)} → ${show(c.to)}`)
        .join(", ");
      return `${dry ? "Would update" : "Updated"}: ${name} (${fields})`;
    }),
    ...result.archived.map(
      (name) => `${dry ? "Would archive" : "Archived"}: ${name}`,
    ),
  ];
  // Overrides made in the app that this sync ends (their overriders hear).
  for (const r of result.restored ?? [])
    lines.push(
      `${dry ? "Would restore" : "Restored"} the file's values over an override: ${r.name} (${r.reason})`,
    );
  if (result.kinds?.restored)
    lines.push(
      dry
        ? "Would restore the kinds over an override."
        : "Restored the kinds over an override.",
    );
  if (result.kinds?.changed)
    lines.push(dry ? "Would update the kinds." : "Updated the kinds.");
  const same = result.unchanged.length;
  if (lines.length === 0) {
    return [
      same === 0
        ? "No limits in the file, and nothing to change."
        : `No changes: ${same} limit${same === 1 ? "" : "s"} already match.`,
    ];
  }
  if (same > 0) lines.push(`Unchanged: ${same}`);
  if (dry) lines.push("Preview: nothing was changed.");
  return lines;
}
