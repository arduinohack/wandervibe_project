import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'login_screen.dart'; // Add this line for LoginScreen navigation
import 'signup_screen.dart'; // Add this line for SignupScreen navigation
import '../providers/user_provider.dart'; // For role check
import 'coordinator_dashboard_screen.dart'; // Navigation to dashboard
import 'user_profile_screen.dart'; // Navigation to profile
import 'settings_screen.dart';
import '../models/user.dart'; // For UserRole enum

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WanderVibe'), // App title
        backgroundColor: Colors.blue, // Matches theme
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => const SettingsScreen()),
              );
            },
            tooltip: 'App Settings',
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              final userProvider = Provider.of<UserProvider>(
                context,
                listen: false,
              );
              await userProvider.logout();
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(builder: (context) => const LoginScreen()),
              );
            },
            tooltip: 'Logout',
          ),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Welcome to WanderVibe! Tap to create a trip.', // Placeholder text
              style: TextStyle(fontSize: 20),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24), // Spacing between elements
            // Role-based Dashboard Button (only for VibeCoordinator)
            Consumer<UserProvider>(
              builder: (context, userProvider, child) {
                if (userProvider.currentUserRole == UserRole.vibeCoordinator) {
                  return ElevatedButton(
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) =>
                              const CoordinatorDashboardScreen(),
                        ),
                      );
                    },
                    child: const Text('Open Coordinator Dashboard'),
                  );
                } else {
                  return const Text(
                    'Dashboard available only for VibeCoordinators—log in as owner to see it.',
                  );
                }
              },
            ),
            const SizedBox(height: 16), // Spacing
            // Profile Button (always available)
            ElevatedButton(
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => const UserProfileScreen(),
                  ),
                );
              },
              child: const Text('Edit Profile'),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          print(
            'Create trip button pressed!',
          ); // Stub for create trip (navigate to create screen later)
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}
