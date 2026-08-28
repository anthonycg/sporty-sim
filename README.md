# Sporty Sim

Sporty Sim is a transparent football totals simulator. The MVP loads upcoming NFL or college-football matchups, lets you define each team's pace and efficiency assumptions, samples uncertain player availability, and runs 50,000 drive-level game simulations in the browser.

## Run it

Requires Node.js 20 or newer. There are no package dependencies.

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Tonight's workflow

1. Select the league and date, then choose a game from the live slate.
2. Enter your best pregame assumptions for offense, defense, pace, play mix, efficiency, turnovers, and red-zone rate. Ratings use 50 as neutral and 0–100 as the allowed range.
3. Add players whose availability is uncertain. `Chance limited` is included within `chance to play`; the remaining probability is fully active. The points impact is multiplied by expected snap share.
4. Enter the market total and weather severity.
5. Run 50,000 simulations and compare the full distribution—not only the mean—to the line.

Inputs are saved in browser storage. Selecting a different game starts with neutral team assumptions to prevent accidental carryover.

## Model behavior

- Simulates alternating drives until regulation time expires, with an overtime approximation for ties.
- Estimates points per drive from offense/defense ratings, passing and rushing efficiency, success, explosiveness, red-zone rate, turnovers, weather, and player availability.
- Changes pass rate and drive duration when a team is leading or trailing.
- Samples each uncertain player as active, limited, or out on every run.
- Applies extra continuity cost when multiple players from the same unit are out.
- Uses a lower neutral scoring baseline and higher variance for preseason games.
- Returns projected team scores, mean and median total, an 80% interval, over/under probabilities, fair no-vig odds, and a histogram.

The schedule and displayed market context come from ESPN's public scoreboard feed. Team-strength values and injury probabilities are **not** automatically sourced in this MVP; they are user assumptions. Market odds are context, never training input.

## Verification

```bash
npm test
npm run smoke
```

`npm test` checks model determinism, monotonic offense behavior, offensive and defensive injury direction, and fair-odds conversion. `npm run smoke` performs a real headless-browser check on macOS with Google Chrome installed.

## Important limitation

This is an exploratory model, not a validated betting system. A stable simulation only reduces Monte Carlo sampling error; it does not remove model error. Predictions should be logged before kickoff and evaluated against outcomes and closing lines over a meaningful sample before any reliance is placed on them.
