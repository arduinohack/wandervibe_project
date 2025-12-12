import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart'; // For launchUrl
import '../models/event.dart';
import '../models/event_type.dart';
import '../models/plan.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import '../screens/event_screen.dart';
import '../utils/logger.dart';
import '../utils/utils.dart';

class PlanDetailScreen extends StatefulWidget {
  final Plan plan; // Full plan object passed from dashboard

  const PlanDetailScreen({super.key, required this.plan});

  @override
  State<PlanDetailScreen> createState() => _PlanDetailScreenState();
}

class _PlanDetailScreenState extends State<PlanDetailScreen> {
  late Future<void> _fetchFuture;

  @override
  void initState() {
    super.initState();
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    _fetchFuture = planProvider
        .fetchPlan(widget.plan.id, userProvider.token)
        .catchError((e) => logger.e('Fetch error: $e'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.plan.name,
          overflow: TextOverflow.ellipsis, // Shorten long titles with ...
          maxLines: 1, // Single line to prevent wrap
        ),
        backgroundColor: Colors.blue,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8.0), // Space for visibility
            child: IconButton(
              icon: const Icon(
                Icons.add,
                size: 28,
                color: Colors.white,
              ), // Larger, white for contrast
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => EventScreen(planId: widget.plan.id),
                  ),
                );
              },
              tooltip: 'Add Event',
            ),
          ),
        ],
      ),
      body: Consumer<PlanProvider>(
        builder: (context, planProvider, child) {
          return FutureBuilder<void>(
            future: _fetchFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              } else if (snapshot.hasError) {
                logger.e('Failed to fetch events: ${snapshot.error}');
                return Center(child: Text('Error: ${snapshot.error}'));
              }

              final dayNumbers = planProvider.getDayNumbersForPlan(
                widget.plan.id,
              );
              final events = planProvider.sortedEvents
                  .where((event) => event.planId == widget.plan.id)
                  .toList();

              return ListView(
                padding: const EdgeInsets.all(16.0),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.plan.name,
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text('Destination: ${widget.plan.destination}'),
                          Text('Budget: \$${widget.plan.budget}'),
                          Text(
                            'Dates: ${DateFormat('yyyy-MM-dd').format(widget.plan.startDate.toLocal())} - ${DateFormat('yyyy-MM-dd').format(widget.plan.endDate.toLocal())}',
                          ),
                          Text('State: ${widget.plan.planningState}'),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Events',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  if (events.isEmpty)
                    const Center(child: Text('No events yet—add one!'))
                  else
                    ...events.map(
                      (event) => Card(
                        child: Column(
                          children: [
                            if (event.type == EventType.flight ||
                                event.type == EventType.train ||
                                event.type == EventType.carRental ||
                                event.type == EventType.carService) ...[
                              // Reservation header
                              ListTile(
                                leading: Icon(planProvider.getIcon(event.type)),
                                title: Text(event.name),
                                subtitle: Text(
                                  '${event.serviceProvider ?? 'Unknown Service Provider'} • ${event.bookingReference ?? 'No Booking Ref'}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      icon: const Icon(
                                        Icons.edit,
                                        color: Colors.blue,
                                      ),
                                      onPressed: () =>
                                          _editEvent(context, event),
                                      tooltip: 'Edit Event',
                                    ),
                                  ],
                                ),
                              ),
                              // Individual legs
                              ...event.subEvents.map(
                                (leg) => ListTile(
                                  leading: Icon(
                                    leg.subType == 'departure' ||
                                            leg.subType == 'pickup'
                                        ? Icons.flight_takeoff
                                        : Icons.flight_land,
                                    color:
                                        leg.subType == 'departure' ||
                                            leg.subType == 'pickup'
                                        ? Colors.green
                                        : Colors.orange,
                                  ),
                                  title: Text(
                                    '${capitalize(leg.subType)}: ${leg.name}',
                                  ),
                                  subtitle: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${DateFormat('EEE, MMM d • HH:mm').format(leg.startTime ?? DateTime.now())}',
                                      ),
                                      if (leg.subType == 'departure' ||
                                          leg.subType == 'pickup')
                                        Text(
                                          'Service # ${leg.serviceNumber ?? '—'} • Class ${leg.serviceClass ?? 'N/A'}',
                                        ),
                                      if (leg.subType == 'arrival' ||
                                          leg.subType == 'dropoff')
                                        Text(
                                          'Location: ${leg.location ?? '—'}',
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                            ] else ...[
                              ListTile(
                                leading: Icon(planProvider.getIcon(event.type)),
                                title: Text(event.name),
                                subtitle: Text(
                                  'Day ${dayNumbers[event.id ?? ''] ?? 1} • ${event.location ?? 'No location'} • ${event.details ?? ''}',
                                ),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      icon: const Icon(
                                        Icons.edit,
                                        color: Colors.blue,
                                      ),
                                      onPressed: () =>
                                          _editEvent(context, event),
                                      tooltip: 'Edit Event',
                                    ),
                                    IconButton(
                                      icon: const Icon(
                                        Icons.delete,
                                        color: Colors.red,
                                      ),
                                      onPressed: () =>
                                          _deleteEvent(context, event),
                                      tooltip: 'Delete Event',
                                    ),
                                  ],
                                ),
                              ),
                              if (event.urlLinks.isNotEmpty)
                                ...event.urlLinks.map(
                                  (urlLink) => ListTile(
                                    leading: const Icon(Icons.link),
                                    title: Text(
                                      urlLink.linkName.isEmpty
                                          ? urlLink.linkUrl
                                          : urlLink.linkName,
                                    ),
                                    subtitle: Text(urlLink.linkUrl),
                                    trailing: IconButton(
                                      icon: const Icon(Icons.open_in_new),
                                      onPressed: () async {
                                        final Uri url = Uri.parse(
                                          urlLink.linkUrl,
                                        );
                                        if (await canLaunchUrl(url)) {
                                          await launchUrl(url);
                                        } else {
                                          ScaffoldMessenger.of(
                                            context,
                                          ).showSnackBar(
                                            SnackBar(
                                              content: Text(
                                                'Could not open ${urlLink.linkUrl}',
                                              ),
                                            ),
                                          );
                                        }
                                      },
                                    ),
                                  ),
                                ),
                            ],
                          ],
                        ),
                      ),
                    ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  // Edit event method
  void _editEvent(BuildContext context, Event event) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => EventScreen(planId: widget.plan.id, event: event),
      ),
    );
  }

  // Delete event method with confirmation
  void _deleteEvent(BuildContext context, Event event) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Event?'),
        content: Text("Delete '${event.name}'? This can't be undone."),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              Navigator.pop(context); // Close dialog
              final planProvider = Provider.of<PlanProvider>(
                context,
                listen: false,
              );
              final userProvider = Provider.of<UserProvider>(
                context,
                listen: false,
              );
              try {
                await planProvider.deleteEvent(
                  event.id ?? '',
                  userProvider.token,
                );
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('${event.name} deleted!')),
                );
              } catch (e) {
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(SnackBar(content: Text('Delete failed: $e')));
              }
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}
