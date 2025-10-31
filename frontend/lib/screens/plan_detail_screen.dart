import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart'; // For token
import '../models/plan.dart';
import '../models/event.dart'; // For event list and type.icon
import 'add_event_screen.dart'; // For adding events

class PlanDetailScreen extends StatefulWidget {
  final String planId; // Passed from dashboard onTap
  const PlanDetailScreen({super.key, required this.planId});

  @override
  State<PlanDetailScreen> createState() => _PlanDetailScreenState();
}

class _PlanDetailScreenState extends State<PlanDetailScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final planProvider = Provider.of<PlanProvider>(context, listen: false);
      final userProvider = Provider.of<UserProvider>(context, listen: false);
      planProvider.fetchPlan(
        widget.planId,
        userProvider.token,
      ); // Fetch plan by ID
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Plan Details'),
        backgroundColor: Colors.blue,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => AddEventScreen(
                    planId: widget.planId,
                  ), // Pass planId for linking
                ),
              );
            },
            tooltip: 'Add Event',
          ),
        ],
      ),
      body: Consumer<PlanProvider>(
        builder: (context, planProvider, child) {
          final plan = planProvider.currentPlan; // From fetchPlanById
          if (plan == null) {
            return const Center(
              child: CircularProgressIndicator(),
            ); // Loading spinner
          }
          final events = planProvider.events
              .where(
                (event) => event.planId == plan.id,
              ) // Filter events for this plan
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
                        plan.name,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text('Destination: ${plan.destination}'),
                      Text('Budget: \$${plan.budget}'),
                      Text(
                        'Dates: ${plan.startDate.toLocal().toString().substring(0, 10)} - ${plan.endDate.toLocal().toString().substring(0, 10)}',
                      ),
                      Text('State: ${plan.planningState}'),
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
                        '${event.startTime} | ${event.location} | \$${event.cost}',
                      ),
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
