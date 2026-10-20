# @limitry/cli

The Limitry CLI sets up your limits and checks them from a terminal, a script or an agent: create a limit, try a check, and see who is using what, in test before live.

Limitry is the limits, credits and budgets layer for your software: give each of your users, teams, tenants, API keys or agents an allowance, and before any costly action one call tells your code whether it may happen.

## Install

```bash
npm install -g @limitry/cli
```

Or run it without installing: `npx @limitry/cli --help`.

## Sign in

```bash
limitry login
```

Your browser opens: sign in, choose the workspaces the CLI may use, and
click **Allow**. On a server or in CI, set `LIMITRY_TOKEN` to a personal
access token or a workspace API key instead.

## Set up a limit and try it

Commands act in **test** unless you say otherwise, so trying things
never touches the limits your customers depend on.

```bash
# 100 AI replies a day for each user ("100 replies per user per day for ai-call")
limitry limits create --subject '{"kind":"user"}' --action ai-call \
  --amount 100 --unit replies --window day

# Check a user, as your code would
limitry check user:usr_123 ai-call

# Where a user stands, without counting anything
limitry usage standing --subject user:usr_123
```

When a limit is right, copy it to live from the **Limits** page in the
app, or create it with `--environment live`.

## Everything else

Every API operation is a command: `limitry --help` lists them, and any
command takes `--json` for the API's exact answer, for scripts and
agents.

## Links

- [Website](https://limitry.com)
- [CLI guide](https://limitry.com/docs/cli/)
- [API reference](https://limitry.com/docs/reference/)
- [Changelog](https://github.com/limitry/limitry-cli/blob/main/CHANGELOG.md)
- [Discord](https://limitry.com/discord)
- [Report a security issue](https://limitry.com/security/)

## Contributing

This repository is generated from Limitry's source on each
release, so pull requests are ported there and credited (see
[CONTRIBUTING.md](https://github.com/limitry/limitry-cli/blob/main/CONTRIBUTING.md)).

## License

Licensed under the Apache License 2.0.
