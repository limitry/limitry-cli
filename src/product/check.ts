import { brand } from "../brand/index.ts";
import type { Schemas } from "@limitry/sdk";

import type { Command } from "../cli.ts";
import { UsageError } from "../errors.ts";
import { json } from "../output.ts";

/**
 * A refused check's exit code: Limitry's own, from 5 up (../errors.ts),
 * so a script can gate on it: `limitry check user:u_1 ai-call && run`.
 */
export const EXIT_REFUSED = 5;

/** The check was answered, and refused (exit code 5). */
export class RefusedError extends Error {
  readonly exitCode = EXIT_REFUSED;
  constructor() {
    super("The check was refused");
    this.name = "RefusedError";
  }
}

/**
 * `limitry check <kind>:<id> <action> [--cost N] [--shared kind:id …]` —
 * the short form of `limitry checks create` (`POST /v1/checks`, consume
 * mode): one line saying allowed or refused, what's left and when it
 * resets. A refusal prints the same way and exits 5, so a script can
 * gate on it; wrong usage exits 2, and a failed call (a bad request, the
 * network) exits 1. `--json` prints the decision as the API answers it.
 */
export const checkCommand: Command = (program, ctx) => {
  program
    .command("check")
    .description(`Short for \`${brand.name} checks create\``)
    .argument("<subject>", "who is acting, as kind:id (user:user_123)")
    .argument("<action>", "what they want to do (ai-call)")
    .option("--cost <n>", "units it would use (default 1)")
    .option(
      "--shared <kind:id>",
      "a shared subject it also draws from (a team's pool); repeat for more",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option("--workspace <slug>", "act in this workspace for one call")
    .option("--json", "the decision as the API answers it")
    .addHelpText(
      "after",
      `\nExample: ${brand.name} check user:user_123 ai-call --cost 5\nExit codes: 0 allowed, 5 refused, 2 wrong usage, 4 not signed in, 1 any other failure.`,
    )
    .action(
      async (
        subject: string,
        action: string,
        options: {
          cost?: string;
          shared?: string[];
          workspace?: string;
          json?: boolean;
        },
      ) => {
        const cost =
          options.cost === undefined ? undefined : Number(options.cost);
        if (cost !== undefined && !Number.isInteger(cost)) {
          throw new UsageError("--cost must be a whole number");
        }
        const decision = await ctx
          .client({ workspace: options.workspace })
          .checks.create(
            {
              subject: parseSubject(subject),
              action,
              ...(cost !== undefined ? { cost } : {}),
              ...(options.shared?.length
                ? { shared: options.shared.map(parseSubject) }
                : {}),
            },
            // No key here: the client sends one, or the global
            // --idempotency-key's, for every write.
          );
        ctx.io.stdout(options.json ? json(decision) : answer(decision));
        if (!decision.allowed) throw new RefusedError();
      },
    );
};

/** `user:user_123` → `{ kind: "user", id: "user_123" }` (the id may hold colons). */
export function parseSubject(value: string): { kind: string; id: string } {
  const at = value.indexOf(":");
  if (at <= 0 || at === value.length - 1) {
    throw new UsageError(
      `"${value}": write a subject as kind:id, e.g. user:user_123`,
    );
  }
  return { kind: value.slice(0, at), id: value.slice(at + 1) };
}

type Decision = Schemas["CheckDecision"];
type CheckLimit = Decision["limits"][number];

const left = (r: CheckLimit) =>
  `${r.limitName}: ${r.remaining} ${r.unit} left${r.resetsAt ? `, resets ${r.resetsAt}` : ""}`;

/** The decision in one line. */
export function answer(decision: Decision): string {
  if (decision.allowed) {
    return decision.limits.length === 0
      ? "Allowed. No limit applies."
      : `Allowed. ${decision.limits.map(left).join("; ")}`;
  }
  // The API's own sentence: the SDKs and the MCP server show the same.
  return decision.reason?.message ?? "Refused.";
}
