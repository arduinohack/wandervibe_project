import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart'; // For JWT storage
import '../models/user.dart'; // Your User model with Address/Preferences

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
      print(
        'Flutter sending login: email=$email, password=$password',
      ); // Log input
      final response = await http.post(
        Uri.parse('http://10.0.2.2:3000/api/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'email': email, 'password': password}),
      );

      print('Flutter received status: ${response.statusCode}'); // Log status
      print(
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
        print(
          'Logged in as $email with token: ${_jwtToken!.substring(0, 20)}...',
        );
      } else {
        throw Exception(
          'Login failed: ${response.statusCode} - ${response.body}',
        );
      }
    } catch (e) {
      print('Login error: $e');
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
      final response = await http.post(
        Uri.parse('http://localhost:3000/api/auth/register'),
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
      );

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        print('Signup successful: ${data['message']}');
        // Navigate to login (handled in screen)
      } else {
        throw Exception(
          'Signup failed: ${response.statusCode} - ${response.body}',
        );
      }
    } catch (e) {
      print('Signup error: $e');
      rethrow; // Pass to UI for SnackBar
    }
  }

  // Logout (clear token)
  Future<void> logout() async {
    await _storage.delete(key: 'jwt_token');
    _jwtToken = null;
    currentUserId = null;
    _currentUserRole = null;
    _currentUser = null;
    notifyListeners();
    print('Logged out');
  }

  // Load stored token on app start (for persistent login)
  Future<void> loadStoredToken() async {
    try {
      _jwtToken = await _storage.read(key: 'jwt_token');
      if (_jwtToken != null) {
        // Mock: Assume valid, load user (later verify with backend /api/verify-token)
        currentUserId = 'user123';
        _currentUserRole = UserRole.vibeCoordinator;
        _currentUser = User(
          id: 'user123',
          firstName: 'Alex',
          lastName: 'Vander',
          email: 'alex@vandervibe.com',
          phoneNumber: '+1-555-1234',
          address: Address(
            street: '123 Wander St',
            city: 'New York',
            state: 'NY',
            country: 'USA',
            postalCode: '10001',
          ),
          notificationPreferences: NotificationPreferences(
            email: true,
            sms: false,
          ),
          createdAt: DateTime.now(),
        );
        notifyListeners(); // Update UI
        print('Loaded stored token');
      } else {
        print('No stored token—user not logged in');
      }
    } catch (e) {
      print('Error loading stored token: $e');
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
    print('Set current user: ${user.firstName} ${user.lastName}');
  }
}
