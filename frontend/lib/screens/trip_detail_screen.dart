import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/trip_provider.dart'; // Your provider
import '../providers/user_provider.dart'; // Your provider
import '../models/trip.dart'; // Trip model
import '../models/event.dart'; // Event model
import '../models/user.dart'; // User model
import '../screens/add_event_screen.dart'; // Your new screen

class TripDetailScreen extends StatefulWidget {
  final String tripId; // Passed from HomeScreen

  const TripDetailScreen({super.key, required this.tripId});

  @override
  State<TripDetailScreen> createState() => _TripDetailScreenState();
}

class _TripDetailScreenState extends State<TripDetailScreen> {
  @override
  void initState() {
    super.initState();
    // Load data when screen opens
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final tripProvider = Provider.of<TripProvider>(context, listen: false);
      final userProvider = Provider.of<UserProvider>(
        context,
        listen: false,
      ); // Added: Get token
      tripProvider.fetchItinerary(
        widget.tripId,
        userProvider.token,
      ); // Fixed: Pass token
      tripProvider.fetchTripUsers(widget.tripId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trip Details'),
        backgroundColor: Colors.blue, // Matches theme
      ),
      body: Consumer<TripProvider>(
        // Listens to provider changes
        builder: (context, tripProvider, child) {
          if (tripProvider.isLoading) {
            return const Center(
              child: CircularProgressIndicator(),
            ); // Loading spinner
          }

          final trip = tripProvider.trips.firstWhere(
            (t) => t.id == widget.tripId,
            orElse: () => Trip(
              id: '',
              name: 'Unknown Trip',
              destination: '',
              startDate: DateTime.now(),
              endDate: DateTime.now(),
              budget: 0.0,
              planningState: 'initial',
              timeZone: 'UTC',
              ownerId: '',
            ),
          );

          return SingleChildScrollView(
            // Scrollable for long itineraries
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Trip Overview Card
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            trip.name,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 8),
                          Text('Destination: ${trip.destination}'),
                          Text(
                            'Dates: ${trip.startDate.toLocal().toString().split(' ')[0]} - ${trip.endDate.toLocal().toString().split(' ')[0]}',
                          ),
                          Text('Budget: \$${trip.budget.toStringAsFixed(2)}'),
                          Text('State: ${trip.planningState}'),
                          Text('Time Zone: ${trip.timeZone}'),
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
                    tripProvider.events,
                  ), // Grouped by Day Number

                  const SizedBox(height: 16),

                  // Trip Users Section
                  const Text(
                    'Trip Users',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  ..._buildTripUsersList(tripProvider.tripUsers),

                  const SizedBox(height: 16),

                  // Role-Based Actions
                  _buildRoleBasedActions(context, tripProvider),
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
              builder: (context) => AddEventScreen(tripId: widget.tripId),
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

  // Helper: List trip users
  List<Widget> _buildTripUsersList(List<TripUser> tripUsers) {
    if (tripUsers.isEmpty) {
      return [const Text('No users yet—invite some!')];
    }

    return tripUsers
        .map(
          (tripUser) => ListTile(
            leading: const CircleAvatar(child: Icon(Icons.person)),
            title: Text(
              'User ${tripUser.userId}',
            ), // Later, fetch full name from User
            subtitle: Text(
              tripUser.role
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
    TripProvider tripProvider,
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
    }
  }
}
