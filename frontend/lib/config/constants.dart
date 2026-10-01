import 'package:flutter/foundation.dart'; // For kIsWeb (platform detection)
import 'package:shared_preferences/shared_preferences.dart'; // Add for settings
import 'dart:io'; // For Platform checks (Windows/Mac/Linux detection)

// Stored backendUrl overrides the platform default.
// Desktop, web, and iOS use localhost. The Android emulator uses 10.0.2.2.
Future<String> get backendBaseUrl async {
  final prefs = await SharedPreferences.getInstance();
  final stored = prefs.getString('backendUrl');
  if (stored != null && stored.trim().isNotEmpty) {
    return stored.trim();
  }
  if (!kIsWeb && Platform.isAndroid) {
    return 'http://10.0.2.2:3000';
  }
  return 'http://localhost:3000';
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
const String apiActivities = '/api/activities';
const String apiActivitiesAlias = '/api/events';
const String apiInvites = '/api/invites';
const String apiInvitesRespond =
    '/api/invites/invitations/{invitationId}/respond';
