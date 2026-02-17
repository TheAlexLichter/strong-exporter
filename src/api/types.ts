// Credentials
export interface Credentials {
  usernameOrEmail: string;
  password: string;
}

// Auth token returned by the Strong login endpoint
export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

// A single performed set within an exercise
export interface WorkoutSet {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  distance: number | null;
  duration: string | null;
  completed: boolean | null;
}

// An exercise logged in a workout
export interface WorkoutExercise {
  name: string;
  sets: WorkoutSet[];
}

// A complete workout session
export interface Workout {
  id: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  exercises: WorkoutExercise[];
}

// Top-level export document
export interface ExportData {
  exportedAt: string;
  totalWorkouts: number;
  workouts: Workout[];
}
