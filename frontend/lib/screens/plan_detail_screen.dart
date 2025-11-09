import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart'; // For launchUrl
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart'; // For token if needed
import '../models/plan.dart';
import '../models/event.dart'; // For event list
import '../models/event_type.dart'; // For EventType (fixed import)
import 'event_screen.dart'; // For adding events
import '../utils/logger.dart';

class PlanDetailScreen extends StatefulWidget {
  final Plan plan; // Full plan object passed from dashboard
  const PlanDetailScreen({super.key, required this.plan});

  @override
  State<PlanDetailScreen> createState() => _PlanDetailScreenState();
}

class _PlanDetailScreenState extends State<PlanDetailScreen> {
  @override
  void initState() {
    super.initState();
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    logger.i('Fetching plan planId: ${widget.plan.id}');
    planProvider.fetchPlan(widget.plan.id, userProvider.token);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.plan.name ?? 'Plan Details'), // Use passed plan
        backgroundColor: Colors.blue,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => EventScreen(
                    planId: widget.plan.id,
                  ), // Pass plan.id for linking
                ),
              );
            },
            tooltip: 'Add Event',
          ),
        ],
      ),
      body: Consumer<PlanProvider>(
        builder: (context, planProvider, child) {
          // Filter events for this plan (from provider's events list)
          final events = planProvider.events
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
                        widget.plan.name ?? 'Unnamed Plan',
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Destination: ${widget.plan.destination ?? 'Unknown'}',
                      ),
                      Text('Budget: \$${widget.plan.budget ?? 0}'),
                      Text(
                        'Dates: ${widget.plan.startDate.toLocal().toString().substring(0, 10)} - ${widget.plan.endDate.toLocal().toString().substring(0, 10)}',
                      ),
                      Text('State: ${widget.plan.planningState ?? 'initial'}'),
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
                const Center(
                  child: Text('No events yet—add one!'),
                ) // Fixed: No braces for single widget
              else
                ...events.map(
                  (event) => Card(
                    child: Column(
                      children: [
                        ListTile(
                          leading: Icon(event.type.icon), // Event type icon
                          title: Text(event.name),
                          subtitle: Text(
                            '${event.startTime} - ${event.endTime ?? 'TBD'} | ${event.location ?? ''} | \$${event.cost ?? 0}',
                          ), // Fixed: subtitle: Text, null-safety
                          trailing: IconButton(
                            icon: const Icon(Icons.edit),
                            onPressed: () {
                              logger.i('Edit event ${event.id}');
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (context) => EventScreen(
                                    planId: widget.plan.id,
                                    event:
                                        event, // Pass the event for edit mode
                                  ),
                                ),
                              );
                            },
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
                                  final Uri url = Uri.parse(urlLink.linkUrl);
                                  if (await canLaunchUrl(url)) {
                                    await launchUrl(url);
                                  } else {
                                    ScaffoldMessenger.of(context).showSnackBar(
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
                        if (event.subEvents.isNotEmpty)
                          ...event.subEvents.map(
                            (subEvent) => ListTile(
                              title: Text('${subEvent.name}: ${subEvent.time}'),
                              subtitle: Text('${subEvent.location ?? ''}'),
                              /*trailing:
                                  subEvent.subType ==
                                      'departure' // Fixed: 'departure' (typo was 'departure')
                                  ? Text(subEvent.gate ?? '')
                                  : Text(subEvent.baggageClaim ?? ''),*/
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
