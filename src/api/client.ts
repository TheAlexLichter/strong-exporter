import { Context, Data, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { STRONG_BACKEND_DEFAULT } from "./constants.ts";
import type { AuthToken, Credentials, ExportData, Workout, WorkoutSet } from "./types.ts";

// ── Error types ──────────────────────────────────────────────────────────────

export class StrongAuthError extends Data.TaggedError("StrongAuthError")<{
  message: string;
  cause?: unknown;
}> {}

export class StrongApiError extends Data.TaggedError("StrongApiError")<{
  message: string;
  status?: number;
  cause?: unknown;
}> {}

// ── Service interface ────────────────────────────────────────────────────────

export class StrongClient extends Context.Tag("StrongClient")<
  StrongClient,
  {
    readonly login: (credentials: Credentials) => Effect.Effect<AuthToken, StrongAuthError>;
    readonly exportWorkouts: (
      credentials: Credentials,
    ) => Effect.Effect<ExportData, StrongAuthError | StrongApiError>;
  }
>() {}

// ── Internal types for API response parsing ──────────────────────────────────

interface Cell {
  cellType: string;
  value?: string | null;
}

interface CellSet {
  cells: Cell[];
  isCompleted?: boolean | null;
}

interface CellSetGroup {
  _links?: { measurement?: { href?: string } };
  cellSets: CellSet[];
}

interface RawLog {
  id: string;
  name?: { en?: string | null; custom?: string | null };
  logType?: string;
  startDate?: string | null;
  endDate?: string | null;
  timezoneId?: string | null;
  _embedded?: { cellSetGroup?: CellSetGroup[] };
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

const WEIGHT_CELL_TYPES = new Set([
  "OTHER_WEIGHT",
  "DUMBBELL_WEIGHT",
  "BARBELL_WEIGHT",
  "WEIGHTED_BODYWEIGHT",
]);

export function parseSet(cellSet: CellSet): { set: WorkoutSet; completed: boolean | null } | null {
  const types = cellSet.cells.map((c) => c.cellType);
  if (types.includes("REST_TIMER") || types.includes("NOTE")) return null;

  const weightCell = cellSet.cells.find((c) => WEIGHT_CELL_TYPES.has(c.cellType));
  const repsCell = cellSet.cells.find((c) => c.cellType === "REPS");
  const rpeCell = cellSet.cells.find((c) => c.cellType === "RPE");
  const distanceCell = cellSet.cells.find((c) => c.cellType === "DISTANCE");
  const durationCell = cellSet.cells.find((c) => c.cellType === "DURATION");

  return {
    set: {
      weightKg: weightCell?.value ? parseFloat(weightCell.value) : null,
      reps: repsCell?.value ? parseInt(repsCell.value, 10) : null,
      rpe: rpeCell?.value ? parseFloat(rpeCell.value) : null,
      distance: distanceCell?.value ? parseFloat(distanceCell.value) : null,
      duration: durationCell?.value ?? null,
    },
    completed: cellSet.isCompleted ?? null,
  };
}

export function transformLogs(
  logs: readonly RawLog[],
  measurementMap: Map<string, string>,
): Workout[] {
  return logs
    .filter((log) => log.logType === "WORKOUT" || log.logType === "LOG")
    .map((log) => {
      const exercises = (log._embedded?.cellSetGroup ?? [])
        .map((group) => {
          const measurementHref = group._links?.measurement?.href ?? "";
          const measurementId = measurementHref.split("/").pop() ?? "";
          const name = measurementMap.get(measurementId) ?? "Unknown";
          const parsed = group.cellSets
            .map(parseSet)
            .filter((s): s is { set: WorkoutSet; completed: boolean | null } => s !== null);
          const completedSets = parsed.filter((p) => p.completed !== false).map((p) => p.set);
          const skippedSets = parsed.filter((p) => p.completed === false).map((p) => p.set);
          return { name, completedSets, skippedSets };
        })
        .filter((e) => e.completedSets.length + e.skippedSets.length > 0);

      return {
        id: log.id,
        name: log.name?.en ?? log.name?.custom ?? null,
        startDate: log.startDate ?? null,
        endDate: log.endDate ?? null,
        timezone: log.timezoneId ?? null,
        exercises,
      };
    })
    .reverse();
}

// ── Live implementation ──────────────────────────────────────────────────────

export const makeStrongClientLive = (
  backend: string = STRONG_BACKEND_DEFAULT,
): Layer.Layer<StrongClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    StrongClient,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;

      const authedGet = (path: string, token: string) =>
        HttpClientRequest.get(new URL(path, backend).toString()).pipe(
          HttpClientRequest.setHeader("User-Agent", "Strong Android"),
          HttpClientRequest.setHeader("Accept", "application/json"),
          HttpClientRequest.setHeader("X-Client-Build", "600013"),
          HttpClientRequest.setHeader("X-Client-Platform", "android"),
          HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
        );

      const login = (credentials: Credentials) =>
        Effect.gen(function* () {
          const url = new URL("auth/login", backend).toString();

          const response = yield* httpClient.execute(
            HttpClientRequest.post(url).pipe(
              HttpClientRequest.setHeader("User-Agent", "Strong Android"),
              HttpClientRequest.setHeader("Accept", "application/json"),
              HttpClientRequest.setHeader("X-Client-Build", "600013"),
              HttpClientRequest.setHeader("X-Client-Platform", "android"),
              HttpClientRequest.bodyUnsafeJson({
                usernameOrEmail: credentials.usernameOrEmail,
                password: credentials.password,
              }),
            ),
          );

          if (response.status !== 200) {
            const text = yield* response.text;
            return yield* Effect.fail(
              new StrongAuthError({
                message: `Authentication failed: ${response.status} - ${text}`,
              }),
            );
          }

          const json = yield* response.json;
          const data = json as Record<string, unknown>;
          if (
            typeof data.accessToken !== "string" ||
            typeof data.refreshToken !== "string" ||
            typeof data.userId !== "string"
          ) {
            return yield* Effect.fail(
              new StrongAuthError({ message: "Unexpected login response shape" }),
            );
          }

          return {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            userId: data.userId,
          };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new StrongAuthError({
                message: error instanceof StrongAuthError ? error.message : "Authentication failed",
                cause: error,
              }),
            ),
          ),
        );

      // Fetch all exercise definitions → id-to-name lookup map
      const fetchMeasurements = (
        token: string,
        userId: string,
      ): Effect.Effect<Map<string, string>, StrongApiError> =>
        Effect.gen(function* () {
          const map = new Map<string, string>();

          const fetchFromEndpoint = (baseUrl: string) =>
            Effect.gen(function* () {
              let page = 0;
              while (true) {
                const url = new URL(baseUrl, backend);
                url.searchParams.set("page", String(page));

                const response = yield* httpClient.execute(authedGet(url.toString(), token));
                if (response.status !== 200) break;

                const json = yield* response.json;
                const data = json as {
                  _embedded?: {
                    measurement?: Array<{
                      id: string;
                      name?: { en?: string | null; custom?: string | null };
                    }>;
                  };
                  _links?: { next?: unknown };
                };

                const measurements = data._embedded?.measurement ?? [];
                for (const m of measurements) {
                  const name = m.name?.custom ?? m.name?.en ?? m.id;
                  map.set(m.id, name);
                }

                if (!data._links?.next || measurements.length === 0) break;
                page++;
              }
            });

          yield* fetchFromEndpoint("api/measurements");
          yield* fetchFromEndpoint(`api/users/${userId}/measurements`);

          return map;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new StrongApiError({ message: "Failed to fetch measurements", cause: error }),
            ),
          ),
        );

      // Fetch all workout logs via continuation-based pagination
      const fetchWorkoutLogs = (
        token: string,
        userId: string,
      ): Effect.Effect<readonly RawLog[], StrongApiError> =>
        Effect.gen(function* () {
          const logs: RawLog[] = [];
          let continuation = "";
          const limit = 200;

          while (true) {
            const url = new URL(`api/users/${userId}`, backend);
            url.searchParams.set("limit", String(limit));
            url.searchParams.set("continuation", continuation);
            url.searchParams.append("include", "log");

            const response = yield* httpClient.execute(authedGet(url.toString(), token));

            if (response.status !== 200) {
              const text = yield* response.text;
              return yield* Effect.fail(
                new StrongApiError({
                  message: `Failed to fetch logs: ${response.status} - ${text}`,
                  status: response.status,
                }),
              );
            }

            const json = yield* response.json;
            const data = json as {
              _embedded?: { log?: RawLog[] };
              _links?: { continuation?: { href?: string } };
            };

            const batch = data._embedded?.log ?? [];
            logs.push(...batch);

            const nextHref = data._links?.continuation?.href;
            if (!nextHref || batch.length === 0) break;

            const nextUrl = new URL(nextHref, backend);
            continuation = nextUrl.searchParams.get("continuation") ?? "";
            if (!continuation) break;
          }

          return logs;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.fail(
              new StrongApiError({ message: "Failed to fetch workout logs", cause: error }),
            ),
          ),
        );

      const exportWorkouts = (
        credentials: Credentials,
      ): Effect.Effect<ExportData, StrongAuthError | StrongApiError> =>
        Effect.gen(function* () {
          const { accessToken, userId } = yield* login(credentials);

          const [measurementMap, logs] = yield* Effect.all([
            fetchMeasurements(accessToken, userId),
            fetchWorkoutLogs(accessToken, userId),
          ]);

          const workouts = transformLogs(logs, measurementMap);

          return {
            exportedAt: new Date().toISOString(),
            totalWorkouts: workouts.length,
            workouts,
          };
        });

      return { login, exportWorkouts };
    }),
  );
