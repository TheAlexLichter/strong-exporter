# Strong Exporter

Export your workout data from the [Strong](https://www.strong.app/) iOS/Android app via their unofficial backend API.

## Setup

1. Find the backend URL by proxying the Strong app (e.g. with mitmproxy — open the app, trigger a sync, grab the host from the request list).
2. Create a `.env` file:

```
STRONG_BACKEND=https://the-url-you-found
STRONG_USER=your@email.com
STRONG_PASS=yourpassword
```

3. Install dependencies:

```bash
pnpm install
```

## Usage

```bash
vp run start export [options]
```

### Options

| Option       | Alias | Description                                | Default                                 |
| ------------ | ----- | ------------------------------------------ | --------------------------------------- |
| `--username` | `-u`  | Strong account email (or `STRONG_USER`)    |                                         |
| `--password` | `-p`  | Strong account password (or `STRONG_PASS`) | prompts                                 |
| `--from`     |       | Start date, inclusive (e.g. `2026-01-01`)  | 30 days ago                             |
| `--to`       |       | End date, inclusive (e.g. `2026-02-17`)    | today                                   |
| `--format`   |       | `json` or `csv`                            | `json`                                  |
| `--output`   | `-o`  | Output file path                           | `exports/strong-export-YYYY-MM-DD.json` |

### Examples

```bash
# Last 30 days (default)
vp run start export

# Specific date range
vp run start export --from 2026-01-01 --to 2026-01-31

# Export as CSV
vp run start export --format csv

# Custom output path
vp run start export --output my-workouts.json
```

## Output

Exports are saved to `exports/` by default. Null fields are omitted. Weights are always in kg.

### JSON

```json
{
  "exportedAt": "2026-02-17T15:00:00.000Z",
  "totalWorkouts": 12,
  "workouts": [
    {
      "id": "b9627caf-...",
      "name": "Push Day",
      "startDate": "2026-02-15T10:00:00.000Z",
      "endDate": "2026-02-15T11:15:00.000Z",
      "exercises": [
        {
          "name": "Bench Press (Barbell)",
          "completedSets": [
            { "weightKg": 80, "reps": 5 },
            { "weightKg": 85, "reps": 3 }
          ],
          "skippedSets": []
        }
      ]
    }
  ]
}
```

### CSV

```
date,workoutName,exerciseName,setNumber,weightKg,reps,rpe,distance,duration,status
2026-02-15T10:00:00.000Z,"Push Day","Bench Press (Barbell)",1,80,5,,,,completed
```

## Background

Strong syncs workout data to a backend server. There's no official API, but the endpoints can be reverse-engineered from the app traffic. Originally based on [tolik518/strong-api-workout-fetch](https://github.com/tolik518/strong-api-workout-fetch).
