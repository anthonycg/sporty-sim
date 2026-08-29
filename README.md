# Sporty Sim

Sporty Sim is a transparent football totals simulator. It loads upcoming NFL or college-football matchups, builds objective recent-game profiles, samples uncertain player availability, and runs both drive-level and play-level game simulations in the browser.

## Run it

Requires Node.js 20 or newer. There are no package dependencies.

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Tonight's workflow

1. Select the league and date, then choose a game from the live slate.
2. Select **Auto-rate recent games** to process up to three completed games strictly before kickoff. The app applies recency weighting and league-average shrinkage, then fills the team inputs. You can still override any value.
3. Add players whose availability is uncertain. `Chance limited` is included within `chance to play`; the remaining probability is fully active. The points impact is multiplied by expected snap share.
4. Enter the market total and weather severity.
5. Choose drive-level, play-level, or comparison mode. Comparison runs 200k complete games through each engine.
6. Compare the distribution—not only the mean—to the line and inspect whether the models agree.

Every click generates a fresh random seed, displayed with the result for auditing. Reusing a seed in code reproduces the exact simulated sample. With 200k games per engine, independent runs should remain close and can still round to the same displayed tenth of a percentage point.

Inputs are saved in browser storage. Selecting a different game starts with neutral team assumptions to prevent accidental carryover.

## Objective recent-game profiles

The server downloads completed pregame box scores, drives, and play-by-play. The extractor calculates plays, pace, dropbacks, pass rate, net yards per dropback, rushing efficiency, success rate, explosive-play rate, turnovers per drive, red-zone rate, and points per drive. It separately measures what each defense allowed.

Offensive outcomes come directly from their component measurements. Defense is represented by net passing yards allowed per dropback, rushing yards allowed, success allowed, explosives allowed, sack/pressure rate, and takeaways per drive. The offense and defense 0–100 fields are deliberately neutral after auto-rating: they are small residual adjustments for information not captured by the measurable components, not composite scores that duplicate them. The profile header still displays descriptive form scores for context, but those summaries are not fed back into the simulation.

Recent games receive more weight. Every noisy statistic is blended toward a league and season-type baseline according to its relevant sample size. For example, passing efficiency is weighted by dropbacks while turnover rate is weighted by drives. The API returns observed, adjusted, and baseline values plus the sample behind each estimate.

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
- Updates first downs, turnovers, touchdowns, safeties, punts, and field goals after each snap.
- Uses a lower scoring environment for preseason rotation uncertainty and applies player/weather modifiers.
- Uses a compact overtime approximation; a full NFL overtime rules engine is not yet implemented.

The schedule, displayed market context, box scores, drives, and historical plays come from ESPN's public scoreboard feed. Injury probabilities remain user assumptions. Market odds are context, never a team-strength input.

## Verification

```bash
npm test
npm run smoke
```

`npm test` checks extraction, shrinkage, model determinism, scoring calibration, game length, preseason effects, offense behavior, injury direction, and fair-odds conversion. `npm run smoke` performs a real headless-browser check on macOS with Google Chrome installed, including live profiles, both engines, comparison output, and horizontal-overflow protection.

## Important limitation

This is an exploratory model, not a validated betting system. The current team ratings use league shrinkage but do not yet perform a full opponent-strength regression or identify every player on every snap. A stable simulation only reduces Monte Carlo sampling error; it does not remove model error. Predictions should be logged before kickoff and evaluated against outcomes and closing lines over a meaningful sample before any reliance is placed on them.
