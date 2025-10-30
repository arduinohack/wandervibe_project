import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/plan_provider.dart';
import '../providers/invitation_provider.dart';
import '../providers/user_provider.dart'; // For token
import '../models/plan.dart';
import '../models/invitation.dart';
import '../models/user.dart'; // For UserRole
import '../utils/logger.dart';
import 'plan_detail_screen.dart'; // For plan details
import 'add_event_screen.dart'; // For adding events

class CoordinatorDashboardScreen extends StatefulWidget {
  const CoordinatorDashboardScreen({super.key});

  @override
  State<CoordinatorDashboardScreen> createState() =>
      _CoordinatorDashboardScreenState();
}

class _CoordinatorDashboardScreenState extends State<CoordinatorDashboardScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this); // 3 tabs
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final planProvider = Provider.of<PlanProvider>(context, listen: false);
      final invitationProvider = Provider.of<InvitationProvider>(
        context,
        listen: false,
      );
      final userProvider = Provider.of<UserProvider>(context, listen: false);
      planProvider.fetchPlans(userProvider.token); // Load plans
      invitationProvider.fetchInvitations(userProvider.token); // Load invites
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
            Tab(icon: Icon(Icons.list), text: 'My Plans'),
            Tab(icon: Icon(Icons.mail), text: 'Invites'),
            Tab(icon: Icon(Icons.event), text: 'Events'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildMyPlansTab(context),
          _buildPendingInvitesTab(context),
          _buildEventsTab(context), // Stub for now
        ],
      ),
    );
  }

  Widget _buildMyPlansTab(BuildContext context) {
    return Consumer<PlanProvider>(
      builder: (context, planProvider, child) {
        final userProvider = Provider.of<UserProvider>(context, listen: false);
        logger.i(
          'Current User ID: ${userProvider.currentUserId}',
        ); // Added: Debug user ID
        if (planProvider.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        final myPlans = planProvider.plans
            .where((plan) => plan.ownerId == userProvider.currentUserId)
            .toList();
        logger.i(
          'Filtered myPlans length: ${myPlans.length}',
        ); // Added: See if filter works
        // Added: See if filter works
        if (myPlans.isEmpty) {
          return const Center(child: Text('No plans yet—create one!'));
        }
        return Column(
          children: [
            Expanded(
              child: ListView.builder(
                itemCount: myPlans.length,
                itemBuilder: (context, index) {
                  final plan = myPlans[index];
                  return Card(
                    child: ListTile(
                      leading: const Icon(Icons.flight_takeoff),
                      title: Text(plan.name),
                      subtitle: Text(
                        '${plan.destination} | Budget: \$${plan.budget}',
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.edit),
                        onPressed: () {
                          print('Edit plan ${plan.id}');
                        },
                      ),
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) =>
                                PlanDetailScreen(planId: plan.id),
                          ),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: ElevatedButton.icon(
                onPressed: () => _showCreatePlanDialog(context),
                icon: const Icon(Icons.add),
                label: const Text('Create New Plan'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  minimumSize: const Size(double.infinity, 50),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

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
                  'Plan: ${invite.planId} | Invited by: ${invite.invitedBy}',
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
                        );
                        await invitationProvider.respondToInvitation(
                          invite.id,
                          InvitationStatus.accepted,
                          userProvider.token,
                        );
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Invite accepted!')),
                          );
                        }
                      },
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.red),
                      onPressed: () async {
                        final userProvider = Provider.of<UserProvider>(
                          context,
                          listen: false,
                        );
                        await invitationProvider.respondToInvitation(
                          invite.id,
                          InvitationStatus.rejected,
                          userProvider.token,
                        );
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Invite rejected!')),
                          );
                        }
                      },
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildEventsTab(BuildContext context) {
    return const Center(
      child: Text('Events tab—coming soon!'), // Stub for now
    );
  }

  // Dialog for creating a new plan
  void _showCreatePlanDialog(BuildContext context) {
    final nameController = TextEditingController();
    final destinationController = TextEditingController();
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create New Plan'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: nameController,
              decoration: const InputDecoration(labelText: 'Plan Name'),
              validator: (value) =>
                  value?.isEmpty ?? true ? 'Name required' : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: destinationController,
              decoration: const InputDecoration(labelText: 'Destination'),
              validator: (value) =>
                  value?.isEmpty ?? true ? 'Destination required' : null,
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
                  id: DateTime.now().millisecondsSinceEpoch.toString(),
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
                if (mounted) Navigator.pop(context);
              }
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
}
