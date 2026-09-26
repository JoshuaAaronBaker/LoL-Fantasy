# Scoring

`default-v1` contains only fields confirmed useful for the completed-game proof:

| Metric | Points |
| --- | ---: |
| Kill | +3.00 |
| Assist | +1.50 |
| Death | -1.00 |
| CS | +0.01 |
| Win | +2.00 |

Calculations use `decimal.js` and round half-up to two decimals. The canonical product example is:

```text
8 kills × 3.00       = 24.00
2 deaths × -1.00     = -2.00
11 assists × 1.50    = 16.50
287 CS × 0.01        =  2.87
win                   =  2.00
--------------------------------
base score            = 43.37
captain × 1.5         = 65.06
```

Base player-game scores are materialized. Captain points belong to a future roster aggregation because captain status is a user's roster choice, not a property of the professional player's game.

First-blood and multikill bonuses remain disabled until a real Cito payload confirms reliable source fields. Add a new immutable ruleset version rather than editing rules used by completed competitions.
