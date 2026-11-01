# Smart Fair Rotation — implementation contract

Baseline before changes: existing TypeScript-backed regression suite passed; all nine Chrome workflows passed (25.5 seconds). The app uses `src/state/appStore.ts` and the single `pickleball_queue_data` key. Existing Astro layouts, routes, navigation, KAMPO assets, scoring engine and deployment configuration are retained.

Queue selection/partner assignment, pending validation, attendance transitions and completion participation counters are the affected business rules. Scoring transitions, manual-result validation, serving rotation, rankings and finalization remain in their existing modules.

The previous queue selected four players before pairing them, used random ties, rejected all immediate teammate repeats, and silently replaced invalid previews. The requested behavior supersedes those rotation-specific rules: candidate teams compete together; fixed partners are atomic; non-fixed teammate repeats are discouraged rather than absolutely forbidden; and saved lineups are preserved until explicit regeneration.

## Organizer workflow

Start a session, open **Manage Check-In**, then check players in individually or confirm **Check In All**. New sessions start with everyone **Not Arrived**, regardless of registration activation or their attendance in a previous session. Check-in, Take Break, Return to Queue, Check Out and Check In Again act only on this session. Attendance badges remain separate from the existing permanent activation toggle.

The same **Attendance & Partners** card appears in Queue and Players through the existing component relocation/navigation mechanism. Its manager provides attendance actions, confirmed bulk reset and fixed-pair management. Current-game participants cannot change attendance, and attendance reset is blocked while a game is active. Bulk check-in preserves the active match. No attendance operation deletes player records or game history.

Create a fixed pair from two checked-in, active, available players. A player already assigned to a pair is excluded from the dropdowns; selecting the same person twice is prevented and validated again by the mutation function. Players currently on court may be assigned a future fixed partner without changing their present match. Remove Pair deactivates the relationship, retaining its record; attendance and game statistics remain intact.

## Selection algorithm

`src/lib/queue/rotation.ts` replaces the old selection bodies; the exported application function names delegate to this single implementation. It has no DOM or storage dependencies and takes an explicit clock for deterministic simulations.

1. Eligibility requires active registration, availability and session status Checked In. An active fixed partnership makes both members unavailable for new selection whenever either member is unavailable. Current-game players are excluded from an ordinary upcoming selection.
2. Sort atomic units (one unpaired player or one complete fixed pair) by fairness priority. Use at most 16 candidate players, preserving complete fixed units.
3. Generate teams from complete fixed pairs and every two-player combination of unpaired players. Evaluate all non-overlapping team matchups in that bounded pool. Fixed/fixed, fixed/unpaired and unpaired/unpaired matches receive the same evaluation.
4. Fairness uses eligible games missed, consecutive eligible sit-outs, eligible waiting minutes, consecutive games and participation rate during eligible opportunities. A newly checked-in player has no missed-game debt and a neutral initial participation rate; lifetime zero games do not put them at the front.
5. Maximize selection of substantially overdue players before optimizing variety. Among matchups within a bounded fairness tolerance, minimize order-independent four-player-group repetition, recent non-fixed teammate repetition, partner frequency and opponent frequency. Increasing missed-game debt eventually overrides variety.
6. Resolve remaining ties using a stable session/game-history hash and player IDs. Selection never shuffles the full queue randomly.

Group keys sort all four IDs, so team order and player order do not bypass repetition detection. The same group is allowed with only four available players, while teammate arrangements rotate where possible. Fixed partners are excluded from teammate-repetition penalties; their opponents remain unrestricted. The previous Winner Priority option is retained as a small preference within this same fairness calculation, not a second queue or fixed-partner mode.

## Attendance clocks and participation

`src/lib/queue/participation.ts` owns pure eligibility/attendance/pair transitions, pending validation and participation bookkeeping. These functions operate on the active session in the existing AppData record. `src/state/appStore.ts` remains the only persistence authority.

Eligible waiting clocks run only while a player is available with their partner, free from the current game and not reserved by the prepared lineup. Breaks, checkout and an absent partner pause both affected clocks. Returning resumes previously earned eligible waiting credit without adding unavailable time. Creating a partnership starts a new shared eligibility period; it does not transfer artificial waiting credit from the earlier arrival of one member.

When a match starts, it captures eligibility epochs. On completion, participants receive the existing game statistics through the unchanged scoring/completion path plus the new participation counters. Only continuously eligible, unreserved nonparticipants receive missed-opportunity credit. Someone checking in after a match started cannot claim that match as a missed opportunity. Cancelled games and pending previews do not add games, wins, points or completed rotation-history records.

