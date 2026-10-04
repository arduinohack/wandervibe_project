import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/activity.dart';
import '../models/plan.dart';
import '../models/plan_role_label.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import '../utils/activity_chain.dart';
import '../utils/activity_time.dart';
import 'login_screen.dart';

const activityTypes = [
  'flight',
  'train',
  'car',
  'car_service',
  'dining',
  'hotel',
  'tour',
  'attraction',
  'cruise',
  'ceremony',
  'reception',
  'custom',
];

String activityTypeLabel(String type) {
  if (type == 'car_service') return 'Car service';
  return type;
}

bool canAddActivity(String? storedRole) {
  final role = storedRole?.trim();
  return role == 'Owner' || role == 'Collaborator';
}

bool canEditPlan(String? storedRole) {
  return storedRole?.trim() == 'Owner';
}

String _twoDigits(int number) => number.toString().padLeft(2, '0');

String _utcDateLabel(DateTime? value) {
  if (value == null) return 'Choose date';
  final utc = value.toUtc();
  final year = utc.year.toString().padLeft(4, '0');
  return '$year-${_twoDigits(utc.month)}-${_twoDigits(utc.day)}';
}

String _clockLabel(DateTime? value, String suffix) {
  if (value == null) return 'Choose time';
  final utc = value.toUtc();
  final clock = '${_twoDigits(utc.hour)}:${_twoDigits(utc.minute)}';
  if (suffix.isEmpty) return clock;
  return '$clock $suffix';
}

DateTime _calendarDate(DateTime? value) {
  final utc = (value ?? DateTime.now()).toUtc();
  final date = DateTime(utc.year, utc.month, utc.day);
  final first = DateTime(2000);
  final last = DateTime(2100);
  if (date.isBefore(first)) return first;
  if (date.isAfter(last)) return last;
  return date;
}

Future<DateTime?> _pickUtcDate(BuildContext context, DateTime? current) async {
  final picked = await showDatePicker(
    context: context,
    initialDate: _calendarDate(current),
    firstDate: DateTime(2000),
    lastDate: DateTime(2100),
  );
  if (picked == null) return null;
  final clock = current?.toUtc();
  return DateTime.utc(
    picked.year,
    picked.month,
    picked.day,
    clock?.hour ?? 0,
    clock?.minute ?? 0,
  );
}

Future<DateTime?> _pickUtcTime(BuildContext context, DateTime? current) async {
  final clock = current?.toUtc();
  final picked = await showTimePicker(
    context: context,
    initialTime: TimeOfDay(hour: clock?.hour ?? 0, minute: clock?.minute ?? 0),
  );
  if (picked == null) return null;
  final day = current?.toUtc() ?? DateTime.now().toUtc();
  return DateTime.utc(day.year, day.month, day.day, picked.hour, picked.minute);
}

/// Last itinerary row that has a time. Its end, or its start when the end is empty.
DateTime? _defaultActivityStart(List<Activity> activities) {
  for (var index = activities.length - 1; index >= 0; index--) {
    final activity = activities[index];
    if (activity.endTime != null) return activity.endTime;
    if (activity.startTime != null) return activity.startTime;
  }
  return null;
}

class _ShownActivityTimes {
  final DateTime? start;
  final DateTime? end;

  const _ShownActivityTimes({this.start, this.end});
}

bool _activityIsFlight(Activity activity) {
  final label = activity.typeLabel.trim().isEmpty
      ? activity.type.name
      : activity.typeLabel.trim();
  return label.toLowerCase() == 'flight';
}

String _activityStartZone(Activity activity, String planZone) {
  final start = activity.startTimeZone.trim();
  if (start.isNotEmpty) return start;
  final origin = activity.originTimeZone?.trim() ?? '';
  if (origin.isNotEmpty) return origin;
  final zone = activity.timeZone.trim();
  if (zone.isNotEmpty) return zone;
  final plan = planZone.trim();
  if (plan.isNotEmpty) return plan;
  return 'UTC';
}

String _activityEndZone(Activity activity, String planZone) {
  final end = activity.endTimeZone.trim();
  if (end.isNotEmpty) return end;
  final destination = activity.destinationTimeZone?.trim() ?? '';
  if (destination.isNotEmpty) return destination;
  return _activityStartZone(activity, planZone);
}

