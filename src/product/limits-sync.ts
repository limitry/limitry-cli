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
      "--archive-missing",
      "archive active limits the file doesn't name (restorable)",
    )
    .option("--workspace <slug>", "act in this workspace for one call")
    .option("--json", "machine-readable output")
    .addHelpText(
      "after",
      '\nThe file: { "limits": [ { "name": "AI budget", "subject": { "kind": "user" }, "action": "ai-call", "amount": 200, "unit": "cents", "window": "month" } ] }' +
        "\nEach limit is described whole: a field left out is its default, as on `limits create`. Names are the key." +
        "\nWhat a limit counts (subject, action, unit, window, every, start, rolling) is fixed: to change it, give the entry a new name." +
        more,
    )
    .action(
      async (
        file: string,
        options: {
          preview?: boolean;
          limits?: string;
          archiveMissing?: boolean;
          workspace?: string;
          json?: boolean;
        },
      ) => {
        const limits =
          options.limits === undefined
            ? readLimitsFile(file)
            : parseLimits(options.limits, "--limits");
        const result = await ctx
          .client({ workspace: options.workspace })
          .limits.sync(
            {
              limits,
              archiveMissing: options.archiveMissing ?? false,
              preview: options.preview ?? false,
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
type SyncResult = Schemas["LimitSyncResult"];

/** The file's limits, or an error saying what's wrong with the file. */
export function readLimitsFile(file: string): LimitInput[] {
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
  const limits = (parsed as { limits?: unknown } | null)?.limits;
  if (!Array.isArray(limits)) {
    throw new Error(`${file}: expected { "limits": [ … ] }`);
  }
  return limits as LimitInput[];
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
