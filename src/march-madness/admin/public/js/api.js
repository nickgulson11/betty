// API helper functions

const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('admin_token');
}

async function apiRequest(endpoint, method = 'GET', body = null) {
  const token = getToken();

  if (!token) {
    window.location.href = '/admin/index.html';
    throw new Error('No auth token');
  }

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);

  if (response.status === 401) {
    localStorage.removeItem('admin_token');
    window.location.href = '/admin/index.html';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// API methods
const api = {
  // Pool
  getPool: () => apiRequest('/pool'),
  updatePool: (id, data) => apiRequest(`/pool/${id}`, 'PUT', data),
  advanceRound: (poolId, nextRound) => apiRequest('/pool/advance', 'POST', { poolId, nextRound }),
  clearPool: (id) => apiRequest(`/pool/${id}/clear`, 'POST'),
  allowNextRoundPicks: () => apiRequest('/pool/allow-next-round-picks', 'POST'),
  disableNextRoundPicks: () => apiRequest('/pool/disable-next-round-picks', 'POST'),

  // Participants
  getParticipants: () => apiRequest('/participants'),
  getActiveParticipants: () => apiRequest('/participants/active'),
  getEliminatedParticipants: () => apiRequest('/participants/eliminated'),
  getParticipant: (id) => apiRequest(`/participants/${id}`),
  createParticipant: (data) => apiRequest('/participants', 'POST', data),
  updateParticipant: (id, data) => apiRequest(`/participants/${id}`, 'PUT', data),
  deleteParticipant: (id) => apiRequest(`/participants/${id}`, 'DELETE'),
  markPaid: (id) => apiRequest(`/participants/${id}/paid`, 'POST'),
  eliminateParticipant: (id, reason, round) => apiRequest(`/participants/${id}/eliminate`, 'POST', { reason, round }),
  syncChannelMembers: () => apiRequest('/participants/sync', 'POST'),

  // Picks
  getPicks: () => apiRequest('/picks'),
  getPicksByRound: (round) => apiRequest(`/picks/round/${round}`),
  getPicksByParticipant: (participantId) => apiRequest(`/picks/participant/${participantId}`),
  createPick: (data) => apiRequest('/picks', 'POST', data),
  updatePick: (id, data) => apiRequest(`/picks/${id}`, 'PUT', data),
  deletePick: (id) => apiRequest(`/picks/${id}`, 'DELETE'),
  getPicksSummary: () => apiRequest('/picks/summary/current'),

  // Betty
  sendMessage: (destination, message, target = null) =>
    apiRequest('/betty/message', 'POST', { destination, message, target }),
  getTemplates: () => apiRequest('/betty/templates'),
  bettyifyMessage: (message) => apiRequest('/betty/bettyify', 'POST', { message }),

  // Teams
  getTeams: () => apiRequest('/teams'),
  createTeam: (data) => apiRequest('/teams', 'POST', data),
  bulkImportTeams: (data) => apiRequest('/teams/bulk', 'POST', data),
  syncTeams: () => apiRequest('/teams/sync', 'POST'),
  simulateRoundEnd: () => apiRequest('/teams/simulate-round-end', 'POST'),
  simulateGame: (winner, loser, round) => apiRequest('/teams/simulate-game', 'POST', { winner, loser, round }),
  updateTeam: (id, data) => apiRequest(`/teams/${id}`, 'PUT', data),
  eliminateTeam: (id, round) => apiRequest(`/teams/${id}/eliminate`, 'POST', { round }),
  deleteTeam: (id) => apiRequest(`/teams/${id}`, 'DELETE'),
  clearTeams: () => apiRequest('/teams/all', 'DELETE'),
};