/// Display times for the itinerary chain. Stored times are not rewritten.
List<_ShownActivityTimes> _shownActivityTimes(List<Activity> activities) {
  final shown = <_ShownActivityTimes>[];
  DateTime? anchor;
  for (final activity in activities) {
    final storedStart = activity.startTime;
    final storedEnd = activity.endTime;
    final minutes = activity.duration?.inMinutes;
    final DateTime? start;
    final DateTime? end;
    if (storedStart == null && minutes == null) {
      start = anchor;
      end = storedEnd ?? start;
    } else {
      start = storedStart ?? anchor;
      if (storedEnd != null) {
        end = storedEnd;
      } else if (minutes != null && start != null) {
        end = start.add(Duration(minutes: minutes));
      } else {
        end = null;
      }
    }
    shown.add(_ShownActivityTimes(start: start, end: end));
    anchor = end ?? start;
  }
  return shown;
}

String? _localDayKey(DateTime? instant, String zone) {
  if (instant == null) return null;
  final clock = clockInZone(instant, zone);
  final year = clock.year.toString().padLeft(4, '0');
  final month = clock.month.toString().padLeft(2, '0');
  final day = clock.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
}

String _durationLabel(Activity activity) {
  final minutes = activity.duration?.inMinutes;
  if (minutes != null) return '$minutes min';
  final start = activity.startTime;
  final end = activity.endTime;
  if (start != null && end != null) {
    return '${end.difference(start).inMinutes} min';
  }
  return 'not set';
}

bool _sameInstant(DateTime? left, DateTime? right) {
  if (left == null || right == null) return left == null && right == null;
  return left.toUtc().isAtSameMomentAs(right.toUtc());
}

String _activityTypeName(Activity activity) {
  final stored = activity.typeLabel.trim();
  if (stored.isNotEmpty) return stored;
  return activity.type.name;
}

Activity _activityWithTimes(Activity activity, DateTime? start, DateTime? end) {
  return Activity(
    id: activity.id,
    planId: activity.planId,
    name: activity.name,
    location: activity.location,
    type: activity.type,
    typeLabel: activity.typeLabel,
    cost: activity.cost,
    costType: activity.costType,
    startTime: start,
    duration: activity.duration,
    endTime: end,
    activityNum: activity.activityNum,
    status: activity.status,
    missingFields: activity.missingFields,
    subActivities: activity.subActivities,
    urlLinks: activity.urlLinks,
    details: activity.details,
    gate: activity.gate,
    baggageClaim: activity.baggageClaim,
    roomNumber: activity.roomNumber,
    originTimeZone: activity.originTimeZone,
    destinationTimeZone: activity.destinationTimeZone,
    timeZone: activity.timeZone,
    startTimeZone: activity.startTimeZone,
    endTimeZone: activity.endTimeZone,
    customType: activity.customType,
    serviceProvider: activity.serviceProvider,
    bookingReference: activity.bookingReference,
    extras: activity.extras,
    createdAt: activity.createdAt,
  );
}

List<String?> _dayHeaders(
  List<Activity> activities,
  List<_ShownActivityTimes> times,
  String planZone,
) {
  final headers = List<String?>.filled(activities.length, null);
  String? previousDay;
  var dayNumber = 0;
  for (var index = 0; index < activities.length; index++) {
    final activity = activities[index];
    final dayKey = _localDayKey(
      times[index].start,
      _activityStartZone(activity, planZone),
    );
    if (index == 0 || dayKey != previousDay) {
      dayNumber += 1;
      headers[index] = dayKey == null ? 'Day $dayNumber' : 'Day $dayNumber · $dayKey';
      previousDay = dayKey;
    }
  }
  return headers;
}

int? _wholeMinutes(String text) {
  final trimmed = text.trim();
  if (!RegExp(r'^\d+$').hasMatch(trimmed)) return null;
  return int.tryParse(trimmed);
}

class _UtcDateTimePicker extends StatelessWidget {
  final String label;
  final DateTime? value;
  final ValueChanged<DateTime> onChanged;
  final VoidCallback? onClear;
  final String? zone;
  final ValueChanged<String>? onZoneChanged;

  const _UtcDateTimePicker({
    required this.label,
    required this.value,
    required this.onChanged,
    this.onClear,
    this.zone,
    this.onZoneChanged,
  });

