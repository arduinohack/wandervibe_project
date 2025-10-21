import 'package:shared_preferences/shared_preferences.dart'; // Add for settings

// Load backend URL from local storage (default to emulator IP)
Future<String> get backendBaseUrl async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString('backendUrl') ??
      'http://10.0.2.2:3000'; // Default emulator IP
}

// API paths (use with await getBackendUrl() + path)
const String apiAuthLogin = '/api/auth/login';
const String apiAuthLogout = "/api/auth/logout";
const String apiAuthRegister = '/api/auth/register';
const String apiAuthVerifyToken =
    '/api/auth/verify-token'; // Added for token validation
const String apiAuthForgotPassword = '/api/auth/forgot-password';
const String apiUsersUpdate = '/api/auth/users/{id}';
const String apiTrips = '/api/trips';
const String apiTripsItinerary = '/api/trips/{tripId}/itinerary';
const String apiEvents = '/api/events';
const String apiInvites = '/api/invites';
const String apiInvitesRespond = '/api/invites/{invitationId}/respond';
