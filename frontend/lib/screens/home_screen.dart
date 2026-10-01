import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'login_screen.dart'; // Navigate on logout
// Navigate to signup
import '../models/plan.dart';
import '../models/plan_role_label.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart'; // For role and logout
import 'coordinator_dashboard_screen.dart'; // For coordinators
import 'invitations_screen.dart';
import 'plan_detail_screen.dart';
import 'user_profile_screen.dart'; // For profile
import 'settings_screen.dart';
import '../models/user.dart'; // For UserRole enum

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadPlans());
  }

  Future<void> _loadPlans() async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final status = await planProvider.fetchPlans(userProvider.token);
    if (!mounted) return;
    int? roleStatus;
    if (status == 200) {
      roleStatus = await planProvider.loadViewerRoles(
        userProvider.token,
        userProvider.currentUserId,
      );
      if (!mounted) return;
    }
    setState(() => _loaded = true);
    if (status == 401 || roleStatus == 401) {
      await _endSession(userProvider, planProvider, navigator);
    }
  }

  Future<void> _endSession(
    UserProvider userProvider,
    PlanProvider planProvider,
    NavigatorState navigator,
  ) async {
    planProvider.clearPlans();
    await userProvider.logout();
    if (!mounted) return;
    navigator.pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => const LoginScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WanderVibe'), // App title
        backgroundColor: Colors.blue, // Matches theme
        actions: [
          IconButton(
            icon: const Icon(Icons.mail),
            tooltip: 'Invitations',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => const InvitationsScreen(),
                ),
              );
            },
          ),
          if (Provider.of<UserProvider>(context).currentUserRole ==
              UserRole.vibeCoordinator)
            IconButton(
              icon: const Icon(Icons.dashboard),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => const CoordinatorDashboardScreen(),
                  ),
                );
              },
              tooltip: 'Coordinator dashboard',
            ),
          IconButton(
            icon: const Icon(Icons.person),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => const UserProfileScreen(),
                ),
              );
            },
            tooltip: 'Edit profile',
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              final userProvider = Provider.of<UserProvider>(
                context,
                listen: false,
              );
              await userProvider.logout();
              if (!context.mounted) return;
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(builder: (context) => const LoginScreen()),
              );
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
      body: Consumer<PlanProvider>(
        builder: (context, planProvider, child) {
          final waiting = !_loaded || planProvider.isLoading;
          if (waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (planProvider.plansError != null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  planProvider.plansError!,
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          if (planProvider.plans.isEmpty) {
            return const Center(
              child: Text(
                'No plans yet',
                style: TextStyle(fontSize: 20),
                textAlign: TextAlign.center,
              ),
            );
          }
          return ListView.builder(
            itemCount: planProvider.plans.length,
            itemBuilder: (context, index) {
              final plan = planProvider.plans[index];
              final userId = Provider.of<UserProvider>(context).currentUserId;
              final storedRole = planProvider.viewerStoredRole(plan.id, userId);
              final roleText = storedRole == null
                  ? null
                  : planRoleLabel(plan.type, storedRole);
              return Card(
                child: ListTile(
                  title: Text(plan.name),
                  subtitle: Text(
                    [
                      'Type: ${plan.type}',
                      if (roleText != null) 'Role: $roleText',
                      'Dates: ${formatPlanDate(plan.startDate)} – ${formatPlanDate(plan.endDate)}',
                    ].join('\n'),
                  ),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => PlanDetailScreen(plan: plan),
                      ),
                    );
                  },
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: Consumer<UserProvider>(
        builder: (context, userProvider, child) {
          if (userProvider.currentUserRole == UserRole.vibeCoordinator) {
            return FloatingActionButton.extended(
              onPressed: () => _showCreatePlanDialog(context),
              icon: const Icon(Icons.add),
              label: const Text('New Plan'),
              backgroundColor: Colors.green,
            );
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  void _showCreatePlanDialog(BuildContext context) {
    final nameController = TextEditingController();
    final destinationController = TextEditingController();
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Create plan'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Plan name'),
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
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final name = nameController.text.trim();
              final destination = destinationController.text.trim();
              if (name.isEmpty || destination.isEmpty) return;
              final status = await planProvider.createPlan(
                Plan(
                  id: '',
                  type: 'trip',
                  name: name,
                  destination: destination,
                  startDate: DateTime.now(),
                  endDate: DateTime.now().add(const Duration(days: 7)),
                  autoCalculateStartDate: false,
                  autoCalculateEndDate: false,
                  location: '',
                  budget: 0,
                  planningState: 'initial',
                  timeZone: 'UTC',
                  ownerId: userProvider.currentUserId ?? '',
                  createdAt: DateTime.now(),
                ),
                userProvider.token,
              );
              if (!mounted) return;
              if (status == 201) {
                navigator.pop();
                return;
              }
              if (status == 401) {
                navigator.pop();
                await _endSession(userProvider, planProvider, navigator);
                return;
              }
              messenger.showSnackBar(
                SnackBar(
                  content: Text(
                    status == null
                        ? 'Could not create plan'
                        : 'Could not create plan ($status)',
                  ),
                ),
              );
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}