Preview calculations may project completion on a cloned AppData when there are not two waiting teams, preserving the existing four-player upcoming preview. This can include current participants for the **following** game; Start Next Game remains blocked until the present match finishes or is cancelled. No second active match is created and the projection never changes real statistics.

## Prepared lineup protection

Prepared assignments remain stored until explicit regeneration, even before **Confirm Lineup** marks them announced. Late arrivals and pairing edits never silently substitute players. If attendance, availability or a new fixed pair makes the assignment invalid, its names and game ID remain visible, a reason is displayed, and Start Next Game is disabled. Returning a missing player or removing a conflicting pair can restore validity without changing the lineup. Regenerate Next Lineup requires confirmation.

Start Next Game revalidates all IDs, distinct players, registration availability, attendance and fixed-team membership before promotion. It never advances automatically. Current and completed matches are unaffected by later partnership edits.

## Backward-compatible storage

The storage key, player IDs, session IDs and game IDs remain unchanged. Schema version **3** adds `participationVersion`, `attendance`, `attendanceNeedsReview`, `fixedPairs`, `rotationHistory` and `pendingInvalidReason` to active sessions. Attendance stores status transition history, actual check-in/re-entry timestamps, clock state, eligibility epochs and fairness counters. Games may add `lineupLocked` and `rotationEligibility`. Ordinary JSON export/import already preserves these fields.

For an older active session, migration preserves active/available players’ prior eligibility and current participants’ attendance, keeps current/pending games and reconstructs group/partner/opponent variety from completed history. The UI requests an attendance review because registration activation does not prove physical presence. Starting a subsequent game requires confirming attendance unless it has already been reviewed or explicitly changed in bulk. Eligible waiting tracking begins at the upgrade; it does not invent past attendance or missed opportunities. Historical sessions are not retrofitted with invented attendance. New sessions use fresh attendance and no fixed pairs.

## Files changed for this feature

- Added `src/lib/queue/rotation.ts` and `participation.ts` for the one selection engine and session participation transitions.
- Extended `src/lib/application.ts` and `src/types/index.ts` for migration, existing completion hooks, pending validation and organizer controls.
- Added `src/components/dashboard/Participation.astro` and `src/styles/participation.css`; included them in the existing QueueDashboard/DashboardLayout.
- Updated the existing session-mode descriptions and confirmation labels for the new attendance/pair actions.
- Added `tests/rotation.cjs` and `tests/browser/attendance.spec.ts`; extended the existing test adapter and browser setup to check players in after a new session.
- Updated only rotation-specific legacy assertions where this request intentionally replaces strict teammate prohibition or automatic pending replacement. The scoring, result, rankings, backup and persistence assertions remain in the suite.

No framework migration, competing store, scoring-engine change, route replacement, dependency addition, Astro/base-path change, deployment-workflow change or PWA-configuration change is part of this feature.

## Verification and limits

The 12-player, 30-game simulations produce **30 different groups** both with direct generation and through stored upcoming previews. Players receive **9–11 games**. The preview-flow run uses 58 teammate combinations, 64 opponent combinations and a longest eligible consecutive sit-out of two games. Four-player simulation rotates all three doubles arrangements. Mixed fixed/unpaired simulation preserves partnerships and reasonably balanced appearances. All three match types are also tested directly.

Tests cover late arrival after six games, locked pending preservation, late fixed partners, breaks, checkout/return, changing/removing pairs mid-session, incompatible sets of four check-ins, duplicate/reversed/self pairing, live-game attendance guards, persistence, idempotent migration and fresh-session reset. The 40-player, 30-game simulation completes in about **0.4 seconds** locally with 2–4 games per player.

The algorithm is a bounded heuristic, not a global optimizer. Equal game totals cannot be guaranteed when attendance, fixed-partner availability or confirmed assignments restrict who can play. A saved invalid lineup intentionally waits for the organizer to resolve or regenerate it. Data remains local to the browser/device. Physical-device orientation/install behavior has the same limitations as before this feature.

Final verification: `npm run check` reports 0 errors, warnings or hints across 41 source files. `npm test` passes the migrated regression, store, migration and smart-rotation simulations. `npm run build` succeeds with the same six static pages. The complete Chrome suite passes **14/14 workflows** (35.6 seconds), covering all nine existing workflows plus attendance, fixed-pair conflicts, late/mid-game changes, legacy attendance review, responsive manager controls and offline persistence. No commit, push or deployment was performed.
