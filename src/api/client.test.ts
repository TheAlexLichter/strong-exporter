import { expect, test, describe } from "vite-plus/test";
import { parseSet, transformLogs } from "./client.ts";

// ── parseSet ─────────────────────────────────────────────────────────────────

describe("parseSet", () => {
  test("returns null for REST_TIMER cells", () => {
    expect(parseSet({ cells: [{ cellType: "REST_TIMER", value: "60" }] })).toBeNull();
  });

  test("returns null for NOTE cells", () => {
    expect(parseSet({ cells: [{ cellType: "NOTE", value: "good session" }] })).toBeNull();
  });

  test("parses a standard weight + reps set", () => {
    expect(
      parseSet({
        cells: [
          { cellType: "BARBELL_WEIGHT", value: "100" },
          { cellType: "REPS", value: "5" },
        ],
        isCompleted: true,
      }),
    ).toEqual({
      set: {
        weightKg: 100,
        reps: 5,
        rpe: null,
        distance: null,
        duration: null,
      },
      completed: true,
    });
  });

  test("parses dumbbell weight", () => {
    const result = parseSet({
      cells: [
        { cellType: "DUMBBELL_WEIGHT", value: "22.5" },
        { cellType: "REPS", value: "8" },
      ],
    });
    expect(result?.set.weightKg).toBe(22.5);
    expect(result?.set.reps).toBe(8);
  });

  test("parses OTHER_WEIGHT and WEIGHTED_BODYWEIGHT cell types", () => {
    for (const cellType of ["OTHER_WEIGHT", "WEIGHTED_BODYWEIGHT"] as const) {
      const result = parseSet({ cells: [{ cellType, value: "10" }] });
      expect(result?.set.weightKg).toBe(10);
    }
  });

  test("parses RPE", () => {
    const result = parseSet({
      cells: [
        { cellType: "BARBELL_WEIGHT", value: "80" },
        { cellType: "REPS", value: "3" },
        { cellType: "RPE", value: "8.5" },
      ],
    });
    expect(result?.set.rpe).toBe(8.5);
  });

  test("parses distance", () => {
    const result = parseSet({ cells: [{ cellType: "DISTANCE", value: "5.0" }] });
    expect(result?.set.distance).toBe(5.0);
  });

  test("parses duration", () => {
    const result = parseSet({ cells: [{ cellType: "DURATION", value: "00:30:00" }] });
    expect(result?.set.duration).toBe("00:30:00");
  });

  test("nulls optional fields when cells are absent", () => {
    const result = parseSet({ cells: [{ cellType: "REPS", value: "10" }] });
    expect(result).toEqual({
      set: {
        weightKg: null,
        reps: 10,
        rpe: null,
        distance: null,
        duration: null,
      },
      completed: null,
    });
  });

  test("nulls completed when isCompleted is absent", () => {
    const result = parseSet({ cells: [{ cellType: "REPS", value: "1" }] });
    expect(result?.completed).toBeNull();
  });
});

// ── transformLogs ─────────────────────────────────────────────────────────────

describe("transformLogs", () => {
  const measurementMap = new Map([["abc123", "Squat (Barbell)"]]);

  const makeLog = (overrides: object = {}) => ({
    id: "log-1",
    logType: "WORKOUT",
    startDate: "2026-01-01T10:00:00Z",
    endDate: "2026-01-01T11:00:00Z",
    _embedded: {
      cellSetGroup: [
        {
          _links: { measurement: { href: "/api/measurements/abc123" } },
          cellSets: [
            {
              cells: [
                { cellType: "BARBELL_WEIGHT", value: "100" },
                { cellType: "REPS", value: "5" },
              ],
              isCompleted: true,
            },
          ],
        },
      ],
    },
    ...overrides,
  });

  test("transforms a basic workout log", () => {
    const [workout] = transformLogs([makeLog()], measurementMap);
    expect(workout.id).toBe("log-1");
    expect(workout.exercises).toHaveLength(1);
    expect(workout.exercises[0].name).toBe("Squat (Barbell)");
    expect(workout.exercises[0].completedSets[0]).toEqual({
      weightKg: 100,
      reps: 5,
      rpe: null,
      distance: null,
      duration: null,
    });
    expect(workout.exercises[0].skippedSets).toHaveLength(0);
  });

  test("filters out non-WORKOUT/LOG logTypes", () => {
    const result = transformLogs([makeLog({ logType: "MEASUREMENT" })], measurementMap);
    expect(result).toHaveLength(0);
  });

  test("accepts LOG logType", () => {
    const result = transformLogs([makeLog({ logType: "LOG" })], measurementMap);
    expect(result).toHaveLength(1);
  });

  test("falls back to 'Unknown' for unmapped measurement id", () => {
    const result = transformLogs([makeLog()], new Map());
    expect(result[0].exercises[0].name).toBe("Unknown");
  });

  test("excludes exercises where all sets are REST_TIMER or NOTE", () => {
    const log = makeLog({
      _embedded: {
        cellSetGroup: [
          {
            _links: { measurement: { href: "/api/measurements/abc123" } },
            cellSets: [{ cells: [{ cellType: "REST_TIMER", value: "60" }] }],
          },
        ],
      },
    });
    const [workout] = transformLogs([log], measurementMap);
    expect(workout.exercises).toHaveLength(0);
  });

  test("splits completed and skipped sets correctly", () => {
    const log = makeLog({
      _embedded: {
        cellSetGroup: [
          {
            _links: { measurement: { href: "/api/measurements/abc123" } },
            cellSets: [
              {
                cells: [
                  { cellType: "BARBELL_WEIGHT", value: "100" },
                  { cellType: "REPS", value: "5" },
                ],
                isCompleted: true,
              },
              {
                cells: [
                  { cellType: "BARBELL_WEIGHT", value: "110" },
                  { cellType: "REPS", value: "3" },
                ],
                isCompleted: false,
              },
            ],
          },
        ],
      },
    });
    const [workout] = transformLogs([log], measurementMap);
    expect(workout.exercises[0].completedSets).toHaveLength(1);
    expect(workout.exercises[0].skippedSets).toHaveLength(1);
    expect(workout.exercises[0].skippedSets[0].weightKg).toBe(110);
  });

  test("uses custom name when en name is absent", () => {
    const log = makeLog({ name: { custom: "My Workout" } });
    const [workout] = transformLogs([log], measurementMap);
    expect(workout.name).toBe("My Workout");
  });

  test("sets workout name to null when no name provided", () => {
    const log = makeLog({ name: undefined });
    const [workout] = transformLogs([log], measurementMap);
    expect(workout.name).toBeNull();
  });
});
