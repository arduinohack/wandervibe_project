import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/activity.dart';
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

bool canDeletePlan(String? storedRole) {
  return storedRole?.trim() == 'Owner';
}

bool canEditPlan(String? storedRole) {
  return storedRole?.trim() == 'Owner';
}

/// UTC calendar date. Empty stays null. Anything else is not a plan date.
DateTime? parsePlanDate(String text) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) return null;
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(trimmed);
  if (match == null) return null;
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  final date = DateTime.utc(year, month, day);
  if (date.month != month || date.day != day) return null;
  return date;
}

/// UTC clock time for an activity start. Null stays "not set".
String formatActivityStart(DateTime? value) {
  if (value == null) return 'not set';
  final clock = formatActivityInput(value);
  return clock.isEmpty ? 'not set' : '$clock UTC';
}

/// UTC `YYYY-MM-DD HH:mm` for an edit field. Null stays empty.
String formatActivityInput(DateTime? value) {
  if (value == null) return '';
  final utc = value.toUtc();
  String two(int number) => number.toString().padLeft(2, '0');
  final year = utc.year.toString().padLeft(4, '0');
  return '$year-${two(utc.month)}-${two(utc.day)} ${two(utc.hour)}:${two(utc.minute)}';
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
  late Plan _plan;

  @override
  void initState() {
    super.initState();
    _plan = widget.plan;
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

  Future<void> _editActivity(Activity activity) async {
    final activityId = activity.id;
    if (activityId == null || activityId.isEmpty) return;
    final draft = await showDialog<_ActivityEdit>(
      context: context,
      builder: (context) => _EditActivityDialog(activity: activity),
    );
    if (draft == null || !mounted) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final status = await planProvider.updateActivity(
      activityId: activityId,
      name: draft.name,
      type: draft.type,
      startTime: draft.start,
      endTime: draft.end,
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
    if (status != 200) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update activity')),
      );
    }
  }

  Future<void> _deleteActivity(Activity activity) async {
    final activityId = activity.id;
    if (activityId == null || activityId.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete activity'),
        content: Text('Delete ${activity.name}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final status = await planProvider.deleteActivity(
      activityId: activityId,
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
    if (status != 200) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not delete activity')),
      );
    }
  }

  Future<void> _editPlan() async {
    final draft = await showDialog<_PlanEdit>(
      context: context,
      builder: (context) => _EditPlanDialog(plan: _plan),
    );
    if (draft == null || !mounted) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final result = await planProvider.updatePlan(
      planId: _plan.id,
      name: draft.name,
      destination: draft.destination,
      startDate: draft.startDate,
      endDate: draft.endDate,
      timeZone: draft.timeZone,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (result.status == 401) {
      await _endSession(userProvider, planProvider, navigator);
      return;
    }
    if (result.status == 403) {
      messenger.showSnackBar(const SnackBar(content: Text('Not allowed')));
      return;
    }
    final updated = result.plan;
    if (result.status != 200 || updated == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update plan')),
      );
      return;
    }
    setState(() => _plan = updated);
  }

  Future<void> _deletePlan() async {
    final planId = widget.plan.id;
    if (planId.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete plan'),
        content: Text('Delete ${widget.plan.name}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final result = await planProvider.deletePlan(
      planId: planId,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (result.status == 401) {
      await _endSession(userProvider, planProvider, navigator);
      return;
    }
    if (result.status == 403) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Not allowed')),
      );
      return;
    }
    if (result.status == 409) {
      final shared = result.sharedWith;
      final detail = shared.isEmpty
          ? 'This plan is still shared with someone else.'
          : 'This plan is still shared with:\n${shared.join('\n')}';
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Plan is still shared'),
          content: Text(detail),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      return;
    }
    if (result.status != 200) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not delete plan')),
      );
      return;
    }
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _plan.name,
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
              : planRoleLabel(_plan.type, storedRole);
          final activities = planProvider.itineraryActivities;
          final canChange = canAddActivity(storedRole);

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
                        _plan.name,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text('Destination: ${_plan.destination}'),
                      if (roleText != null) Text('Role: $roleText'),
                      Text('Budget: \$${_plan.budget}'),
                      Text(
                        'Dates: ${formatPlanDate(_plan.startDate)} - ${formatPlanDate(_plan.endDate)}',
                      ),
                      Text(
                        'Time zone: ${_plan.timeZone.isEmpty ? 'not set' : _plan.timeZone}',
                      ),
                      Text('State: ${_plan.planningState}'),
                      if (canEditPlan(storedRole)) ...[
                        const SizedBox(height: 12),
                        TextButton(
                          onPressed: _editPlan,
                          child: const Text('Edit plan'),
                        ),
                      ],
                      if (canDeletePlan(storedRole)) ...[
                        const SizedBox(height: 12),
                        TextButton(
                          onPressed: _deletePlan,
                          child: const Text('Delete plan'),
                        ),
                      ],
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
                  if (canChange)
                    TextButton(
                      onPressed: _addActivity,
                      child: const Text('Add activity'),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              if (activities.isEmpty)
                const Center(
                  child: Text(
                    'No activities yet',
                    style: TextStyle(fontSize: 20),
                    textAlign: TextAlign.center,
                  ),
                )
              else
                ...activities.map((activity) {
                  final type = activity.typeLabel.isEmpty
                      ? activity.type.name
                      : activity.typeLabel;
                  final activityId = activity.id;
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            activity.name,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Type: $type\nStart: ${formatActivityStart(activity.startTime)}',
                          ),
                          if (canChange && activityId != null && activityId.isNotEmpty)
                            Row(
                              children: [
                                TextButton(
                                  onPressed: () => _editActivity(activity),
                                  child: const Text('Edit'),
                                ),
                                TextButton(
                                  onPressed: () => _deleteActivity(activity),
                                  child: const Text('Delete'),
                                ),
                              ],
                            ),
                        ],
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

class _ActivityEdit {
  final String name;
  final String type;
  final DateTime start;
  final DateTime end;

  const _ActivityEdit({
    required this.name,
    required this.type,
    required this.start,
    required this.end,
  });
}

class _EditActivityDialog extends StatefulWidget {
  final Activity activity;

  const _EditActivityDialog({required this.activity});

  @override
  State<_EditActivityDialog> createState() => _EditActivityDialogState();
}

class _EditActivityDialogState extends State<_EditActivityDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _startController;
  late final TextEditingController _endController;
  late String _type;
  String? _error;

  @override
  void initState() {
    super.initState();
    final activity = widget.activity;
    _nameController = TextEditingController(text: activity.name);
    _startController = TextEditingController(
      text: formatActivityInput(activity.startTime),
    );
    _endController = TextEditingController(
      text: formatActivityInput(activity.endTime),
    );
    final storedType = activity.typeLabel.isEmpty
        ? activity.type.name
        : activity.typeLabel;
    _type = activityTypes.contains(storedType) ? storedType : activityTypes.first;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _startController.dispose();
    _endController.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _nameController.text.trim();
    final start = parseActivityStart(_startController.text);
    final end = parseActivityStart(_endController.text);
    if (name.isEmpty || start == null || end == null) {
      setState(
        () => _error = 'Enter a name, start time, and end time as YYYY-MM-DD HH:mm',
      );
      return;
    }
    if (end.isBefore(start)) {
      setState(() => _error = 'End time must not be before the start time');
      return;
    }
    Navigator.pop(
      context,
      _ActivityEdit(name: name, type: _type, start: start, end: end),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit activity'),
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
          const SizedBox(height: 12),
          TextField(
            controller: _endController,
            decoration: const InputDecoration(
              labelText: 'End time',
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
        TextButton(onPressed: _submit, child: const Text('Save')),
      ],
    );
  }
}

class _PlanEdit {
  final String name;
  final String destination;
  final DateTime? startDate;
  final DateTime? endDate;
  final String timeZone;

  const _PlanEdit({
    required this.name,
    required this.destination,
    required this.startDate,
    required this.endDate,
    required this.timeZone,
  });
}

class _EditPlanDialog extends StatefulWidget {
  final Plan plan;

  const _EditPlanDialog({required this.plan});

  @override
  State<_EditPlanDialog> createState() => _EditPlanDialogState();
}

class _EditPlanDialogState extends State<_EditPlanDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _destinationController;
  late final TextEditingController _startController;
  late final TextEditingController _endController;
  late final TextEditingController _timeZoneController;
  String? _error;

  @override
  void initState() {
    super.initState();
    final plan = widget.plan;
    _nameController = TextEditingController(text: plan.name);
    _destinationController = TextEditingController(text: plan.destination);
    _startController = TextEditingController(
      text: plan.startDate == null ? '' : formatPlanDate(plan.startDate),
    );
    _endController = TextEditingController(
      text: plan.endDate == null ? '' : formatPlanDate(plan.endDate),
    );
    _timeZoneController = TextEditingController(text: plan.timeZone);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _destinationController.dispose();
    _startController.dispose();
    _endController.dispose();
    _timeZoneController.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _nameController.text.trim();
    final destination = _destinationController.text.trim();
    final timeZone = _timeZoneController.text.trim();
    final startText = _startController.text.trim();
    final endText = _endController.text.trim();
    final start = parsePlanDate(startText);
    final end = parsePlanDate(endText);
    if (name.isEmpty || timeZone.isEmpty) {
      setState(() => _error = 'Enter a name and a time zone');
      return;
    }
    if (widget.plan.type == 'trip' && destination.isEmpty) {
      setState(() => _error = 'Enter a destination');
      return;
    }
    if ((startText.isNotEmpty && start == null) ||
        (endText.isNotEmpty && end == null)) {
      setState(() => _error = 'Enter dates as YYYY-MM-DD');
      return;
    }
    if (start != null && end != null && end.isBefore(start)) {
      setState(() => _error = 'End date must not be before the start date');
      return;
    }
    Navigator.pop(
      context,
      _PlanEdit(
        name: name,
        destination: destination,
        startDate: start,
        endDate: end,
        timeZone: timeZone,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit plan'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _destinationController,
              decoration: const InputDecoration(labelText: 'Destination'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _startController,
              decoration: const InputDecoration(
                labelText: 'Start date',
                hintText: 'YYYY-MM-DD',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _endController,
              decoration: const InputDecoration(
                labelText: 'End date',
                hintText: 'YYYY-MM-DD',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _timeZoneController,
              decoration: const InputDecoration(labelText: 'Time zone'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(onPressed: _submit, child: const Text('Save')),
      ],
    );
  }
}
