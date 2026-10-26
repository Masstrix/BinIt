# Driver profiles, points and customisation: starting notes

Not built yet. This is a place to think before building, written while the UI refresh was being done, so
the designs are what it is based on. Everything here is a proposal for the owner to push back on.

## What the designs already assume

The Mist Kit boards (Design Refresh page) show things the app has no data for today:

* A **level** with an XP ring on the phone banner ("760 XP to level 5") and a level badge on the helmet.
* A **Garage**: helmet colour, stripe, race number, stickers. "Personal liveries."
* A **You** page behind the banner: level, XP and stickers, my laps, my bests per track, Garage, "Not you? Switch driver".
* Race numbers (`#7`) next to names on the picker, leaderboards, podium and overlay strip.

None of that is stored. A driver is `id, name, color, created_at` (`crates/tt-core/src/store.rs`).

## The decision that shapes the rest: how does a phone know who you are?

Today: **"Who are you?"** is remembered by the phone's own browser storage (`me`), the app knows nothing
about it, and anyone can pick anyone. That fits the product rule "no sign-in, no PINs, drivers are just
names" (see memory / roadmap). Customisation and points make this more sensitive, because spending
someone's points or changing their helmet from another phone is now a (small) harm.

Options, lightest first:

1. **Keep it as is.** Trust model. Anyone can edit any driver's Garage. Simple, and in an office that may be fine.
2. **Device pairing, no passwords.** The first time a phone picks "I'm Sam", the server issues a random device
   token and stores `driver_id <-> device token`. From then on that phone is Sam without asking, and only a
   paired device can spend Sam's points or change Sam's Garage. Picking someone else's name still works for
   *seat* and *viewing*, just not for changes. Losing the phone just means re-pairing from the PC.
3. **Optional PIN per driver** guarding only spending and Garage edits, not driving. Cheap to add on top of 2.
4. A real login (email, password, accounts). Conflicts with "local only, no auth" and I would not start here.

Recommendation: **2**, with the desktop app acting as the admin that can re-pair or reset anyone. It keeps
the "type a name and go" feel, while giving a phone a stable identity that "my profile" can hang on.

## Points: two separate things

Keep **XP** and **coins** apart so spending never drops your level.

* **XP**: only goes up. Level is derived from total XP. Drives the ring and badge.
* **Coins**: earned alongside XP, spent in the Garage.

Store them as an **append-only ledger** (`point_events`: driver, kind, xp, coins, reference such as lap id or
challenge id, time). Balances are sums, so nothing can drift, a deleted lap can be reversed, and the UI can
show "why did I get that".

Possible earning rules (all numbers placeholders):

| Event | XP | Coins |
|---|---|---|
| Valid timed lap | 10 | 1 |
| Personal best on a combo | 50 | 5 |
| Track record | 150 | 20 |
| Challenge: finishing 1st / 2nd / 3rd | 300 / 200 / 100 | 40 / 25 / 10 |
| First lap on a new track or car | 25 | 2 |

Guard rails: only **valid** laps (the lap timing already separates cut, out and in laps, see
`docs/lap-timing.md`), a per-day cap per track and car so the rig cannot be farmed by lapping a corner,
and guest laps earn nothing until claimed. Points are awarded when a lap is recorded (the `lapRecorded`
path), never by the client.

## Customisation

* A static **catalogue in code**: helmet colours, stripes, visors, race number styles, stickers. Each has an
  id, a name, a price in coins and optionally a level requirement.
* `driver_items` (what a driver owns) and a **loadout** (what is equipped: colour, stripe, number, sticker).
* The loadout is what the existing `Helmet` component, the podium, the overlay strip and the leaderboard
  render. Today `Helmet` takes only a `color`; it would take a loadout.
