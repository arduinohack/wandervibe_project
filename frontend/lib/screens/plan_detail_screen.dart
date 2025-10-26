import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/plan_provider.dart'; // Your provider
import '../providers/user_provider.dart'; // Your provider
import '../models/plan.dart'; // Plan model
import '../models/event.dart'; // Event model
import '../models/user.dart'; // User model
import '../screens/add_event_screen.dart'; // Your new screen

class PlanDetailScreen extends StatefulWidget {
  final String planId; // Passed from HomeScreen

  const PlanDetailScreen({super.key, required this.planId});

  @override
  State<PlanDetailScreen> createState() => _PlanDetailScreenState();
}

class _PlanDetailScreenState extends State<PlanDetailScreen> {
  @override
  void initState() {
    super.initState();
    // Load data when screen opens
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final planProvider = Provider.of<PlanProvider>(context, listen: false);
      final userProvider = Provider.of<UserProvider>(
        context,
        listen: false,
      ); // Added: Get token
      planProvider.fetchPlan(
        widget.planId,
        userProvider.token,
      ); // Fixed: Pass token
      planProvider.fetchPlanUsers(widget.planId, userProvider.token);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Need to get the plan  name here...',
        ), // Fixed: widget. for plan
        backgroundColor: Colors.blue, // Matches theme
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => AddEventScreen(planId: widget.planId),
                ),
              );
            },
            tooltip: 'Add Event',
          ),
        ],
      ),
      body: Consumer<PlanProvider>(
        // Listens to provider changes
        builder: (context, planProvider, child) {
          if (planProvider.isLoading) {
            return const Center(
              child: CircularProgressIndicator(),
            ); // Loading spinner
          }

          final plan = planProvider.plans.firstWhere(
            (t) => t.id == widget.planId,
            orElse: () => Plan(
              id: '',
              type: 'trip',
              name: 'Unknown Trip',
              destination: '',
              startDate: DateTime.now(),
              endDate: DateTime.now(),
              autoCalculateStartDate: false,
              autoCalculateEndDate: true,
              location: '',
              budget: 0.0,
              planningState: 'initial',
              timeZone: 'UTC',
              ownerId: '',
              createdAt: DateTime.now(),
            ),
          );

          return SingleChildScrollView(
            // Scrollable for long itineraries
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Plan Overview Card
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            plan.name,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 8),
                          Text('Destination: ${plan.destination}'),
                          Text(
                            'Dates: ${plan.startDate.toLocal().toString().split(' ')[0]} - ${plan.endDate.toLocal().toString().split(' ')[0]}',
                          ),
                          Text('Budget: \$${plan.budget.toStringAsFixed(2)}'),
                          Text('State: ${plan.planningState}'),
                          Text('Time Zone: ${plan.timeZone}'),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Itinerary Section
                  const Text(
                    'Itinerary',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  ..._buildItineraryGroups(
                    planProvider.events,
                  ), // Grouped by Day Number

                  const SizedBox(height: 16),

                  // Plan Users Section
                  const Text(
                    'Trip Users',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  ..._buildPlanUsersList(planProvider.planUsers),

                  const SizedBox(height: 16),

                  // Role-Based Actions
                  _buildRoleBasedActions(context, planProvider),
                ],
              ),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => AddEventScreen(planId: widget.planId),
            ),
          );
        },
        child: const Icon(Icons.add),
      ),
    );
  }

  // Helper: Group events by Day Number
  List<Widget> _buildItineraryGroups(List<Event> events) {
    if (events.isEmpty) {
      return [const Text('No events yet—add some!')];
    }

    // Group by dayNumber (computed in provider)
    final Map<int, List<Event>> groups = {};
    for (var event in events) {
      int day = event.dayNumber ?? 1; // Default to 1 if not computed
      groups.putIfAbsent(day, () => []).add(event);
    }

    return groups.entries.map((entry) {
      int day = entry.key;
      List<Event> dayEvents = entry.value;
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Day $day', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              ...dayEvents.map(
                (event) => ListTile(
                  leading: Icon(
                    _getEventIcon(event.type),
                  ), // Icon based on type
                  title: Text(event.title),
                  subtitle: Text(
                    '${event.location} | ${event.startTime.toLocal().toString().split(' ')[1].substring(0, 5)} - ${event.endTime.toLocal().toString().split(' ')[1].substring(0, 5)} | Cost: \$${event.cost} (${event.costType})',
                  ),
                  trailing: Text('Day ${event.dayNumber}'),
                ),
              ),
            ],
          ),
        ),
      );
    }).toList();
  }

  // Helper: List plan users
  List<Widget> _buildPlanUsersList(List<PlanUser> planUsers) {
    if (planUsers.isEmpty) {
      return [const Text('No users yet—invite some!')];
    }

    return planUsers
        .map(
          (planUser) => ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person)),
            title: Text(
              'User ${planUser.userId}',
            ), // Later, fetch full name from User
            subtitle: Text(
              planUser.role
                  .toString()
                  .split('.')
                  .last
                  .replaceAll('vibe', '')
                  .toUpperCase(),
            ),
          ),
        )
        .toList();
  }

  // Helper: Role-based actions (stub current user role for now)
  Widget _buildRoleBasedActions(
    BuildContext context,
    PlanProvider planProvider,
  ) {
    // Stub: Assume current user is VibeCoordinator (replace with UserProvider check)
    bool isVibeCoordinator =
        true; // Later: Provider.of<UserProvider>(context).currentUserRole == UserRole.vibeCoordinator

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        ElevatedButton.icon(
          onPressed: () {
            print('Invite VibePlanner button pressed');
            // Later: Navigate to invite screen with role check
          },
          icon: const Icon(Icons.person_add),
          label: const Text('Invite Planner'),
          style: ElevatedButton.styleFrom(
            backgroundColor: isVibeCoordinator
                ? Colors.green
                : Colors.grey, // Disabled if not coordinator
          ),
          onLongPress: isVibeCoordinator
              ? null
              : () {}, // Disable if not coordinator
        ),
        ElevatedButton.icon(
          onPressed: () {
            print('Invite Wanderer button pressed');
          },
          icon: const Icon(Icons.group_add),
          label: const Text('Invite Wanderer'),
          style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
        ),
      ],
    );
  }

  // Helper: Icon for event type
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
        return Icons.location_on; // Fixed: For landmarks/attractions
      case EventType.cruise:
        return Icons.sailing; // Fixed: For sailboat/cruise
      case EventType.setup:
        return Icons.sailing; // Fixed: For sailboat/cruise
      case EventType.ceremony:
        return Icons.sailing; // Fixed: For sailboat/cruise
      case EventType.reception:
        return Icons.sailing; // Fixed: For sailboat/cruise
      case EventType.vendor:
        return Icons.sailing; // Fixed: For sailboat/cruise
      case EventType.custom:
        return Icons.sailing; // Fixed: For sailboat/cruise
    }
  }
}
