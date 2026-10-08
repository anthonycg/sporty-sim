# Sporty Sim walk-forward backtest

- League: nfl
- Season: 2026 regular
- Model: 0.4.0
- Simulations: 200,000 per engine per game
- Completed games: 64

## Overall

| Engine | Games | Model MAE | Line MAE | RMSE | Bias | Lean accuracy | Brier | Beat line MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Drive | 64 | 16.03 | 10.69 | 20.46 | 10.39 | 45.3% | 0.357 | 34.4% |
| Play | 64 | 12.07 | 10.69 | 15.06 | -1.37 | 40.6% | 0.306 | 35.9% |

## By week

| Week / engine | Games | Model MAE | Line MAE | RMSE | Bias | Lean accuracy | Brier | Beat line MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Week 1 drive | 16 | 13.51 | 11.69 | 17.60 | -2.83 | 31.3% | 0.302 | 37.5% |
| Week 1 play | 16 | 13.55 | 11.69 | 18.53 | -6.42 | 25.0% | 0.338 | 25.0% |
| Week 2 drive | 16 | 20.31 | 10.69 | 25.22 | 19.31 | 37.5% | 0.448 | 18.8% |
| Week 2 play | 16 | 11.98 | 10.69 | 15.14 | 5.05 | 50.0% | 0.293 | 37.5% |
| Week 3 drive | 16 | 16.32 | 10.81 | 20.96 | 12.49 | 50.0% | 0.402 | 43.8% |
| Week 3 play | 16 | 13.21 | 10.81 | 14.69 | -2.21 | 31.3% | 0.354 | 31.3% |
| Week 4 drive | 16 | 13.97 | 9.56 | 16.99 | 12.58 | 62.5% | 0.274 | 37.5% |
| Week 4 play | 16 | 9.54 | 9.56 | 10.88 | -1.91 | 56.3% | 0.239 | 50.0% |

## By available profile window

| Window / engine | Games | Model MAE | Line MAE | RMSE | Bias | Lean accuracy | Brier | Beat line MAE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| coldStart drive | 16 | 13.51 | 11.69 | 17.60 | -2.83 | 31.3% | 0.302 | 37.5% |
| coldStart play | 16 | 13.55 | 11.69 | 18.53 | -6.42 | 25.0% | 0.338 | 25.0% |
| partial drive | 32 | 18.32 | 10.75 | 23.19 | 15.90 | 43.8% | 0.425 | 31.3% |
| partial play | 32 | 12.59 | 10.75 | 14.92 | 1.42 | 40.6% | 0.324 | 34.4% |
| full drive | 16 | 13.97 | 9.56 | 16.99 | 12.58 | 62.5% | 0.274 | 37.5% |
| full play | 16 | 9.54 | 9.56 | 10.88 | -1.91 | 56.3% | 0.239 | 50.0% |

Cold start means at least one team had no earlier same-season game; partial means both teams had history but at least one had fewer than three games; full means both had the complete three-game window.

Historical runs use archived ESPN totals and neutral weather/player availability. Lower MAE, RMSE, Brier, and log loss are better. Bias is projected total minus actual total.
