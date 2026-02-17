import { expect, test, describe } from "vite-plus/test";
import { toCSV, filterByDateRange } from "./transform.ts";
import type { ExportData, Workout } from "./api/types.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

const makeWorkout = (startDate: string | null, overrides: Partial<Workout> = {}): Workout => ({
  id: "w1",
  name: "Push Day",
  startDate,
  endDate: null,
  timezone: null,
  exercises: [
    {
      name: "Bench Press (Barbell)",
      completedSets: [{ weightKg: 80, reps: 5, rpe: null, distance: null, duration: null }],
      skippedSets: [],
    },
  ],
  ...overrides,
});

const makeExportData = (workouts: Workout[]): ExportData => ({
  exportedAt: "2026-02-17T00:00:00Z",
  totalWorkouts: workouts.length,
  workouts,
});

// ── filterByDateRange ─────────────────────────────────────────────────────────

describe("filterByDateRange", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  const to = new Date("2026-01-31T23:59:59Z");

  test("keeps workouts within range", () => {
    const w = makeWorkout("2026-01-15T10:00:00Z");
    expect(filterByDateRange([w], from, to)).toHaveLength(1);
  });

  test("excludes workouts before range", () => {
    const w = makeWorkout("2025-12-31T23:59:59Z");
    expect(filterByDateRange([w], from, to)).toHaveLength(0);
  });

  test("excludes workouts after range", () => {
    const w = makeWorkout("2026-02-01T00:00:00Z");
    expect(filterByDateRange([w], from, to)).toHaveLength(0);
  });

  test("includes workouts exactly on the boundary dates", () => {
    const atStart = makeWorkout("2026-01-01T00:00:00Z");
    const atEnd = makeWorkout("2026-01-31T23:59:59Z");
    expect(filterByDateRange([atStart], from, to)).toHaveLength(1);
    expect(filterByDateRange([atEnd], from, to)).toHaveLength(1);
  });

  test("excludes workouts with no startDate", () => {
    const w = makeWorkout(null);
    expect(filterByDateRange([w], from, to)).toHaveLength(0);
  });

  test("filters a mixed list correctly", () => {
    const workouts = [
      makeWorkout("2025-12-01T00:00:00Z"),
      makeWorkout("2026-01-10T00:00:00Z"),
      makeWorkout("2026-01-20T00:00:00Z"),
      makeWorkout("2026-03-01T00:00:00Z"),
    ];
    const result = filterByDateRange(workouts, from, to);
    expect(result).toHaveLength(2);
  });
});

// ── toCSV ─────────────────────────────────────────────────────────────────────

describe("toCSV", () => {
  test("includes the correct header row", () => {
    const csv = toCSV(makeExportData([]));
    expect(csv.split("\n")[0]).toBe(
      "date,workoutName,exerciseName,setNumber,weightKg,reps,rpe,distance,duration,status",
    );
  });

  test("produces one row per set", () => {
    const workout = makeWorkout("2026-01-15T10:00:00Z", {
      exercises: [
        {
          name: "Squat",
          completedSets: [
            { weightKg: 100, reps: 5, rpe: null, distance: null, duration: null },
            { weightKg: 110, reps: 3, rpe: null, distance: null, duration: null },
          ],
          skippedSets: [],
        },
      ],
    });
    const lines = toCSV(makeExportData([workout])).split("\n");
    expect(lines).toHaveLength(3); // header + 2 sets
  });

  test("outputs completed sets before skipped sets within an exercise", () => {
    const workout = makeWorkout("2026-01-15T10:00:00Z", {
      exercises: [
        {
          name: "Squat",
          completedSets: [{ weightKg: 80, reps: 8, rpe: null, distance: null, duration: null }],
          skippedSets: [{ weightKg: 100, reps: 5, rpe: null, distance: null, duration: null }],
        },
      ],
    });
    const lines = toCSV(makeExportData([workout])).split("\n");
    expect(lines[1].split(",")[4]).toBe("80"); // completed set first
    expect(lines[2].split(",")[4]).toBe("100"); // skipped set second
  });

  test("status column is 'completed' or 'skipped'", () => {
    const workout = makeWorkout("2026-01-15T10:00:00Z", {
      exercises: [
        {
          name: "Squat",
          completedSets: [{ weightKg: 80, reps: 8, rpe: null, distance: null, duration: null }],
          skippedSets: [{ weightKg: 100, reps: 5, rpe: null, distance: null, duration: null }],
        },
      ],
    });
    const lines = toCSV(makeExportData([workout])).split("\n");
    expect(lines[1].split(",")[9]).toBe("completed");
    expect(lines[2].split(",")[9]).toBe("skipped");
  });

  test("set numbers are 1-indexed", () => {
    const workout = makeWorkout("2026-01-15T10:00:00Z");
    const lines = toCSV(makeExportData([workout])).split("\n");
    expect(lines[1].split(",")[3]).toBe("1");
  });

  test("quotes workout and exercise names containing commas", () => {
    const workout = makeWorkout("2026-01-15T10:00:00Z", {
      name: "Push, Pull",
      exercises: [
        {
          name: "Curl, Barbell",
          completedSets: [{ weightKg: 20, reps: 10, rpe: null, distance: null, duration: null }],
          skippedSets: [],
        },
      ],
    });
    const row = toCSV(makeExportData([workout])).split("\n")[1];
    expect(row).toContain('"Push, Pull"');
    expect(row).toContain('"Curl, Barbell"');
  });

  test("escapes double quotes in names", () => {
    const workout = makeWorkout("2026-01-15T10:00:00Z", { name: 'The "Big" Day' });
    const row = toCSV(makeExportData([workout])).split("\n")[1];
    expect(row).toContain('"The ""Big"" Day"');
  });

  test("outputs empty string for null optional fields", () => {
    const workout = makeWorkout("2026-01-15T10:00:00Z", {
      exercises: [
        {
          name: "Run",
          completedSets: [
            {
              weightKg: null,
              reps: null,
              rpe: null,
              distance: 5.0,
              duration: "00:30:00",
            },
          ],
          skippedSets: [],
        },
      ],
    });
    const cols = toCSV(makeExportData([workout]))
      .split("\n")[1]
      .split(",");
    expect(cols[4]).toBe(""); // weightKg
    expect(cols[5]).toBe(""); // reps
  });
});
