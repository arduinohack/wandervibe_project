// Compile-time API origin. Override with --dart-define=API_BASE=http://host:3000.
const String backendBaseUrl = String.fromEnvironment(
  'API_BASE',
  defaultValue: 'http://localhost:3000',
);

// API paths (append to backendBaseUrl)
const String apiAuthLogin = '/api/auth/login';
const String apiAuthLogout = "/api/auth/logout";
const String apiAuthRefresh = '/api/auth/refresh';
const String apiAuthRegister = '/api/auth/register';
const String apiAuthVerifyToken =
    '/api/auth/verify-token'; // Added for token validation
const String apiAuthForgotPassword = '/api/auth/forgot-password';
const String apiUsersUpdate = '/api/auth/users/{id}';
const String apiUserAiSettings = '/api/users/me/ai-settings';
const String apiPlans = '/api/plans';
const String apiPlanLink = '/api/plans/{planId}/link';
const String apiPlansItinerary = '/api/plans/{planId}/itinerary';
const String apiPlanUsers = '/api/plans/{planId}/users';
const String apiPlanMembers = '/api/plans/{planId}/members';
const String apiPlanReassign = '/api/plans/{planId}/reassign-coordinator';
const String apiPlanPlaceMap = '/api/plans/{planId}/place-map';
const String apiPlanSuggest = '/api/plans/{planId}/suggest';
const String apiPlaceAutocomplete = '/api/places/autocomplete';
const String apiPlanInvite = '/api/plans/{planId}/invite';
const String apiPlanInviteResend = '/api/plans/{planId}/invite/resend';
const String apiActivities = '/api/activities';
const String apiActivitiesAlias = '/api/events';
const String apiInvites = '/api/invites';
const String apiInvitesRespond =
    '/api/invites/invitations/{invitationId}/respond';