  @override
  Widget build(BuildContext context) {
    final instant = value;
    final selectedZone = zone;
    final changeZone = onZoneChanged;
    final display = selectedZone == null ? instant : wallValue(instant, selectedZone);
    final timeSuffix = selectedZone == null ? 'UTC' : '';
    final zoneAnchor = instant ?? DateTime.now().toUtc();
    final zoneChoices = selectedZone == null
        ? const <String>[]
        : activityZoneOptions(selectedZone);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton(
                onPressed: () async {
                  final next = await _pickUtcDate(context, display);
                  if (next == null || !context.mounted) return;
                  onChanged(next);
                },
                child: Text(_utcDateLabel(display)),
              ),
              OutlinedButton(
                onPressed: () async {
                  final next = await _pickUtcTime(context, display);
                  if (next == null || !context.mounted) return;
                  onChanged(next);
                },
                child: Text(_clockLabel(display, timeSuffix)),
              ),
              if (onClear != null && instant != null)
                TextButton(onPressed: onClear, child: const Text('Clear')),
            ],
          ),
          if (selectedZone != null && changeZone != null) ...[
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              key: ValueKey('$label|$selectedZone'),
              initialValue: selectedZone,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Time zone'),
              selectedItemBuilder: (context) => [
                for (final choice in zoneChoices)
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Text(
                      zoneAbbreviation(zoneAnchor, choice),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              items: [
                for (final choice in zoneChoices)
                  DropdownMenuItem(value: choice, child: Text(choice)),
              ],
              onChanged: (next) {
                if (next == null) return;
                changeZone(next);
              },
            ),
          ],
        ],
      ),
    );
  }
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
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final draft = await showDialog<_ActivityFields>(
      context: context,
      builder: (context) => _ActivityFormDialog(
        title: 'Add activity',
        actionLabel: 'Add',
        planTimeZone: _shownPlan(planProvider).timeZone,
        initialStart: _defaultActivityStart(planProvider.itineraryActivities),
      ),
    );
    if (draft == null || !mounted) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final status = await planProvider.createActivity(
      planId: widget.plan.id,
      name: draft.name,
      type: draft.type,
      startTime: draft.start!,
      endTime: draft.end!,
      timeZone: draft.timeZone,
      startTimeZone: draft.startTimeZone,
      endTimeZone: draft.endTimeZone,
      location: draft.location,
      details: draft.details,
      gate: draft.gate,
      baggageClaim: draft.baggageClaim,
      roomNumber: draft.roomNumber,
      durationMinutes: draft.durationMinutes,
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

  Plan _shownPlan(PlanProvider planProvider) {
    for (final plan in planProvider.plans) {
      if (plan.id == widget.plan.id) return plan;
    }
    return _plan;
  }

  Future<void> _openActivityEdit(Activity activity) async {
    final activityId = activity.id;
    if (activityId == null || activityId.isEmpty) return;
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final activities = planProvider.itineraryActivities;
    final index = activities.indexWhere((item) => item.id == activityId);
    DateTime? chainStart;
    if (index > 0 && activity.startTime == null) {
      chainStart = _shownActivityTimes(activities)[index].start;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => _ActivityFormDialog(
          title: 'Edit activity',
          actionLabel: 'Save',
          activity: activity,
          planId: widget.plan.id,
          planTimeZone: _shownPlan(planProvider).timeZone,
          chainStart: chainStart,
        ),
      ),
    );
  }

  bool _applyingOrder = false;

  Future<void> _reorderActivities(int oldIndex, int newIndex) async {
    if (_applyingOrder) return;
    if (oldIndex == newIndex) return;
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final ordered = List<Activity>.from(planProvider.itineraryActivities);
    if (oldIndex < 0 || oldIndex >= ordered.length || newIndex < 0 || newIndex >= ordered.length) {
      return;
    }
    final moved = ordered.removeAt(oldIndex);
    ordered.insert(newIndex, moved);
    final chained = chainActivityTimes([
      for (final activity in ordered)
        ActivityChainInput(
          start: activity.startTime,
          end: activity.endTime,
          durationMinutes: activity.duration?.inMinutes,
        ),
    ]);
    planProvider.replaceItineraryActivities([
      for (var index = 0; index < ordered.length; index++)
        _activityWithTimes(ordered[index], chained[index].start, chained[index].end),
    ]);
    _applyingOrder = true;
    final planZone = _shownPlan(planProvider).timeZone;
    try {
      for (var index = 0; index < ordered.length; index++) {
        final activity = ordered[index];
        final times = chained[index];
        if (_sameInstant(activity.startTime, times.start) &&
            _sameInstant(activity.endTime, times.end)) {
          continue;
        }
        final activityId = activity.id;
        if (activityId == null || activityId.isEmpty || times.start == null) continue;
        final startZone = _activityStartZone(activity, planZone);
        final status = await planProvider.updateActivity(
          activityId: activityId,
          name: activity.name,
          type: _activityTypeName(activity),
          startTime: times.start,
          endTime: times.end,
          timeZone: startZone,
          startTimeZone: startZone,
          endTimeZone: _activityEndZone(activity, planZone),
          location: activity.location ?? '',
          details: activity.details ?? '',
          gate: activity.gate,
          baggageClaim: activity.baggageClaim,
          roomNumber: activity.roomNumber,
          durationMinutes: activity.duration?.inMinutes,
          planId: widget.plan.id,
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
          return;
        }
      }
    } finally {
      _applyingOrder = false;
    }
  }

  Widget _activityBlock({
    required Key blockKey,
    required Activity activity,
    required _ShownActivityTimes times,
    required String? dayHeader,
    required String planZone,
    required bool canChange,
    int? dragIndex,
  }) {
    final flight = _activityIsFlight(activity);
    final type = activity.typeLabel.isEmpty ? activity.type.name : activity.typeLabel;
    final activityId = activity.id;
    final startZone = _activityStartZone(activity, planZone);
    final endZone = _activityEndZone(activity, planZone);
    return Column(
      key: blockKey,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (dayHeader != null)
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 8),
            child: Text(
              dayHeader,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
          ),
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Type: $type'),
                const SizedBox(height: 4),
                if (flight) ...[
                  Text('Departure: ${activityStartLabel(times.start, startZone)}'),
                  Text('Arrival: ${activityStartLabel(times.end, endZone)}'),
                ] else ...[
                  Text('Start: ${activityStartLabel(times.start, startZone)}'),
                  Text('End: ${activityStartLabel(times.end, endZone)}'),
                ],
                Text('Duration: ${_durationLabel(activity)}'),
                const SizedBox(height: 4),
                Row(
                  children: [
                    if (dragIndex != null)
                      ReorderableDragStartListener(
                        index: dragIndex,
                        child: const Tooltip(
                          message: 'Reorder activity',
                          child: Icon(Icons.drag_handle),
                        ),
                      ),
                    Expanded(
                      child: Text(
                        activity.name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    if (canChange && activityId != null && activityId.isNotEmpty)
                      IconButton(
                        tooltip: 'Edit activity',
                        icon: const Icon(Icons.edit),
                        onPressed: () => _openActivityEdit(activity),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _openPlanEdit(Plan plan) async {
    final removed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (context) => _PlanEditScreen(plan: plan),
      ),
    );
    if (removed == true && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final shownPlan = _shownPlan(Provider.of<PlanProvider>(context));
    return Scaffold(
      appBar: AppBar(
        title: Text(
          shownPlan.name,
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
          final shown = _shownPlan(planProvider);
          final roleText = storedRole == null
              ? null
              : planRoleLabel(shown.type, storedRole);
          final activities = planProvider.itineraryActivities;
          final canChange = canAddActivity(storedRole);
          final shownTimes = _shownActivityTimes(activities);
          final dayHeaders = _dayHeaders(activities, shownTimes, shown.timeZone);

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              shown.name,
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          if (canEditPlan(storedRole))
                            IconButton(
                              tooltip: 'Edit plan',
                              icon: const Icon(Icons.edit),
                              onPressed: () => _openPlanEdit(shown),
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text('Destination: ${shown.destination}'),
                      if (roleText != null) Text('Role: $roleText'),
                      Text('Budget: \$${shown.budget}'),
                      Text(
                        'Dates: ${formatPlanDate(shown.startDate)} - ${formatPlanDate(shown.endDate)}',
                      ),
                      Text(
                        'Time zone: ${shown.timeZone.isEmpty ? 'not set' : shown.timeZone}',
                      ),
                      Text('State: ${shown.planningState}'),
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
              else if (canChange)
                ReorderableListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  buildDefaultDragHandles: false,
                  itemCount: activities.length,
                  onReorderItem: (oldIndex, newIndex) {
                    _reorderActivities(oldIndex, newIndex);
                  },
                  itemBuilder: (context, index) {
                    final activity = activities[index];
                    final activityId = activity.id;
                    return _activityBlock(
                      blockKey: ValueKey(
                        activityId == null || activityId.isEmpty
                            ? 'activity-$index'
                            : activityId,
                      ),
                      activity: activity,
                      times: shownTimes[index],
                      dayHeader: dayHeaders[index],
                      planZone: shown.timeZone,
                      canChange: true,
                      dragIndex: index,
                    );
                  },
                )
              else
                for (var index = 0; index < activities.length; index++)
                  _activityBlock(
                    blockKey: ValueKey('guest-$index'),
                    activity: activities[index],
                    times: shownTimes[index],
                    dayHeader: dayHeaders[index],
                    planZone: shown.timeZone,
                    canChange: false,
                  ),
            ],
          );
        },
      ),
    );
  }
}

class _ActivityFields {
  final String name;
  final String type;
  final DateTime? start;
  final DateTime? end;
  final String timeZone;
  final String startTimeZone;
  final String endTimeZone;
  final String location;
  final String details;
  final String? gate;
  final String? baggageClaim;
  final String? roomNumber;
  final int? durationMinutes;

  const _ActivityFields({
    required this.name,
    required this.type,
    required this.start,
    required this.end,
    required this.timeZone,
    required this.startTimeZone,
    required this.endTimeZone,
    required this.location,
    required this.details,
    this.gate,
    this.baggageClaim,
    this.roomNumber,
    this.durationMinutes,
  });
}

String _storedActivityType(Activity? activity) {
  if (activity == null) return activityTypes.first;
  final stored = activity.typeLabel.trim().isEmpty
      ? activity.type.name
      : activity.typeLabel.trim();
  for (final type in activityTypes) {
    if (type.toLowerCase() == stored.toLowerCase()) return type;
  }
  return stored;
}

List<String> _activityTypeChoices(String selected) {
  if (activityTypes.contains(selected)) return activityTypes;
  return [selected, ...activityTypes];
}

class _ActivityFormDialog extends StatefulWidget {
  final String title;
  final String actionLabel;
  final Activity? activity;
  final String? planId;
  final String planTimeZone;
  final DateTime? initialStart;
  final DateTime? chainStart;

  const _ActivityFormDialog({
    required this.title,
    required this.actionLabel,
    this.activity,
    this.planId,
    this.planTimeZone = '',
    this.initialStart,
    this.chainStart,
  });

  bool get isScreen => activity != null;

  @override
  State<_ActivityFormDialog> createState() => _ActivityFormDialogState();
}

class _ActivityFormDialogState extends State<_ActivityFormDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _durationController;
  late final TextEditingController _locationController;
  late final TextEditingController _detailsController;
  late final TextEditingController _gateController;
  late final TextEditingController _baggageController;
  late final TextEditingController _roomController;
  late String _type;
  late String _startZone;
  late String _endZone;
  bool _endZoneCustom = false;
  DateTime? _start;
  DateTime? _end;
  bool _startChanged = false;
  bool _endChanged = false;
  String? _error;

  String _storedDurationText(Activity? activity) {
    if (activity == null) return '';
    final stored = activity.duration?.inMinutes;
    if (stored != null) return stored.toString();
    final start = activity.startTime;
    final end = activity.endTime;
    if (start == null || end == null) return '';
    return end.difference(start).inMinutes.toString();
  }

  @override
  void initState() {
    super.initState();
    final activity = widget.activity;
    _nameController = TextEditingController(text: activity?.name ?? '');
    _start = activity?.startTime ?? widget.chainStart ?? widget.initialStart;
    _end = activity?.endTime;
    if (activity != null &&
        activity.startTime == null &&
        activity.duration == null &&
        activity.endTime == null) {
      _end = widget.chainStart;
    } else if (activity != null &&
        activity.endTime == null &&
        activity.duration != null &&
        _start != null) {
      _end = _start!.add(activity.duration!);
    }
    _durationController = TextEditingController(text: _storedDurationText(activity));
    _locationController = TextEditingController(text: activity?.location ?? '');
    _detailsController = TextEditingController(text: activity?.details ?? '');
    _gateController = TextEditingController(text: activity?.gate ?? '');
    _baggageController = TextEditingController(text: activity?.baggageClaim ?? '');
    _roomController = TextEditingController(text: activity?.roomNumber ?? '');
    _type = _storedActivityType(activity);
    _startZone = _openingStartZone(activity);
    _endZone = _openingEndZone(activity, _startZone);
    _endZoneCustom = _endZone != _startZone;
  }

  String _planOrUtc() {
    final planZone = widget.planTimeZone.trim();
    if (planZone.isNotEmpty) return planZone;
    return 'UTC';
  }

  String _openingStartZone(Activity? activity) {
    if (activity != null) {
      final start = activity.startTimeZone.trim();
      if (start.isNotEmpty) return start;
      final origin = activity.originTimeZone?.trim() ?? '';
      if (origin.isNotEmpty) return origin;
      final stored = activity.timeZone.trim();
      if (stored.isNotEmpty) return stored;
    }
    return _planOrUtc();
  }

  String _openingEndZone(Activity? activity, String startZone) {
    if (activity == null) return startZone;
    final end = activity.endTimeZone.trim();
    if (end.isNotEmpty) return end;
    final destination = activity.destinationTimeZone?.trim() ?? '';
    if (destination.isNotEmpty) return destination;
    return startZone;
  }

  DateTime _instantFromWall(DateTime wall, String zone) {
    final clock = wall.toUtc();
    return instantFromWall(
      year: clock.year,
      month: clock.month,
      day: clock.day,
      hour: clock.hour,
      minute: clock.minute,
      zone: zone,
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _durationController.dispose();
    _locationController.dispose();
    _detailsController.dispose();
    _gateController.dispose();
    _baggageController.dispose();
    _roomController.dispose();
    super.dispose();
  }

  void _onStartZone(String zone) {
    if (zone == _startZone) return;
    setState(() {
      _startZone = zone;
      if (!_endZoneCustom) _endZone = zone;
      _error = null;
    });
  }

  void _onEndZone(String zone) {
    if (zone == _endZone) return;
    setState(() {
      _endZone = zone;
      _endZoneCustom = true;
      _error = null;
    });
  }

  void _setStart(DateTime wall) {
    final value = _instantFromWall(wall, _startZone);
    final minutes = _wholeMinutes(_durationController.text);
    setState(() {
      _start = value;
      _startChanged = true;
      _error = null;
      if (minutes != null) {
        _end = value.add(Duration(minutes: minutes));
        _endChanged = true;
      } else if (_end != null) {
        _durationController.text = _end!.difference(value).inMinutes.toString();
      }
    });
  }

  void _setEnd(DateTime wall) {
    final value = _instantFromWall(wall, _endZone);
    setState(() {
      _end = value;
      _endChanged = true;
      _error = null;
      final start = _start;
      if (start != null) {
        _durationController.text = value.difference(start).inMinutes.toString();
      }
    });
  }

  void _onDurationChanged(String text) {
    final minutes = _wholeMinutes(text);
    final start = _start;
    if (minutes == null || start == null) {
      setState(() => _error = null);
      return;
    }
    setState(() {
      _end = start.add(Duration(minutes: minutes));
      _endChanged = true;
      _error = null;
    });
  }

  bool get _usesFlightFields => _type == 'flight';

  bool get _usesRoom =>
      _type == 'hotel' || _type == 'ceremony' || _type == 'reception';

  _ActivityFields? _fields() {
    final name = _nameController.text.trim();
    final start = _start;
    final end = _end;
    final typedDuration = _durationController.text.trim();
    var minutes = _wholeMinutes(typedDuration);
    if (typedDuration.isNotEmpty && minutes == null) {
      setState(() => _error = 'Enter duration as whole minutes');
      return null;
    }
    if (name.isEmpty || start == null || end == null) {
      setState(() => _error = 'Enter a name, a start, and an end');
      return null;
    }
    if (end.isBefore(start)) {
      setState(() => _error = 'End time must not be before the start time');
      return null;
    }
    if (minutes == null && typedDuration.isEmpty) {
      final storedStart = widget.activity?.startTime;
      final storedEnd = widget.activity?.endTime;
      final userSetTimes = !widget.isScreen || _startChanged || _endChanged;
      if (userSetTimes || (storedStart != null && storedEnd != null)) {
        minutes = end.difference(start).inMinutes;
      }
    }
    final editing = widget.isScreen;
    return _ActivityFields(
      name: name,
      type: _type,
      start: editing && !_startChanged ? null : start,
      end: editing && !_endChanged ? null : end,
      timeZone: _startZone,
      startTimeZone: _startZone,
      endTimeZone: _endZone,
      location: _locationController.text.trim(),
      details: _detailsController.text.trim(),
      gate: _usesFlightFields ? _gateController.text.trim() : null,
      baggageClaim: _usesFlightFields ? _baggageController.text.trim() : null,
      roomNumber: _usesRoom ? _roomController.text.trim() : null,
      durationMinutes: minutes,
    );
  }

  Future<void> _endSession() async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    planProvider.clearPlans();
    await userProvider.logout();
    if (!mounted) return;
    navigator.pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => const LoginScreen()),
      (route) => false,
    );
  }

  Future<void> _submit() async {
    final fields = _fields();
    if (fields == null) return;
    if (!widget.isScreen) {
      Navigator.pop(context, fields);
      return;
    }
    final activityId = widget.activity?.id;
    if (activityId == null || activityId.isEmpty) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final messenger = ScaffoldMessenger.of(context);
    final status = await planProvider.updateActivity(
      activityId: activityId,
      name: fields.name,
      type: fields.type,
      startTime: fields.start,
      endTime: fields.end,
      timeZone: fields.timeZone,
      startTimeZone: fields.startTimeZone,
      endTimeZone: fields.endTimeZone,
      location: fields.location,
      details: fields.details,
      gate: fields.gate,
      baggageClaim: fields.baggageClaim,
      roomNumber: fields.roomNumber,
      durationMinutes: fields.durationMinutes,
      planId: widget.planId ?? widget.activity?.planId ?? '',
      token: userProvider.token,
    );
    if (!mounted) return;
    if (status == 401) {
      await _endSession();
      return;
    }
    if (status == 403) {
      messenger.showSnackBar(const SnackBar(content: Text('Not allowed')));
      return;
    }
    if (status != 200) {
      setState(() => _error = 'Could not update activity');
      return;
    }
    Navigator.pop(context);
  }

  Future<void> _delete() async {
    final activity = widget.activity;
    final activityId = activity?.id;
    if (activity == null || activityId == null || activityId.isEmpty) return;
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
    final messenger = ScaffoldMessenger.of(context);
    final status = await planProvider.deleteActivity(
      activityId: activityId,
      planId: widget.planId ?? activity.planId,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (status == 401) {
      await _endSession();
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
      return;
    }
    Navigator.pop(context);
  }

  Widget _textField(
    TextEditingController controller,
    String label, {
    String? hint,
    bool number = false,
    ValueChanged<String>? onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: TextField(
        controller: controller,
        keyboardType: number ? TextInputType.number : null,
        decoration: InputDecoration(labelText: label, hintText: hint),
        onChanged: onChanged,
      ),
    );
  }

  Widget _fieldsColumn() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
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
            for (final type in _activityTypeChoices(_type))
              DropdownMenuItem(value: type, child: Text(activityTypeLabel(type))),
          ],
          onChanged: (value) {
            if (value == null) return;
            setState(() => _type = value);
          },
        ),
        _UtcDateTimePicker(
          label: _type == 'flight' ? 'Departure' : 'Start',
          value: _start,
          zone: _startZone,
          onZoneChanged: _onStartZone,
          onChanged: _setStart,
        ),
        _UtcDateTimePicker(
          label: _type == 'flight' ? 'Arrival' : 'End',
          value: _end,
          zone: _endZone,
          onZoneChanged: _onEndZone,
          onChanged: _setEnd,
        ),
        _textField(
          _durationController,
          'Duration (minutes)',
          number: true,
          onChanged: _onDurationChanged,
        ),
        _textField(_locationController, 'Location'),
        _textField(_detailsController, 'Details'),
        if (_usesFlightFields) ...[
          _textField(_gateController, 'Gate'),
          _textField(_baggageController, 'Baggage claim'),
        ],
        if (_usesRoom) _textField(_roomController, 'Room number'),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: Colors.red)),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isScreen) {
      return Scaffold(
        appBar: AppBar(
          title: Text(widget.title),
          backgroundColor: Colors.blue,
          actions: [
            IconButton(
              tooltip: 'Delete activity',
              icon: const Icon(Icons.delete),
              onPressed: _delete,
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _fieldsColumn(),
            const SizedBox(height: 24),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _submit,
                child: Text(widget.actionLabel),
              ),
            ),
          ],
        ),
      );
    }
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(child: _fieldsColumn()),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(onPressed: _submit, child: Text(widget.actionLabel)),
      ],
    );
  }
}