* Free starter set so nobody is locked out; the driver's current `color` becomes the starting helmet colour.
* Race number: unique per driver is nicer (no two #7s) but needs a rule for clashes.
* The server checks ownership and price when equipping or buying. The phone only asks.

## Money

The message said "money". I have assumed that means an **in-app currency** (coins), not real payments. Real
money would need accounts, payment handling and a very different product, and "local only, office fun" is
the stated direction. Worth confirming.

## Where it would show up in the UI

* **Banner (phone):** ring plus level badge, "760 XP to level 5" (already designed).
* **You page** (from the banner): level, coins, recent earnings, my laps, bests per track, Garage, switch driver.
* **Desktop:** the seat card and Drivers page; a profile view per driver (the existing Driver progress page is
  the closest starting point).
* **Pop-ups in the overlay:** "+50 XP", "Level up", reusing the pop-up widget.

## Suggested order

1. Decide identity (option 2 above is the proposal) and whether coins are in-app only.
2. Add the ledger and levels (XP only, no spending), show the ring and badge. Valuable on its own.
3. Add the Garage: catalogue, ownership, loadout, rendering in `Helmet`, the shared podium and the overlay.
4. Add coins and buying.
5. Device pairing and the You page, if option 2 is chosen.

## Status: device pairing is built (2026-10-26)

Option 2 above is in. How it works:

* A phone picks a driver in the banner's "Who are you?". The first phone to pick a driver **claims** them: the
  server makes a random token, keeps only its SHA-256 hash (`devices` table, schema 8) and sends the token to
  the phone, which keeps it in its own storage and sends it as `X-Device-Token`. `GET /api/me` says who a phone is.
* A driver who already has a phone needs a **one-time 6 digit code** (valid 5 minutes) to pair another phone.
  The code comes from the PC (Drivers, then Phones, then Pair a phone) or from a phone already paired to that driver
  (banner, then Pair another phone). Codes live in memory only.
* **Log out** (banner, then Log out) deletes that phone's token on the server and in the browser. The PC can also
  sign a single phone, or every phone, out of a driver (lost phone); the next phone to ask then claims them again.
* A driver with a paired phone can only be edited from the PC (the desktop app, i.e. loopback) or from that phone.
  An unclaimed driver stays editable by anyone, so nothing changes for people who never pair. Seat switching is still open.
* A phone that remembered a driver the old way (`me` in local storage) is paired quietly the first time if that
  driver is still unclaimed.

Not done: nothing is *spent* yet, so the only guarded action is editing a driver. Points, coins and the Garage
(below) would use the same "is this phone that driver" check. Tokens go over plain HTTP on the office network,
like everything else here; that is acceptable for this product but worth knowing.

## Status: XP, coins and the You page are built (2026-10-26)

* **Ledger.** Every reward is a row in `point_events` (schema 9): kind, XP, coins, the lap that earned it. Balances are
  sums. Rules live in `crates/tt-core/src/progress.rs`: a clean lap 10 XP + 1 coin, the first clean lap on a track and
  car 25 + 2, a personal best 50 + 5, a track record that beats someone else 150 + 20. Plain laps stop paying after
  30 per track and car in 24 hours. Guest laps, cut laps and out/in laps earn nothing. Awards are made server side when
  the lap is recorded and come back on the `lapRecorded` event (`awards`), so the overlay pop-up adds "+N XP" and
  "level N!".
* **Levels.** Level n needs 100 * (n-1) * n / 2 XP in total (100, 300, 600, 1000, 1500, ...). Titles: Rookie,
  Qualifier, Regular, Podium Regular, Contender, Veteran, Ace, Legend.
* **Back-fill.** Laps recorded before this existed were paid once, with the same rules minus the daily cap and track
  records (a flag in `settings`, `points_backfilled_v1`). This answers the "start at zero?" question with "no".
* **You page** (`#/you`, opened by tapping the phone banner): level and XP bar, coins, clean laps / clean % / tracks,
  your best on each track and car with its rank, stickers, recent XP, and "Not you?". The banner shows a level badge
  and "N XP to level N+1". Stickers are worked out from your laps each time, not stored.
* **Not done:** coins can be earned but there is nothing to spend them on yet (the Garage); challenge placings do not
  pay out; the You page has no desktop entry (the desktop already has the driver progress page).

## Questions for the owner

* Trust model or device pairing? Is a PIN wanted?
* Coins in-app only? Should anything reset (weekly or seasonal)?
* Should challenge winners get something special (a trophy sticker) rather than only coins?
* Should coins and XP be visible to everyone on the leaderboard, or only on your own profile?
* Is it fine that XP and coins from before this feature starts at zero, or should existing laps be back-filled?

## Status: the Garage and shop are built (2026-10-26)

* **Server.** Schema 10 adds `drivers.look` (JSON, the equipped `Look`) and `driver_items` (what was bought). The
  catalogue with prices and level gates is `crates/tt-core/src/shop.rs`; the app only knows how to draw each id
  (`app/src/looks.ts`), so the two id lists must match. A purchase is one `driver_items` row plus a negative
  `point_events` row (`buy:shell:aurora`) in one transaction, so a balance is still just a sum and XP is untouched.
  `Look` rides on every `Driver`, so leaderboards, podium, overlay and the picker all draw it.
* **Routes.** `GET /drivers/{id}/shop`, `POST /drivers/{id}/shop/buy {slot, id}`, `PUT /drivers/{id}/look`. Buying and
  equipping use the same guard as editing a driver (PC, or the phone paired to them).
* **Rules.** Free items (price 0) belong to everyone; others need the level and the coins, and cannot be bought
  twice. A look may only wear owned or free items; race numbers are 1 to 99 and free.
* **UI.** `#/garage` (try on anything, "Buy and equip" pays for what is new), `#/shop` (grid with a confirm sheet, "Try
  on" hands the item to the Garage), links on the You page. The mock server (`?mock`) sells the same catalogue and
  gives each mock driver spare coins.
* **Not done:** visor and default face (designed, not in the catalogue), earned-only items (challenge winners, level
  milestones), the Paddock page, overlay pop-up when someone equips something, number style and colour extras.

## Status: one file sets XP, coins and prices (2026-10-26)

Every earning rate and shop price is in **`crates/tt-core/rewards.json`**. It is compiled into the app, so a balance
change is: edit the numbers, rebuild, ship. Everyone who installs the update gets the new values; there is no copy in
the user's data folder to go stale.

* `cleanLap`, `firstLap`, `personalBest`, `trackRecord`: XP and coins each pays.
* `dailyLapCap`: plain laps on one track and car stop paying after this many in 24 hours (bests and records are never capped).
* `levelXpStep`: each level costs this much more than the one before (100 gives 100, 300, 600, 1000 XP in total).
* `shop`: every item for sale, in order: `slot` (`shell`, `decal`, `stripe`, `face`), `id` (must match the drawing in
  `app/src/looks.ts`), `price` and `minLevel`. A price of 0 makes an item free for everyone. An item is added to the
  shop by adding it here and drawing it in `looks.ts` (and in `app/src/mock/data.ts` for `?mock`).
* A negative number is raised to zero and a broken file stops the build's tests, not the app.
* Changing a number does not rewrite the past: ledger rows already written keep what they paid, items already bought keep
  the price paid (no refunds), and a smaller `levelXpStep` raises everyone's level at once while a larger one lowers it
  (a driver can then own items above their level; they keep them).
* The mock server (`?mock`) has its own copy of the prices in `app/src/mock/data.ts`; keep it in step when testing the UI.

## Status: challenges pay out (2026-10-26)

When a challenge ends (its end time passes, or it is ended by hand) the server pays its board once, from the `challenge`
block of `crates/tt-core/rewards.json`:

* `placings`: XP and coins for 1st, 2nd, 3rd... in order. `participation`: everyone else with a counted lap.
* **Reward size:** whoever starts a challenge picks Low, Medium or High (on the new challenge page, stored on the
  challenge, schema 11). `sizes` in the config are the multipliers: 0.5, 1 and 2 by default. It multiplies every
  payout, after the field scaling below.
* `minEntrants`: a challenge with fewer drivers than this pays nothing (nobody farms one alone). Guest laps never count.
* **Scaling with the field:** every driver beyond `minEntrants` adds `scalePerEntrant` (0.1 is 10%) to every payout,
  up to `maxScale` times the base. So with the defaults a six-driver challenge pays 1.4 times the base amounts.
* Rows go in the ledger as `challenge:<place>:<name>` or `challenge:entry:<name>`, and show on the You page as "Won ...",
  "2nd in ...", "Took part in ...". A settled flag per challenge (`challenge_settled_<id>`) stops a second payment, and
  deleting a challenge later does not take the coins back.
* `BinIt::settle_challenges` runs at start and every 30 seconds, and straight after a challenge is ended by hand. The very
  first run marks challenges that had already ended as settled without paying, so old contests do not suddenly hand out coins.
* Not built: a bigger or smaller reward for one particular challenge (a per-challenge multiplier), and an overlay
  celebration when a payout lands.
