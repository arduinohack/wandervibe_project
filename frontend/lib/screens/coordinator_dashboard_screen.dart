import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/plan_provider.dart';
import '../providers/invitation_provider.dart';
import '../providers/user_provider.dart'; // For role check
import 'plan_detail_screen.dart'; // Add this line for PlanDetailScreen navigation
import '../models/plan.dart';
import '../models/invitation.dart';
import '../models/event.dart'; // Add this line for EventType enum
import '../utils/logger.dart';

class CoordinatorDashboardScreen extends StatefulWidget {
  const CoordinatorDashboardScreen({super.key});

  @override
  State<CoordinatorDashboardScreen> createState() =>
      _CoordinatorDashboardScreenState();
}

class _CoordinatorDashboardScreenState extends State<CoordinatorDashboardScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController; // Controls tabs

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this); // 3 tabs
    // Load data on open
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final planProvider = Provider.of<PlanProvider>(context, listen: false);
      final invitationProvider = Provider.of<InvitationProvider>(
        context,
        listen: false,
      );
      final userProvider = Provider.of<UserProvider>(
        context,
        listen: false,
      ); // Added: Get token
      planProvider.fetchPlans(
        userProvider.token,
      ); // Pass token (if not already)
      invitationProvider.fetchInvitations(
        userProvider.token,
      ); // Fixed: Pass token
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Coordinator Dashboard'),
        backgroundColor: Colors.blue,
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.list), text: 'My Trips'),
            Tab(icon: Icon(Icons.mail), text: 'Pending Invites'),
            Tab(icon: Icon(Icons.event), text: 'Recent Events'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildMyPlansTab(context),
          _buildPendingInvitesTab(context),
          _buildRecentEventsTab(context),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          logger.i(
            'Reassign Coordinator button pressed',
          ); // Stub for reassign role
        },
        child: const Icon(Icons.admin_panel_settings),
      ),
    );
  }

  Widget _buildMyPlansTab(BuildContext context) {
    return Consumer<PlanProvider>(
      builder: (context, planProvider, child) {
        final userProvider = Provider.of<UserProvider>(
          context,
          listen: false,
        ); // Added: Grab UserProvider inside builder
        if (planProvider.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        final myPlans = planProvider.plans
            .where((plan) => plan.ownerId == userProvider.currentUserId)
            .toList(); // Stub current user
        if (myPlans.isEmpty) {
          return const Center(child: Text('No trips yet—create one!'));
        }
        return Column(
          children: [
            Expanded(
              // Makes list scrollable
              child: ListView.builder(
                itemCount: myPlans.length,
                itemBuilder: (context, index) {
                  final plan = myPlans[index];
                  return Card(
                    child: ListTile(
                      leading: const Icon(Icons.flight_takeoff),
                      title: Text(plan.name),
                      subtitle: Text(
                        '${plan.destination} | Budget: \$${plan.budget} | State: ${plan.planningState}',
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.edit),
                        onPressed: () {
                          logger.i('Edit trip ${plan.id}');
                          // Later: Navigate to edit screen
                        },
                      ),
                      onTap: () {
                        logger.i('View trip ${plan.id}');
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) =>
                                PlanDetailScreen(planId: plan.id),
                          ),
                        ); // Navigate to details
                      },
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16.0), // Spacing around button
              child: ElevatedButton.icon(
                onPressed: () async {
                  final userProvider = Provider.of<UserProvider>(
                    context,
                    listen: false,
                  ); // Get token for auth
                  final planProvider = Provider.of<PlanProvider>(
                    context,
                    listen: false,
                  );
                  final newPlan = Plan(
                    id: DateTime.now().millisecondsSinceEpoch
                        .toString(), // Temp ID, backend overrides
                    type: 'trip',
                    name:
                        'New Trip - ${DateTime.now().month}/${DateTime.now().day}', // Stub name; later from form
                    destination: 'Your Destination', // Stub; later from form
                    startDate: DateTime.now(),
                    endDate: DateTime.now().add(const Duration(days: 7)),
                    autoCalculateStartDate: false,
                    autoCalculateEndDate: false,
                    location: '',
                    budget: 1500.0,
                    planningState: 'initial',
                    timeZone: 'America/New_York',
                    ownerId:
                        userProvider.currentUserId ??
                        'user123', // From provider
                    createdAt: DateTime.now(),
                  );
                  await planProvider.createPlan(
                    newPlan,
                    userProvider.token,
                  ); // Pass token for auth
                },
                icon: const Icon(Icons.add),
                label: const Text('Create New Trip'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  minimumSize: const Size(double.infinity, 50), // Full width
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  // Tab 2: Pending Invites
  Widget _buildPendingInvitesTab(BuildContext context) {
    return Consumer<InvitationProvider>(
      builder: (context, invitationProvider, child) {
        if (invitationProvider.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        final pendingInvites = invitationProvider.invitations
            .where((inv) => inv.status == InvitationStatus.pending)
            .toList();
        if (pendingInvites.isEmpty) {
          return const Center(child: Text('No pending invites'));
        }
        return ListView.builder(
          itemCount: pendingInvites.length,
          itemBuilder: (context, index) {
            final invite = pendingInvites[index];
            return Card(
              child: ListTile(
                leading: const Icon(Icons.mail),
                title: Text('Invite for ${invite.role}'),
                subtitle: Text(
                  'Trip: ${invite.planId} | Invited by: ${invite.invitedBy}',
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.check, color: Colors.green),
                      onPressed: () async {
                        final userProvider = Provider.of<UserProvider>(
                          context,
                          listen: false,
                        ); // Added: Get token
                        await invitationProvider.respondToInvitation(
                          invite.id,
                          InvitationStatus.accepted,
                          userProvider.token,
                        ); // Pass token
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Invite accepted!')),
                        );
                      },
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.red),
                      onPressed: () async {
                        final userProvider = Provider.of<UserProvider>(
                          context,
                          listen: false,
                        ); // Added: Get token
                        await invitationProvider.respondToInvitation(
                          invite.id,
                          InvitationStatus.accepted,
                          userProvider.token,
                        ); // Pass token
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Invite accepted!')),
                        );
                      },
                    ), // Pass token if needed
                  ], // Single closing ] for Row children—no duplicate
                ),
              ),
            );
          },
        );
      },
    );
  }

  // Tab 3: Recent Events (across plans)
  Widget _buildRecentEventsTab(BuildContext context) {
    return Consumer<PlanProvider>(
      builder: (context, planProvider, child) {
        if (planProvider.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        // Mock recent events (later, fetch from all plans)
        final recentEvents = planProvider.events
            .take(5)
            .toList(); // Last 5 from current
        if (recentEvents.isEmpty) {
          return const Center(child: Text('No recent events'));
        }
        return ListView.builder(
          itemCount: recentEvents.length,
          itemBuilder: (context, index) {
            final event = recentEvents[index];
            return Card(
              child: ListTile(
                leading: Icon(
                  _getEventIcon(event.type),
                ), // From PlanDetailScreen
                title: Text(event.title),
                subtitle: Text(
                  '${event.location} | ${event.startTime.toLocal().toString().split(' ')[1].substring(0, 5)} | Day ${event.dayNumber}',
                ),
                trailing: Text('\$${event.cost}'),
              ),
            );
          },
        );
      },
    );
  }

  // Helper: Icon for event type (copy from PlanDetailScreen)
  IconData _getEventIcon(EventType type) {
    switch (type) {
      case EventType.flight:
        return Icons.flight;
      case EventType.car:
        return Icons.directions_car;
      case EventType.dining:
        return Icons.restaurant;
      case EventType.hotel:
        return Icons.hotel;
      case EventType.tour:
        return Icons.explore;
      case EventType.attraction:
        return Icons.location_on;
      case EventType.cruise:
        return Icons.sailing;
      case EventType.setup:
        return Icons.sailing;
      case EventType.ceremony:
        return Icons.sailing;
      case EventType.reception:
        return Icons.sailing;
      case EventType.vendor:
        return Icons.sailing;
      case EventType.custom:
        return Icons.sailing;
    }
  }
}
