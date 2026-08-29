# Sporty Sim

Sporty Sim is a transparent football totals simulator. It loads upcoming NFL or college-football matchups, builds opponent-adjusted recent-game profiles, samples uncertain player availability, and runs both drive-level and play-level game simulations in the browser. Version 0.4 also records prospective forecasts and grades them after games finish.

## Run it

Requires Node.js 20 or newer. There are no package dependencies.

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Tonight's workflow

1. Select the league and date, then choose a game from the live slate.
2. Select **Auto-rate recent games** to process up to three completed games strictly before kickoff. The app estimates EPA, measures play outcomes, adjusts production for available opponent history, applies recency weighting and league-average shrinkage, then fills the team inputs. You can still override any value.
3. Add players whose availability is uncertain. `Chance limited` is included within `chance to play`; the remaining probability is fully active. The points impact is multiplied by expected snap share.
4. Enter the market total and weather severity.
5. Choose drive-level, play-level, or comparison mode. Comparison runs 200k complete games through each engine.
6. Compare the distribution—not only the mean—to the line and inspect whether the models agree.
7. A run made before kickoff is timestamped automatically in `data/predictions.json`. Select **Refresh results** after games finish to grade the immutable forecasts.

Every click generates a fresh random seed, displayed with the result for auditing. Reusing a seed in code reproduces the exact simulated sample. With 200k games per engine, independent runs should remain close and can still round to the same displayed tenth of a percentage point.

Inputs are saved in browser storage. Selecting a different game starts with neutral team assumptions to prevent accidental carryover.

## Objective recent-game profiles

The server downloads completed pregame box scores, drives, and play-by-play. The extractor calculates plays, pace, dropbacks, pass rate, net yards per dropback, rushing efficiency, success rate, explosive-play rate, turnovers per drive, red-zone rate, points per drive, and a transparent state-value estimate of EPA per play. It separately measures what each defense allowed.

Each recent game is normalized using the opponent's available form before that game. If a team produced against a defense that had been allowing more than the league baseline, the excess attributable to that weak defense is removed before shrinkage. If the opponent had no earlier games, the profile falls back to unadjusted production and reports how many games could be opponent-adjusted.

Offensive outcomes come directly from their component measurements. Defense is represented by net passing yards allowed per dropback, rushing yards allowed, success allowed, explosives allowed, sack/pressure rate, takeaways per drive, and estimated EPA allowed. The prominent overall offense and defense ratings are calculated 0–100 summaries of those underlying fields and update when a component changes. The smaller offensive and defensive adjustment fields add or subtract rating points for information outside the measured data. Only that independent manual adjustment enters the simulator's rating term; feeding the calculated summary back on top of its source components would count the same production twice.

Recent games receive more weight. Every noisy statistic is blended toward a league and season-type baseline according to its relevant sample size. For example, passing efficiency is weighted by dropbacks while turnover rate is weighted by drives. The API returns observed, opponent-adjusted, final shrunk, and baseline values plus the sample behind each estimate.

The kickoff timestamp is a hard cutoff, preventing the game being predicted—or any later game—from entering its profile.

## Drive model behavior

- Simulates alternating drives until regulation time expires, with an overtime approximation for ties.
- Estimates points per drive from offense/defense ratings, passing and rushing efficiency, success, explosiveness, red-zone rate, turnovers, weather, and player availability.
- Changes pass rate and drive duration when a team is leading or trailing.
- Samples each uncertain player as active, limited, or out on every run.
- Maps availability to position-relevant components: quarterbacks affect passing, turnovers, explosiveness, and red-zone production; offensive linemen affect pass/rush efficiency and success; secondary players affect pass defense and explosives allowed; front-seven players affect rushing defense and pressure.
- Applies extra position-specific continuity cost when multiple players from the same unit are out.
- Uses a lower neutral scoring baseline and higher variance for preseason games.
- Returns projected team scores, mean and median total, an 80% interval, over/under probabilities, fair no-vig odds, and a histogram.

## Play model behavior

- Simulates roughly 120–140 individual offensive snaps for every complete game.
- Tracks possession, down, distance, field position, score, regulation clock, halftime possession, and fourth-down state.
- Chooses run or pass from team tendency plus down, distance, clock, and score differential.
- Samples completions, incompletions, sacks, interceptions, rushing outcomes, explosive gains, fumbles, and simplified penalties.
- Fits completion, sack, interception, pass-explosive, rush-explosive, and rushing-fumble rates from each team's available historical plays. Empirical-Bayes priors keep small samples from producing extreme probabilities, and neutral league rates remain the fallback when no profile is loaded.
- Updates first downs, turnovers, touchdowns, safeties, punts, and field goals after each snap.
- Uses a lower scoring environment for preseason rotation uncertainty and applies player/weather modifiers.
- Uses a compact overtime approximation; a full NFL overtime rules engine is not yet implemented.

The schedule, displayed market context, box scores, drives, and historical plays come from ESPN's public scoreboard feed. Injury probabilities remain user assumptions. Market odds are context, never a team-strength input.

## Prospective validation

Every eligible run is written before kickoff with its model version, seed, market total, projected total, team projections, and over/under probabilities. Refreshing results adds the final score without changing those original fields. The scorecard reports:

- model mean absolute error versus the actual total;
- prediction-time market-line mean absolute error as a baseline;
- Brier score and log loss for over probability quality;
- directional lean accuracy, excluding pushes; and
- calibration buckets through the API response.

Repeated forecasts are retained rather than overwritten. The scorecard automatically uses only the latest run for each game, model version, and engine, so repeated simulations of one matchup are not treated as independent games.

## Verification

```bash
npm test
npm run smoke
```

`npm test` checks extraction, shrinkage, model determinism, scoring calibration, game length, preseason effects, offense behavior, injury direction, and fair-odds conversion. `npm run smoke` performs a real headless-browser check on macOS with Google Chrome installed, including live profiles, both engines, comparison output, and horizontal-overflow protection.

## Important limitation

This is an exploratory model, not a validated betting system. The current opponent adjustment uses a shallow pregame history rather than a season-wide iterative strength model. EPA is a transparent state-value estimate from the available ESPN fields, not nflfastR's trained EPA measure. Play-outcome rates are empirical-Bayes fits to the available team histories, not yet a league-wide out-of-time machine-learning model. The saved market total is the line at simulation time and may not be the closing line. A stable simulation only reduces Monte Carlo sampling error; it does not remove model error. Evaluate a meaningful set of untouched future games before relying on any apparent edge.
