import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/trip_provider.dart';
import '../providers/invitation_provider.dart';
import '../providers/user_provider.dart'; // For role check
import '../models/trip.dart';
import '../models/invitation.dart';
import '../models/event.dart'; // Add this line for EventType enum

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
      final tripProvider = Provider.of<TripProvider>(context, listen: false);
      final invitationProvider = Provider.of<InvitationProvider>(
        context,
        listen: false,
      );
      final userProvider = Provider.of<UserProvider>(
        context,
        listen: false,
      ); // Added for token
      tripProvider.fetchTrips(userProvider.token); // Fixed: Pass token
      invitationProvider.fetchInvitations();
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
          _buildMyTripsTab(context),
          _buildPendingInvitesTab(context),
          _buildRecentEventsTab(context),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          print(
            'Reassign Coordinator button pressed',
          ); // Stub for reassign role
        },
        child: const Icon(Icons.admin_panel_settings),
      ),
    );
  }

  // Tab 1: My Trips (owned trips)
  Widget _buildMyTripsTab(BuildContext context) {
    return Consumer<TripProvider>(
      builder: (context, tripProvider, child) {
        if (tripProvider.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        final myTrips = tripProvider.trips
            .where((trip) => trip.ownerId == 'user123')
            .toList(); // Stub current user
        if (myTrips.isEmpty) {
          return const Center(child: Text('No trips yet—create one!'));
        }
        return ListView.builder(
          itemCount: myTrips.length,
          itemBuilder: (context, index) {
            final trip = myTrips[index];
            return Card(
              child: ListTile(
                leading: const Icon(Icons.flight_takeoff),
                title: Text(trip.name),
                subtitle: Text(
                  '${trip.destination} | Budget: \$${trip.budget} | State: ${trip.planningState}',
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.edit),
                  onPressed: () {
                    print('Edit trip ${trip.id}');
                    // Later: Navigate to edit screen
                  },
                ),
                onTap: () {
                  print('View trip ${trip.id}');
                  // Later: Navigate to TripDetailScreen
                },
              ),
            );
          },
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
                  'Trip: ${invite.tripId} | Invited by: ${invite.invitedBy}',
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.check, color: Colors.green),
                      onPressed: () async {
                        await invitationProvider.respondToInvitation(
                          invite.id,
                          InvitationStatus.accepted,
                        );
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Invite accepted!')),
                        );
                      },
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.red),
                      onPressed: () async {
                        await invitationProvider.respondToInvitation(
                          invite.id,
                          InvitationStatus.rejected,
                        );
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Invite rejected!')),
                        );
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

  // Tab 3: Recent Events (across trips)
  Widget _buildRecentEventsTab(BuildContext context) {
    return Consumer<TripProvider>(
      builder: (context, tripProvider, child) {
        if (tripProvider.isLoading) {
          return const Center(child: CircularProgressIndicator());
        }
        // Mock recent events (later, fetch from all trips)
        final recentEvents = tripProvider.events
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
                ), // From TripDetailScreen
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

  // Helper: Icon for event type (copy from TripDetailScreen)
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
    }
  }
}
