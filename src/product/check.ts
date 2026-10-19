import { brand } from "../brand/index.ts";
import type { Schemas } from "@limitry/sdk";

import type { Command } from "../cli.ts";
import { json } from "../output.ts";

/**
 * `limitry check <kind>:<id> <action> [--cost N] [--shared kind:id …]` —
 * the short form of `limitry checks create` (`POST /v1/checks`, consume
 * mode): one line saying allowed or refused, what's left and when it
 * resets. A refusal is an answer, not an error, so it exits 0; a failed
 * call (no token, a bad request) exits 1. `--json` prints the decision as
 * the API answers it.
 */
export const checkCommand: Command = (program, ctx) => {
  program
    .command("check")
    .description(`Short for \`${brand.name} checks create\``)
    .argument("<subject>", "who is acting, as kind:id (user:usr_123)")
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
      `\nExample: ${brand.name} check user:usr_123 ai-call --cost 5\nA refusal exits 0: it's an answer. Errors exit 1.`,
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
          throw new Error("--cost must be a whole number");
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
            { idempotencyKey: crypto.randomUUID() },
          );
        ctx.io.stdout(options.json ? json(decision) : answer(decision));
      },
    );
};

/** `user:usr_123` → `{ kind: "user", id: "usr_123" }` (the id may hold colons). */
export function parseSubject(value: string): { kind: string; id: string } {
  const at = value.indexOf(":");
  if (at <= 0 || at === value.length - 1) {
    throw new Error(
      `"${value}": write a subject as kind:id, e.g. user:usr_123`,
    );
  }
  return { kind: value.slice(0, at), id: value.slice(at + 1) };
}

type Decision = Schemas["CheckDecision"];
type Remaining = Decision["remaining"][number];

const left = (r: Remaining) =>
  `${r.name}: ${r.remaining} ${r.unit} left${r.resetsAt ? `, resets ${r.resetsAt}` : ""}`;

/** The decision in one line. */
export function answer(decision: Decision): string {
  if (decision.allowed) {
    return decision.remaining.length === 0
      ? "Allowed. No limit applies."
      : `Allowed. ${decision.remaining.map(left).join("; ")}`;
  }
  // The API's own sentence: the SDKs and the MCP server show the same.
  return decision.reason?.message ?? "Refused.";
}
