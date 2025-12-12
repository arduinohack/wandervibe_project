import 'package:flutter/foundation.dart'; // For kIsWeb (platform detection)
import 'package:shared_preferences/shared_preferences.dart'; // Add for settings
import 'dart:io'; // For Platform checks (Windows/Mac/Linux detection)

// Load backend URL: localhost for web, stored/emulator for mobile
// Load backend URL: localhost for web/desktop, stored/emulator for mobile
Future<String> get backendBaseUrl async {
  if (kIsWeb) {
    return 'http://localhost:3000'; // Web (browser)
  }
  // Check for desktop platforms (Windows/Mac/Linux)—use localhost
  if (Platform.isWindows || Platform.isMacOS || Platform.isLinux) {
    return 'http://localhost:3000'; // Native desktop app
  }
  // For mobile (Android/iOS): Use stored value or emulator default
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString('backendUrl') ?? 'http://10.0.2.2:3000';
}

// API paths (use with await getBackendUrl() + path)
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
const String apiEvents = '/api/events';
const String apiInvites = '/api/invites';
const String apiInvitesRespond = '/api/invites/{invitationId}/respond';