class _PlanEditScreen extends StatefulWidget {
  final Plan plan;

  const _PlanEditScreen({required this.plan});

  @override
  State<_PlanEditScreen> createState() => _PlanEditScreenState();
}

class _PlanEditScreenState extends State<_PlanEditScreen> {
  late final TextEditingController _nameController;
  late final TextEditingController _destinationController;
  late final TextEditingController _timeZoneController;
  late bool _autoStart;
  late bool _autoEnd;
  DateTime? _start;
  DateTime? _end;
  String? _error;

  @override
  void initState() {
    super.initState();
    final plan = widget.plan;
    _nameController = TextEditingController(text: plan.name);
    _destinationController = TextEditingController(text: plan.destination);
    _start = plan.startDate;
    _end = plan.endDate;
    _timeZoneController = TextEditingController(text: plan.timeZone);
    _autoStart = plan.autoCalculateStartDate;
    _autoEnd = plan.autoCalculateEndDate;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _destinationController.dispose();
    _timeZoneController.dispose();
    super.dispose();
  }

  Future<void> _endSession() async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    planProvider.clearPlans();
    await userProvider.logout();
    if (!mounted) return;
    navigator.pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => const LoginScreen()),
      (route) => false,
    );
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final destination = _destinationController.text.trim();
    final timeZone = _timeZoneController.text.trim();
    final start = _start;
    final end = _end;
    if (name.isEmpty || timeZone.isEmpty) {
      setState(() => _error = 'Enter a name and a time zone');
      return;
    }
    if (widget.plan.type == 'trip' && destination.isEmpty) {
      setState(() => _error = 'Enter a destination');
      return;
    }
    if (start != null && end != null && end.isBefore(start)) {
      setState(() => _error = 'End date must not be before the start date');
      return;
    }
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final messenger = ScaffoldMessenger.of(context);
    final result = await planProvider.updatePlan(
      planId: widget.plan.id,
      name: name,
      destination: destination,
      startDate: start,
      endDate: end,
      timeZone: timeZone,
      autoCalculateStartDate: _autoStart,
      autoCalculateEndDate: _autoEnd,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (result.status == 401) {
      await _endSession();
      return;
    }
    if (result.status == 403) {
      messenger.showSnackBar(const SnackBar(content: Text('Not allowed')));
      return;
    }
    if (result.status != 200 || result.plan == null) {
      setState(() => _error = 'Could not update plan');
      return;
    }
    Navigator.pop(context);
  }

  Future<void> _delete() async {
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
    final messenger = ScaffoldMessenger.of(context);
    final result = await planProvider.deletePlan(
      planId: widget.plan.id,
      token: userProvider.token,
    );
    if (!mounted) return;
    if (result.status == 401) {
      await _endSession();
      return;
    }
    if (result.status == 403) {
      messenger.showSnackBar(const SnackBar(content: Text('Not allowed')));
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
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not delete plan')),
      );
      return;
    }
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Edit plan'),
        backgroundColor: Colors.blue,
        actions: [
          IconButton(
            tooltip: 'Delete plan',
            icon: const Icon(Icons.delete),
            onPressed: _delete,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
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
          _UtcDateTimePicker(
            label: 'Start',
            value: _start,
            onChanged: (value) => setState(() => _start = value),
            onClear: () => setState(() => _start = null),
          ),
          _UtcDateTimePicker(
            label: 'End',
            value: _end,
            onChanged: (value) => setState(() => _end = value),
            onClear: () => setState(() => _end = null),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _timeZoneController,
            decoration: const InputDecoration(labelText: 'Time zone'),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Auto-calculate start date'),
            value: _autoStart,
            onChanged: (value) => setState(() => _autoStart = value),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Auto-calculate end date'),
            value: _autoEnd,
            onChanged: (value) => setState(() => _autoEnd = value),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 24),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: _submit,
              child: const Text('Save'),
            ),
          ),
        ],
      ),
    );
  }
}
