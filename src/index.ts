#!/usr/bin/env node
import { Command, Options } from "@effect/cli";
import { NodeContext, NodeHttpClient, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer, Option } from "effect";
import * as fs from "node:fs";
import * as readline from "node:readline";
import {
  StrongClient,
  StrongAuthError,
  StrongApiError,
  makeStrongClientLive,
} from "./api/client.ts";
import { STRONG_BACKEND_DEFAULT } from "./api/constants.ts";
import { toCSV, filterByDateRange } from "./transform.ts";

// ── Password prompt ──────────────────────────────────────────────────────────

const promptPassword = (prompt: string): Promise<string> =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(prompt);

    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);

    let password = "";
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char: string) => {
      const code = char.charCodeAt(0);
      if (code === 13 || code === 10) {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
        rl.close();
        console.log();
        resolve(password);
      } else if (code === 3) {
        process.exit(1);
      } else if (code === 127 || code === 8) {
        password = password.slice(0, -1);
      } else {
        password += char;
      }
    };
    stdin.on("data", onData);
  });

// ── CLI options ──────────────────────────────────────────────────────────────

const usernameOption = Options.text("username").pipe(
  Options.withAlias("u"),
  Options.withDescription("Strong account email (or set STRONG_USER)"),
  Options.optional,
);

const passwordOption = Options.text("password").pipe(
  Options.withAlias("p"),
  Options.withDescription("Strong account password (or set STRONG_PASS, will prompt if omitted)"),
  Options.optional,
);

const outputOption = Options.text("output").pipe(
  Options.withAlias("o"),
  Options.withDescription("Output file path"),
  Options.optional,
);

const formatOption = Options.text("format").pipe(
  Options.withDescription("Output format: json or csv"),
  Options.withDefault("json"),
);

const fromOption = Options.text("from").pipe(
  Options.withDescription(
    "Start date inclusive (ISO date, e.g. 2026-01-01). Defaults to 30 days ago.",
  ),
  Options.optional,
);

const toOption = Options.text("to").pipe(
  Options.withDescription("End date inclusive (ISO date, e.g. 2026-12-31). Defaults to today."),
  Options.optional,
);

// Helpers to resolve credential values from options or env
const resolveUsername = (opt: Option.Option<string>): string | undefined =>
  Option.isSome(opt) ? opt.value : process.env.STRONG_USER;

const resolvePassword = (opt: Option.Option<string>): string | undefined =>
  Option.isSome(opt) ? opt.value : process.env.STRONG_PASS;

// ── Export command ───────────────────────────────────────────────────────────

const exportCommand = Command.make(
  "export",
  {
    username: usernameOption,
    password: passwordOption,
    output: outputOption,
    format: formatOption,
    from: fromOption,
    to: toOption,
  },
  ({ username, password, output, format, from, to }) =>
    Effect.gen(function* () {
      const client = yield* StrongClient;

      const actualUsername = resolveUsername(username);
      if (!actualUsername) {
        yield* Console.error("Username required: use --username or set STRONG_USER");
        return;
      }

      const actualPassword =
        resolvePassword(password) ?? (yield* Effect.promise(() => promptPassword("Password: ")));

      const outputFormat = format.toLowerCase();
      if (outputFormat !== "json" && outputFormat !== "csv") {
        yield* Console.error(`Invalid format: ${format}. Must be 'json' or 'csv'`);
        return;
      }

      yield* Console.log("Logging in to Strong...");

      const raw = yield* client
        .exportWorkouts({ usernameOrEmail: actualUsername, password: actualPassword })
        .pipe(
          Effect.mapError((e) =>
            e instanceof StrongAuthError
              ? new StrongAuthError({ message: e.message })
              : new StrongApiError({ message: e.message }),
          ),
        );

      // Date range filtering
      const now = new Date();
      const fromDate = Option.isSome(from)
        ? new Date(from.value)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const toDate = Option.isSome(to)
        ? (() => {
            const d = new Date(to.value);
            d.setUTCHours(23, 59, 59, 999);
            return d;
          })()
        : now;

      const filteredWorkouts = filterByDateRange(raw.workouts, fromDate, toDate);

      const data = { ...raw, totalWorkouts: filteredWorkouts.length, workouts: filteredWorkouts };

      const totalSets = data.workouts.reduce(
        (sum, w) =>
          sum + w.exercises.reduce((s, e) => s + e.completedSets.length + e.skippedSets.length, 0),
        0,
      );

      const extension = outputFormat === "csv" ? "csv" : "json";
      const stripNulls = (_key: string, value: unknown) => (value === null ? undefined : value);
      const content = outputFormat === "csv" ? toCSV(data) : JSON.stringify(data, stripNulls, 2);

      const exportsDir = "exports";
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }

      const finalPath = Option.isSome(output)
        ? output.value.endsWith(`.${extension}`)
          ? output.value
          : `${output.value}.${extension}`
        : `${exportsDir}/strong-export-${new Date().toISOString().split("T")[0]}.${extension}`;

      fs.writeFileSync(finalPath, content);

      const fmtDate = (d: Date) => d.toISOString().split("T")[0];
      yield* Console.log(
        `\nExported ${data.totalWorkouts} workouts (${totalSets} sets) from ${fmtDate(fromDate)} to ${fmtDate(toDate)}.`,
      );
      yield* Console.log(`Saved to: ${finalPath}`);
    }).pipe(
      Effect.catchTag("StrongAuthError", (e) =>
        Console.error(`\nLogin failed: ${e.message}\n\nCheck your username and password.`),
      ),
      Effect.catchTag("StrongApiError", (e) => Console.error(`\nExport failed: ${e.message}`)),
    ),
);

// ── Login test command ───────────────────────────────────────────────────────

const loginCommand = Command.make(
  "login",
  { username: usernameOption, password: passwordOption },
  ({ username, password }) =>
    Effect.gen(function* () {
      const client = yield* StrongClient;

      const actualUsername = resolveUsername(username);
      if (!actualUsername) {
        yield* Console.error("Username required: use --username or set STRONG_USER");
        return;
      }

      const actualPassword =
        resolvePassword(password) ?? (yield* Effect.promise(() => promptPassword("Password: ")));

      yield* Console.log("Testing authentication...");

      const token = yield* client.login({
        usernameOrEmail: actualUsername,
        password: actualPassword,
      });

      yield* Console.log("Login successful!");
      yield* Console.log(`User ID: ${token.userId}`);
    }).pipe(
      Effect.catchTag("StrongAuthError", (e) => Console.error(`\nLogin failed: ${e.message}`)),
    ),
);

// ── Main command + CLI ───────────────────────────────────────────────────────

const mainCommand = Command.make("strong-export").pipe(
  Command.withDescription("Export your workout data from the Strong app"),
  Command.withSubcommands([exportCommand, loginCommand]),
);

const cli = Command.run(mainCommand, {
  name: "strong-export",
  version: "1.0.0",
});

// Build the layer from CLI options (backend resolved per-run from env/options)
// We defer layer construction until after args are parsed by running in a context
// where the backend option is read from env. For per-command overrides, the
// makeStrongClientLive factory is used here with the env-level backend.
const backendUrl = process.env.STRONG_BACKEND ?? STRONG_BACKEND_DEFAULT;

const MainLayer = makeStrongClientLive(backendUrl).pipe(Layer.provide(NodeHttpClient.layer));

cli(process.argv).pipe(
  Effect.provide(MainLayer),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
