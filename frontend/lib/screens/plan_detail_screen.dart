import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:wandervibe_frontend/models/event_type.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart'; // For token if needed
import '../models/plan.dart';
import '../models/event.dart'; // For event list
import 'add_event_screen.dart'; // For adding events

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
    // No fetch needed—plan is passed from dashboard
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
                  builder: (context) => AddEventScreen(
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
                const Center(child: Text('No events yet—add one!'))
              else
                ...events.map(
                  (event) => Card(
                    child: ListTile(
                      leading: Icon(
                        event.type.icon,
                      ), // Icon from EventType extension
                      title: Text(event.title),
                      subtitle: Text(
                        '${event.startTime} - ${event.finishTime} | ${event.location} | \$${event.cost}',
                      ), // Added: Use finishTime getter
                      trailing: IconButton(
                        icon: const Icon(Icons.edit),
                        onPressed: () {
                          print('Edit event ${event.id}');
                        },
                      ),
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
