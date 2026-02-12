import random
from collections import defaultdict

ROUND_NAMES = [
    "Round of 64",
    "Round of 32",
    "Sweet 16",
    "Elite 8",
    "Final 4",
    "Championship",
]

SEED_MATCHUPS = [
    (1, 16),
    (8, 9),
    (5, 12),
    (4, 13),
    (6, 11),
    (3, 14),
    (7, 10),
    (2, 15),
]


class Participant:
    def __init__(self, pid):
        self.id = pid
        self.used_teams = set()
        self.alive = True
        self.eliminated_round = None


def ask_int(prompt, min_value=None, max_value=None, default=None):
    while True:
        raw = input(prompt).strip()
        if raw == "" and default is not None:
            return default
        try:
            val = int(raw)
        except ValueError:
            print("Please enter a valid integer.")
            continue

        if min_value is not None and val < min_value:
            print(f"Please enter a value >= {min_value}.")
            continue
        if max_value is not None and val > max_value:
            print(f"Please enter a value <= {max_value}.")
            continue
        return val


def team_id(region, seed):
    return f"R{region}-S{seed:02d}"


def win_prob(seed_a, seed_b):
    return seed_b / (seed_a + seed_b)


def pick_winner(team_a, team_b, seeds, rng):
    p_a = win_prob(seeds[team_a], seeds[team_b])
    return team_a if rng.random() < p_a else team_b


def build_round1_matchups():
    matchups_by_region = {}
    for region in range(1, 5):
        matchups = []
        for a, b in SEED_MATCHUPS:
            matchups.append((team_id(region, a), team_id(region, b)))
        matchups_by_region[region] = matchups
    return matchups_by_region


def simulate_round(matchups_by_region, participants, seeds, rng, round_index):
    matchups_all = []
    for region_matchups in matchups_by_region.values():
        matchups_all.extend(region_matchups)

    teams_in_round = []
    team_win_probs = {}
    for a, b in matchups_all:
        p_a = win_prob(seeds[a], seeds[b])
        team_win_probs[a] = p_a
        team_win_probs[b] = 1.0 - p_a
        teams_in_round.extend([a, b])

    picks = {}
    for p in participants:
        if not p.alive:
            continue

        available = [t for t in teams_in_round if t not in p.used_teams]
        if not available:
            p.alive = False
            p.eliminated_round = round_index
            continue

        weights = [team_win_probs[t] for t in available]
        picks[p.id] = rng.choices(available, weights=weights, k=1)[0]

    winners_by_region = {}
    winners_all = set()
    for region, matchups in matchups_by_region.items():
        winners = []
        for a, b in matchups:
            winner = pick_winner(a, b, seeds, rng)
            winners.append(winner)
            winners_all.add(winner)
        winners_by_region[region] = winners

    for p in participants:
        if not p.alive or p.id not in picks:
            continue
        pick = picks[p.id]
        p.used_teams.add(pick)
        if pick not in winners_all:
            p.alive = False
            p.eliminated_round = round_index

    next_matchups_by_region = {}
    for region, winners in winners_by_region.items():
        if len(winners) <= 1:
            next_matchups_by_region[region] = []
            continue
        next_matchups_by_region[region] = [
            (winners[i], winners[i + 1]) for i in range(0, len(winners), 2)
        ]

    return next_matchups_by_region, winners_by_region


def run_simulation(participant_count, rng):
    seeds = {}
    for region in range(1, 5):
        for seed in range(1, 17):
            seeds[team_id(region, seed)] = seed

    participants = [Participant(pid + 1) for pid in range(participant_count)]
    survivors_by_round = []

    matchups_by_region = build_round1_matchups()

    for round_index in range(1, 5):
        matchups_by_region, winners_by_region = simulate_round(
            matchups_by_region, participants, seeds, rng, round_index
        )
        survivors = [p.id for p in participants if p.alive]
        survivors_by_round.append((ROUND_NAMES[round_index - 1], survivors))

    region_champs = []
    for region in range(1, 5):
        region_champs.append(winners_by_region[region][0])

    matchups_by_region = {
        1: [(region_champs[0], region_champs[1])],
        2: [(region_champs[2], region_champs[3])],
    }

    matchups_by_region, winners_by_region = simulate_round(
        matchups_by_region, participants, seeds, rng, 5
    )
    survivors_by_round.append((ROUND_NAMES[4], [p.id for p in participants if p.alive]))

    final_matchup = [(winners_by_region[1][0], winners_by_region[2][0])]
    matchups_by_region = {1: final_matchup}

    simulate_round(matchups_by_region, participants, seeds, rng, 6)
    survivors_by_round.append((ROUND_NAMES[5], [p.id for p in participants if p.alive]))

    return participants, survivors_by_round


def format_team_list(team_ids):
    if len(team_ids) == 1:
        return f"Team {team_ids[0]}"
    return "Team " + " and ".join(str(tid) for tid in team_ids)


def format_outcome(participants):
    round_to_ids = {}
    max_survived = 0

    for p in participants:
        survived_round = 6 if p.eliminated_round is None else p.eliminated_round - 1
        round_to_ids.setdefault(survived_round, []).append(p.id)
        if survived_round > max_survived:
            max_survived = survived_round

    top_ids = sorted(round_to_ids.get(max_survived, []))
    if max_survived == 0:
        return "No teams win a round (all eliminated in Round of 64)"

    round_name = ROUND_NAMES[max_survived - 1]
    team_list = format_team_list(top_ids)
    verb = "wins" if len(top_ids) == 1 else "win"

    if len(top_ids) == 2:
        return f"{team_list} both {verb} after the {round_name}"
    return f"{team_list} {verb} after the {round_name}"


def main():
    participant_count = ask_int(
        "Participant count (20-100 suggested): ", min_value=1
    )
    sim_count = ask_int("Number of simulations [default 10000]: ", min_value=1, default=10000)
    seed_value = ask_int("Random seed [default 42]: ", default=42)

    rng = random.Random(seed_value)

    eliminated_counts = defaultdict(int)
    survive_all = 0

    for i in range(sim_count):
        participants, _ = run_simulation(participant_count, rng)
        outcome = format_outcome(participants)
        print(f"Simulation {i + 1}: {outcome}")
        for p in participants:
            if p.eliminated_round is None:
                survive_all += 1
            else:
                eliminated_counts[p.eliminated_round] += 1

    total_participants = participant_count * sim_count
    survive_rate = survive_all / total_participants

    print("\n--- Aggregate Results ---")
    print(f"Participants per sim: {participant_count}")
    print(f"Simulations: {sim_count}")
    print(f"Survive all 6 rounds: {survive_all} ({survive_rate:.2%})")

    for r in range(1, 7):
        count = eliminated_counts.get(r, 0)
        label = ROUND_NAMES[r - 1]
        print(f"Eliminated in {label}: {count}")


if __name__ == "__main__":
    main()