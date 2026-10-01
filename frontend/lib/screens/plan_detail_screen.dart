import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/plan.dart';
import '../models/plan_role_label.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import 'login_screen.dart';

/// UTC clock time for an activity start. Null stays "not set".
String formatActivityStart(DateTime? value) {
  if (value == null) return 'not set';
  final utc = value.toUtc();
  String two(int number) => number.toString().padLeft(2, '0');
  final year = utc.year.toString().padLeft(4, '0');
  return '$year-${two(utc.month)}-${two(utc.day)} ${two(utc.hour)}:${two(utc.minute)} UTC';
}

class PlanDetailScreen extends StatefulWidget {
  final Plan plan;

  const PlanDetailScreen({super.key, required this.plan});

  @override
  State<PlanDetailScreen> createState() => _PlanDetailScreenState();
}

class _PlanDetailScreenState extends State<PlanDetailScreen> {
  bool _loaded = false;
  int? _status;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final status = await planProvider.fetchPlan(
      widget.plan.id,
      userProvider.token,
    );
    if (!mounted) return;
    setState(() {
      _loaded = true;
      _status = status;
    });
    if (status == 401) {
      planProvider.clearPlans();
      await userProvider.logout();
      if (!mounted) return;
      navigator.pushAndRemoveUntil(
        MaterialPageRoute(builder: (context) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.plan.name,
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
        backgroundColor: Colors.blue,
      ),
      body: Consumer<PlanProvider>(
        builder: (context, planProvider, child) {
          if (!_loaded || planProvider.isLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (_status == 403) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Not allowed to view this itinerary',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 20),
                ),
              ),
            );
          }
          if (_status != 200) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  planProvider.itineraryError ?? 'Could not load activities',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }

          final storedRole = planProvider.viewerStoredRole(
            widget.plan.id,
            Provider.of<UserProvider>(context, listen: false).currentUserId,
          );
          final roleText = storedRole == null
              ? null
              : planRoleLabel(widget.plan.type, storedRole);
          final events = planProvider.itineraryEvents;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
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
                      if (roleText != null) Text('Role: $roleText'),
                      Text('Budget: \$${widget.plan.budget}'),
                      Text(
                        'Dates: ${formatPlanDate(widget.plan.startDate)} - ${formatPlanDate(widget.plan.endDate)}',
                      ),
                      Text('State: ${widget.plan.planningState}'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Itinerary',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              if (events.isEmpty)
                const Center(
                  child: Text(
                    'No activities yet',
                    style: TextStyle(fontSize: 20),
                    textAlign: TextAlign.center,
                  ),
                )
              else
                ...events.map((event) {
                  final type = event.typeLabel.isEmpty
                      ? event.type.name
                      : event.typeLabel;
                  return Card(
                    child: ListTile(
                      title: Text(event.name),
                      subtitle: Text(
                        'Type: $type\nStart: ${formatActivityStart(event.startTime)}',
                      ),
                    ),
                  );
                }),
            ],
          );
        },
      ),
    );
  }
}
