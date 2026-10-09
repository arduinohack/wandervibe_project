// Compile-time API origin. Override with --dart-define=API_BASE=http://host:3000.
const String backendBaseUrl = String.fromEnvironment(
  'API_BASE',
  defaultValue: 'http://localhost:3000',
);

// API paths (append to backendBaseUrl)
const String apiAuthLogin = '/api/auth/login';
const String apiAuthLogout = "/api/auth/logout";
const String apiAuthRegister = '/api/auth/register';
const String apiAuthVerifyToken =
    '/api/auth/verify-token'; // Added for token validation
const String apiAuthForgotPassword = '/api/auth/forgot-password';
const String apiUsersUpdate = '/api/auth/users/{id}';
const String apiPlans = '/api/plans';
const String apiPlansItinerary = '/api/plans/{planId}/itinerary';
const String apiPlanUsers = '/api/plans/{planId}/users';
const String apiPlanMembers = '/api/plans/{planId}/members';
const String apiPlanInvite = '/api/plans/{planId}/invite';
const String apiActivities = '/api/activities';
const String apiActivitiesAlias = '/api/events';
const String apiInvites = '/api/invites';
const String apiInvitesRespond =
    '/api/invites/invitations/{invitationId}/respond';
