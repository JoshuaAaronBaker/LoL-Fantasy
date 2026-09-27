# Scoring

`default-v2` scores individual player performance without awarding points for a team win:

| Metric | Points |
| --- | ---: |
| Kill | +3.00 |
| Assist | +1.50 |
| Death | -1.00 |
| CS | +0.01 |

Calculations use `decimal.js` and round half-up to two decimals. The canonical product example is:

```text
8 kills × 3.00       = 24.00
2 deaths × -1.00     = -2.00
11 assists × 1.50    = 16.50
287 CS × 0.01        =  2.87
--------------------------------
base score            = 41.37
captain × 1.5         = 62.06
```

Base player-game scores remain immutable inputs. For each fantasy stage, assigned matches are summed per selected player, the captain's aggregate receives the ruleset multiplier, and the roster total is materialized as base score plus captain bonus. Replaying ingestion or recalculation replaces the same materialized rows rather than incrementing them.

Opponent selections and player-level score breakdowns remain hidden until the stage's database lock time. Usernames, ranks, and roster totals are visible to authenticated competitors on the global leaderboard.

The original `default-v1` ruleset, which included a win bonus, remains stored for historical reproducibility but is inactive. First-blood and multikill bonuses remain disabled until a real Cito payload confirms reliable source fields. Add a new immutable ruleset version rather than editing rules used by completed competitions.
