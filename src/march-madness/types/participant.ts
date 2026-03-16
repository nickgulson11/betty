export type ParticipantStatus = 'pending' | 'active' | 'eliminated' | 'withdrawn';

export interface Participant {
  id: string;
  pool_id: string;
  slack_user_id: string;
  slack_username: string | null;
  status: ParticipantStatus;
  eliminated_round: string | null;
  eliminated_team: string | null;
  paid: boolean;
  paid_at: Date | null;
  seed_sum: number;
  joined_at: Date;
  eliminated_at: Date | null;
}

export interface CreateParticipantInput {
  pool_id: string;
  slack_user_id: string;
  slack_username?: string;
}

export interface UpdateParticipantInput {
  slack_username?: string;
  status?: ParticipantStatus;
  eliminated_round?: string;
  eliminated_team?: string;
  paid?: boolean;
  seed_sum?: number;
}
