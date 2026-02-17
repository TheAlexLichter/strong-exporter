import type { ExportData, Workout } from "./api/types.ts";

export const toCSV = (data: ExportData): string => {
  const lines: string[] = [
    "date,workoutName,exerciseName,setNumber,weightKg,reps,rpe,distance,duration,status",
  ];

  for (const workout of data.workouts) {
    for (const exercise of workout.exercises) {
      const allSets = [
        ...exercise.completedSets.map((s) => ({ ...s, status: "completed" })),
        ...exercise.skippedSets.map((s) => ({ ...s, status: "skipped" })),
      ];
      allSets.forEach((set, i) => {
        lines.push(
          [
            workout.startDate ?? "",
            `"${(workout.name ?? "").replace(/"/g, '""')}"`,
            `"${exercise.name.replace(/"/g, '""')}"`,
            i + 1,
            set.weightKg ?? "",
            set.reps ?? "",
            set.rpe ?? "",
            set.distance ?? "",
            set.duration ?? "",
            set.status,
          ].join(","),
        );
      });
    }
  }

  return lines.join("\n");
};

export const filterByDateRange = (workouts: Workout[], from: Date, to: Date): Workout[] =>
  workouts.filter((w) => {
    if (!w.startDate) return false;
    const d = new Date(w.startDate);
    return d >= from && d <= to;
  });
