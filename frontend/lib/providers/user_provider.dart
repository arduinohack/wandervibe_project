import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart'; // For JWT storage
import '../utils/logger.dart';
import '../config/constants.dart'; // Add this line for backendBaseUrl
import '../models/user.dart'; // Your User model with Address/Preferences
import '../config/config.dart';

class UserProvider extends ChangeNotifier {
  String? currentUserId; // Current user ID
  UserRole? _currentUserRole; // Private stub role
  User? _currentUser; // Private full user object
  String? _jwtToken; // Stored token
  final FlutterSecureStorage _storage =
      const FlutterSecureStorage(); // Secure storage

  UserRole? get currentUserRole => _currentUserRole;
  User? get currentUser => _currentUser;
  String? get token => _jwtToken;

  // Login with real backend (POST /api/auth/login)
  Future<void> login(String email, String password) async {
    try {
      final timeoutDuration = Duration(seconds: await AppConfig.timeoutSeconds);

      logger.i('Flutter sending login: email=$email, password=$password');
      logger.i(
        'Flutter sending login: email=$email, password=$password',
      ); // Log input
      final response = await http
          .post(
            Uri.parse((await backendBaseUrl) + apiAuthLogin),
            headers: {'Content-Type': 'application/json'},
            body: json.encode({'email': email, 'password': password}),
          )
          .timeout(timeoutDuration);

      logger.i('Flutter received status: ${response.statusCode}');
      logger.i(
        'Flutter received body: ${response.body}',
      ); // Log response (JSON or error)
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        _jwtToken = data['token']; // From backend response
        await _storage.write(
          key: 'jwt_token',
          value: _jwtToken,
        ); // Store securely
        currentUserId = data['user']['_id']; // From response
        _currentUserRole =
            UserRole.vibeCoordinator; // Stub; later from data['user']['role']
        _currentUser = User.fromJson(data['user']); // Parse full user
        notifyListeners();
        logger.i(
          'Logged in as $email with token: ${_jwtToken!.substring(0, 20)}...',
        );
      } else {
        final data = json.decode(response.body);
        final errorMessage =
            data['message'] ??
            'Login failed: ${response.statusCode}'; // Extract message from backend
        throw Exception(
          errorMessage,
        ); // Throw with backend message for UI to show
      }
    } catch (e) {
      logger.e('Login error: $e');
      rethrow; // Pass error to UI for SnackBar
    }
  }

  // Signup new user (real API POST /api/auth/register)
  Future<void> signup(
    String firstName,
    String lastName,
    String email,
    String password,
    String phoneNumber,
    Map<String, String> address,
    Map<String, bool> notificationPreferences,
  ) async {
    try {
      final timeoutDuration = Duration(seconds: await AppConfig.timeoutSeconds);
      final response = await http
          .post(
            Uri.parse((await backendBaseUrl) + apiAuthRegister),
            headers: {'Content-Type': 'application/json'},
            body: json.encode({
              'firstName': firstName,
              'lastName': lastName,
              'email': email,
              'password': password,
              'phoneNumber': phoneNumber,
              'address': address,
              'notificationPreferences': notificationPreferences,
            }),
          )
          .timeout(timeoutDuration);
      ;

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        logger.i('Signup successful: ${data['message']}');
        // Navigate to login (handled in screen)
      } else {
        throw Exception(
          'Signup failed: ${response.statusCode} - ${response.body}',
        );
      }
    } catch (e) {
      logger.e('Signup error: $e');
      rethrow; // Pass to UI for SnackBar
    }
  }

  // Logout (clear token locally and call backend)
  Future<void> logout() async {
    try {
      final timeoutDuration = Duration(seconds: await AppConfig.timeoutSeconds);
      final token = _jwtToken;
      if (token != null) {
        // Call backend logout (optional, for blacklisting)
        final response = await http
            .post(
              Uri.parse((await backendBaseUrl) + apiAuthLogout),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $token',
              },
            )
            .timeout(timeoutDuration);
        ;
        if (response.statusCode != 200) {
          logger.i(
            'Backend logout failed: ${response.statusCode}',
          ); // Non-fatal—local clear anyway
        }
      }
    } catch (e) {
      logger.e('Logout API error: $e'); // Non-fatal
    }

    // Always clear local storage
    await _storage.delete(key: 'jwt_token');
    _jwtToken = null;
    currentUserId = null;
    _currentUserRole = null;
    _currentUser = null;
    notifyListeners();
    logger.i('Logged out—cleared local storage');
  }

  // Load stored token and verify user (real API POST /api/auth/verify-token)
  Future<void> loadStoredToken() async {
    try {
      final timeoutDuration = Duration(seconds: await AppConfig.timeoutSeconds);
      _jwtToken = await _storage.read(key: 'jwt_token');
      if (_jwtToken != null) {
        // Verify token with backend
        final response = await http
            .post(
              Uri.parse((await backendBaseUrl) + apiAuthVerifyToken),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $_jwtToken',
              },
            )
            .timeout(timeoutDuration);
        ;

        if (response.statusCode == 200) {
          final data = json.decode(response.body);
          currentUserId = data['user']['_id'];
          _currentUserRole = _roleFromString(
            data['user']['role'],
          ); // Parse real role from backend
          _currentUser = User.fromJson(
            data['user'],
          ); // Parse real user from backend
          notifyListeners();
          logger.i(
            'Loaded and verified user from backend: ${data['user']['firstName']} (${_currentUserRole})',
          );
        } else {
          logger.i('Token invalid—clearing');
          await logout(); // Clear invalid token
        }
      } else {
        logger.i('No stored token—user not logged in');
      }
    } catch (e) {
      logger.e('Error loading stored token: $e');
      await logout(); // Clear on error
    }
  }

  // Helper: Convert backend role string to Dart enum
  UserRole? _roleFromString(String roleString) {
    switch (roleString) {
      case 'VibeCoordinator':
        return UserRole.vibeCoordinator;
      case 'VibePlanner':
        return UserRole.vibePlanner;
      case 'Wanderer':
        return UserRole.wanderer;
      case 'admin':
        return UserRole
            .vibeCoordinator; // Map admin to coordinator for trip functions (or add AdminRole enum)
      default:
        return UserRole.wanderer; // Default fallback
    }
  }

  // Set current user role (stub for role changes)
  void setCurrentUserRole(UserRole role) {
    _currentUserRole = role;
    notifyListeners();
  }

  // Set current user (for profile updates; replace with real auth/backend later)
  void setCurrentUser(User user) {
    _currentUser = user;
    currentUserId = user.id;
    notifyListeners();
    logger.i('Set current user: ${user.firstName} ${user.lastName}');
  }

  // Update user (real API PATCH /api/auth/users/:id with token)
  Future<void> updateUser(Map<String, dynamic> updates) async {
    logger.i('At Update User API');
    try {
      final timeoutDuration = Duration(seconds: await AppConfig.timeoutSeconds);
      final token = _jwtToken;
      if (token == null) throw Exception('No token—log in first');

      final response = await http
          .patch(
            Uri.parse(
              (await backendBaseUrl) +
                  apiUsersUpdate.replaceAll('{id}', currentUserId!),
            ),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: json.encode(updates),
          )
          .timeout(timeoutDuration);

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        _currentUser = User.fromJson(data['user']); // Reload updated user
        notifyListeners();
        logger.i('User updated from backend');
      } else {
        throw Exception('Failed to update user: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Error updating user: $e');
      // Fallback: Optimistic local update
      if (_currentUser != null) {
        _currentUser = _currentUser!.copyWith(
          firstName: updates['firstName'] ?? _currentUser!.firstName,
          notificationPreferences: updates['notificationPreferences'] != null
              ? NotificationPreferences.fromJson(
                  updates['notificationPreferences'],
                )
              : _currentUser!.notificationPreferences,
        );
        notifyListeners();
      }
    }
  }

  // Forgot password (stub: POST /api/auth/forgot-password)
  Future<void> forgotPassword(String email) async {
    try {
      final timeoutDuration = Duration(seconds: await AppConfig.timeoutSeconds);
      final response = await http
          .post(
            Uri.parse((await backendBaseUrl) + apiAuthForgotPassword),
            headers: {'Content-Type': 'application/json'},
            body: json.encode({'email': email}),
          )
          .timeout(timeoutDuration);
      ;

      if (response.statusCode == 200) {
        logger.i('Forgot password email sent for $email');
      } else {
        throw Exception('Failed to send reset email: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Forgot password error: $e');
      rethrow;
    }
  }
}
