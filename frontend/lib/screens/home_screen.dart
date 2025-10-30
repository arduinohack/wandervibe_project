import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'login_screen.dart'; // Navigate on logout
import 'signup_screen.dart'; // Navigate to signup
import '../models/plan.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart'; // For role and logout
import 'coordinator_dashboard_screen.dart'; // For coordinators
import 'user_profile_screen.dart'; // For profile
import 'settings_screen.dart';
import '../models/user.dart'; // For UserRole enum

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WanderVibe'), // App title
        backgroundColor: Colors.blue, // Matches theme
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              final userProvider = Provider.of<UserProvider>(
                context,
                listen: false,
              );
              await userProvider.logout();
              if (mounted) {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(builder: (context) => const LoginScreen()),
                );
              }
            },
            tooltip: 'Logout',
          ),
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
      floatingActionButton: Consumer<UserProvider>(
        builder: (context, userProvider, child) {
          if (userProvider.currentUserRole == UserRole.vibeCoordinator) {
            return FloatingActionButton.extended(
              onPressed: () =>
                  _showCreatePlanDialog(context), // Open dialog for creation
              icon: const Icon(Icons.add),
              label: const Text('New Plan'),
              backgroundColor: Colors.green,
            );
          }
          return const SizedBox.shrink(); // Hide for other roles
        },
      ),
    );
  }

  // Dialog for creating a new plan (inside _HomeScreenState)
  void _showCreatePlanDialog(BuildContext context) {
    final nameController = TextEditingController();
    final destinationController = TextEditingController();
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create New Trip'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Trip Name'),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: destinationController,
              decoration: const InputDecoration(labelText: 'Destination'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              if (nameController.text.isNotEmpty &&
                  destinationController.text.isNotEmpty) {
                final newPlan = Plan(
                  id: DateTime.now().millisecondsSinceEpoch
                      .toString(), // Temp ID
                  type: 'trip',
                  name: nameController.text,
                  destination: destinationController.text,
                  startDate: DateTime.now(),
                  endDate: DateTime.now().add(const Duration(days: 7)),
                  autoCalculateStartDate: false,
                  autoCalculateEndDate: false,
                  location: '',
                  budget: 1500.0,
                  planningState: 'initial',
                  timeZone: 'America/New_York',
                  ownerId: userProvider.currentUserId ?? 'user123',
                  createdAt: DateTime.now(),
                );
                await planProvider.createPlan(newPlan, userProvider.token);
                if (mounted) {
                  Navigator.pop(context); // Close dialog
                }
              }
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}
