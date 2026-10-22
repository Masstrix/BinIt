# How lap times are recorded (circuit games)

Assetto Corsa and Assetto Corsa EVO both go through the shared lap tracker
(`crates/tt-games/src/tracker.rs`). Rally stages work differently (see `crates/tt-games/src/stage.rs`):
their time is the stage clock where the game stops it at the finish, so nothing below applies to them.

## What the game gives us

Bin It reads the game's shared memory 20 times a second. Lap timing uses:

| Value | What it is |
|---|---|
| Lap counter | Goes up by one when a lap is completed |
| Last lap time | The game's official time for the last completed lap, exact to the millisecond |
| Lap clock | The running time of the lap in progress |
| Progress | How far round the lap the car is (0 to 1) |
| Valid / pit lane | Track limits and pit lane flags |

The lap counter and the last lap time aren't always updated together: the counter can go up a moment
before the new time is published. Until then, "last lap time" still holds the **previous** lap's time,
which after a driver swap is someone else's.

## The rule

**A lap's time is always the game's own.** Bin It keeps its own measurement of every lap (the highest
lap clock reading it saw, within about a twentieth of a second of the real time), but only to check the
game's answer, never in place of it for a ranked lap.

```mermaid
flowchart TD
    poll([Read the game, 20 times a second]) --> status{Game state?}

    status -- Driving --> clock[Note the lap clock reading.<br/>The highest one is our measurement of this lap]
    status -- Paused --> waiting2{A finished lap waiting<br/>for its time?}
    status -- Replay or menu --> close1[[Close the waiting lap]] --> reset[Forget the lap in progress] --> poll

    clock --> counter{Lap counter<br/>went up?}
    counter -- Yes --> close2[[Close any lap still waiting<br/>from before]] --> wait[The finished lap waits<br/>for the game's time] --> poll
    counter -- No --> waiting1{A finished lap waiting<br/>for its time?}

    waiting1 -- No --> poll
    waiting1 -- Yes --> fits
    waiting2 -- Yes --> fits
    waiting2 -- No --> poll

    fits{Last lap time changed,<br/>and close to our measurement?<br/>between 1 s under and 5 s over}
    fits -- Yes --> exact[/Record the game's exact time/] --> poll
    fits -- No --> keep[Keep waiting.<br/>No time limit] --> poll
```

A waiting lap is only **closed** without the game's answer when that answer can no longer come: the next
lap has ended, or the player has left the session.

```mermaid
flowchart TD
    start([Close a waiting lap]) --> arrived{Leaving the session, and the<br/>game's time arrived and fits?}
    arrived -- Yes --> exact[/Record the game's exact time/]
    arrived -- No --> same{Last lap time never changed,<br/>and our measurement agrees with it?<br/>between 0.1 s under and 0.3 s over}
    same -- Yes --> twin[/Record it: a genuine lap<br/>identical to the one before/]
    same -- No --> notime[/Record as NO TIME with our measurement.<br/>Never ranked, never credited<br/>with someone else's time/]
```

When the lap counter goes up, a newly changed "last lap time" is never given to an older waiting lap:
it may already be the lap that just ended.

## What it used to do (0.6.0 and earlier)

```mermaid
flowchart TD
    counter([Lap counter went up]) --> changed{Last lap time changed?}
    changed -- Yes --> take[/Record it/]
    changed -- No --> tries{Waited 10 readings yet?<br/>about half a second}
    tries -- No --> changed
    tries -- Yes --> stale[/Record whatever it says.<br/>Still the previous lap's time<br/>if the game was slow/]
```

That last step is how two drivers could end up with exactly the same time. Laps stored that way are
found and un-ranked once, when the database is upgraded to format 7 (`repair_carried_over_times` in
`crates/tt-core/src/store.rs`).
