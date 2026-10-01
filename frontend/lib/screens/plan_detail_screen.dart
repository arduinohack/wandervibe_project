import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/plan.dart';
import '../models/plan_role_label.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import 'login_screen.dart';

const activityTypes = ['tour', 'dining', 'hotel'];

/// UTC `YYYY-MM-DD HH:mm`. Anything else is not a start time.
DateTime? parseActivityStart(String text) {
  final match = RegExp(
    r'^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$',
  ).firstMatch(text.trim());
  if (match == null) return null;
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final hour = int.parse(match.group(4)!);
  final minute = int.parse(match.group(5)!);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;
  return DateTime.utc(
    int.parse(match.group(1)!),
    month,
    day,
    hour,
    minute,
  );
}

bool canAddActivity(String? storedRole) {
  final role = storedRole?.trim();
  return role == 'Owner' || role == 'Collaborator';
}

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
      await _endSession(userProvider, planProvider, navigator);
    }
  }

  Future<void> _endSession(
    UserProvider userProvider,
    PlanProvider planProvider,
    NavigatorState navigator,
  ) async {
    planProvider.clearPlans();
    await userProvider.logout();
    if (!mounted) return;
    navigator.pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => const LoginScreen()),
      (route) => false,
    );
  }

  Future<void> _addActivity() async {
    final draft = await showDialog<_ActivityDraft>(
      context: context,
      builder: (context) => const _AddActivityDialog(),
    );
    if (draft == null || !mounted) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final status = await planProvider.createActivity(
      planId: widget.plan.id,
      name: draft.name,
      type: draft.type,
      startTime: draft.start,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (status == 401) {
      await _endSession(userProvider, planProvider, navigator);
      return;
    }
    if (status == 403) {
      messenger.showSnackBar(const SnackBar(content: Text('Not allowed')));
      return;
    }
    if (status != 201) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not add activity')),
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
          final showAdd = canAddActivity(storedRole);

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
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Itinerary',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                    ),
                  ),
                  if (showAdd)
                    TextButton(
                      onPressed: _addActivity,
                      child: const Text('Add activity'),
                    ),
                ],
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

class _ActivityDraft {
  final String name;
  final String type;
  final DateTime start;

  const _ActivityDraft({
    required this.name,
    required this.type,
    required this.start,
  });
}

class _AddActivityDialog extends StatefulWidget {
  const _AddActivityDialog();

  @override
  State<_AddActivityDialog> createState() => _AddActivityDialogState();
}

class _AddActivityDialogState extends State<_AddActivityDialog> {
  final _nameController = TextEditingController();
  final _startController = TextEditingController();
  String _type = activityTypes.first;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _startController.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _nameController.text.trim();
    final start = parseActivityStart(_startController.text);
    if (name.isEmpty || start == null) {
      setState(() => _error = 'Enter a name and start time as YYYY-MM-DD HH:mm');
      return;
    }
    Navigator.pop(
      context,
      _ActivityDraft(name: name, type: _type, start: start),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add activity'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(labelText: 'Name'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _type,
            decoration: const InputDecoration(labelText: 'Type'),
            items: [
              for (final type in activityTypes)
                DropdownMenuItem(value: type, child: Text(type)),
            ],
            onChanged: (value) {
              if (value == null) return;
              setState(() => _type = value);
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _startController,
            decoration: const InputDecoration(
              labelText: 'Start time',
              hintText: 'YYYY-MM-DD HH:mm',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(onPressed: _submit, child: const Text('Add')),
      ],
    );
  }
}
