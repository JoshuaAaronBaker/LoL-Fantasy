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

Base player-game scores remain immutable inputs. For each fantasy stage, assigned matches are summed per selected player, the captain's aggregate receives the ruleset multiplier, and the roster total is materialized as base score plus captain bonus. Replaying ingestion or recalculation replaces the same materialized rows rather than incrementing them.

Opponent selections and player-level score breakdowns remain hidden until the stage's database lock time. Usernames, ranks, and roster totals are visible to authenticated competitors on the global leaderboard.

First-blood and multikill bonuses remain disabled until a real Cito payload confirms reliable source fields. Add a new immutable ruleset version rather than editing rules used by completed competitions.
