import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/activity.dart';
import '../models/plan.dart';
import '../models/plan_role_label.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import '../utils/activity_chain.dart';
import '../utils/activity_time.dart';
import '../utils/plan_pdf.dart';
import 'login_screen.dart';
import 'plan_people_screen.dart';

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
  'activity',
];

const _activityTypeLabels = {
  'flight': 'Flight',
  'train': 'Train',
  'car': 'Drive',
  'car_service': 'Car Service',
  'dining': 'Dining',
  'hotel': 'Hotel',
  'tour': 'Tour',
  'attraction': 'Attraction',
  'cruise': 'Cruise',
  'ceremony': 'Ceremony',
  'reception': 'Reception',
  'custom': 'Custom',
  'activity': 'Activity',
};

String activityTypeLabel(String type) {
  final known = _activityTypeLabels[type.trim().toLowerCase()];
  if (known != null) return known;
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

String _pdfClock(DateTime? instant, String zone) {
  if (instant == null) return 'not set';
  final abbreviation = zoneAbbreviation(instant, zone).trim();
  final clock = itineraryClockLabel(instant, zone);
  if (abbreviation.isEmpty) return clock;
  return '$clock $abbreviation';
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

String _detailsLabel(Activity activity) {
  final details = activity.details?.trim() ?? '';
  if (details.isEmpty) return 'not set';
  return details;
}

String? _cardStatusLabel(String? status) {
  final text = status?.trim() ?? '';
  if (text.isEmpty) return null;
  switch (text.toLowerCase()) {
    case 'draft':
      return 'Draft';
    case 'complete':
      return 'Complete';
    default:
      return text;
  }
}

String? _cardDurationLabel(Activity activity) {
  final minutes = activity.duration?.inMinutes;
  if (minutes != null) return '$minutes min';
  final start = activity.startTime;
  final end = activity.endTime;
  if (start != null && end != null) {
    return '${end.difference(start).inMinutes} min';
  }
  return null;
}

Widget _cardLine(String label, String value) {
  return Text.rich(
    TextSpan(
      children: [
        TextSpan(
          text: '$label: ',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        TextSpan(text: value),
      ],
    ),
  );
}

void _addCardLine(List<Widget> lines, String label, String? value) {
  final text = value?.trim() ?? '';
  if (text.isEmpty || text == 'not set') return;
  lines.add(_cardLine(label, text));
}

List<Widget> _activityCardLines(
  Activity activity,
  _ShownActivityTimes times,
  String planZone,
) {
  final lines = <Widget>[];
  final storedType = activity.typeLabel.trim().isEmpty
      ? activity.type.name
      : activity.typeLabel.trim();
  _addCardLine(lines, 'Type', activityTypeLabel(storedType));
  if (times.start != null) {
    _addCardLine(
      lines,
      'Start',
      _pdfClock(times.start, _activityStartZone(activity, planZone)),
    );
  }
  if (times.end != null) {
    _addCardLine(
      lines,
      'End',
      _pdfClock(times.end, _activityEndZone(activity, planZone)),
    );
  }
  _addCardLine(lines, 'Duration', _cardDurationLabel(activity));
  _addCardLine(lines, 'Location', activity.location);
  _addCardLine(lines, 'Details', activity.details);
  _addCardLine(lines, 'Google Place ID', activity.googlePlaceId);
  _addCardLine(lines, 'Booking reference', activity.bookingReference);
  final cost = activity.cost;
  if (cost != null) {
    final mark = activity.costType == CostType.actual ? 'act' : 'est';
    _addCardLine(lines, 'Cost($mark)', formatPlanMoney(cost));
  }
  _addCardLine(lines, 'Gate', activity.gate);
  _addCardLine(lines, 'Baggage claim', activity.baggageClaim);
  _addCardLine(lines, 'Room number', activity.roomNumber);
  _addCardLine(lines, 'Service provider', activity.serviceProvider);
  _addCardLine(lines, 'Status', _cardStatusLabel(activity.status));
  _addCardLine(lines, 'Custom type', activity.customType);
  for (final link in activity.urlLinks) {
    final url = link.linkUrl.trim();
    if (url.isEmpty) continue;
    final name = link.linkName.trim();
    _addCardLine(lines, 'Link', name.isEmpty ? url : '$name ($url)');
  }
  return lines;
}

/// Driving directions when the activity has a stored Google Place ID.
Uri? _activityDirectionsUri(Activity activity) {
  final placeId = activity.googlePlaceId.trim();
  if (placeId.isEmpty) return null;
  final location = activity.location?.trim() ?? '';
  final name = activity.name.trim();
  final destination = location.isNotEmpty
      ? location
      : name.isNotEmpty
          ? name
          : placeId;
  return Uri.https('www.google.com', '/maps/dir/', {
    'api': '1',
    'destination': destination,
    'destination_place_id': placeId,
    'travelmode': 'driving',
  });
}

class _PlusArrowIcon extends StatelessWidget {
  final bool up;

  const _PlusArrowIcon({required this.up});

  @override
  Widget build(BuildContext context) {
    final color = IconTheme.of(context).color;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.add, size: 18, color: color),
        Icon(
          up ? Icons.arrow_upward : Icons.arrow_downward,
          size: 18,
          color: color,
        ),
      ],
    );
  }
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
    googlePlaceId: activity.googlePlaceId,
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

  DateTime? _insertAnchorAbove(int index, Activity selected) {
    if (index <= 0) return selected.startTime;
    final activities =
        Provider.of<PlanProvider>(context, listen: false).itineraryActivities;
    if (index > activities.length) return null;
    final above = activities[index - 1];
    return above.endTime ?? above.startTime;
  }

  Future<void> _addActivity({
    String? insertAfter,
    String? insertBefore,
    int? insertIndex,
    DateTime? initialStart,
    DateTime? initialEnd,
    String? initialZone,
    bool useDefaultStart = true,
    bool shiftFollowing = false,
  }) async {
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final openingStart = useDefaultStart
        ? _defaultActivityStart(planProvider.itineraryActivities)
        : initialStart;
    final openingEnd = useDefaultStart ? null : (initialEnd ?? initialStart);
    final draft = await showDialog<_ActivityFields>(
      context: context,
      builder: (context) => _ActivityFormDialog(
        title: 'Add activity',
        actionLabel: 'Add',
        planTimeZone: _shownPlan(planProvider).timeZone,
        initialStart: openingStart,
        initialEnd: openingEnd,
        initialZone: initialZone,
      ),
    );
    if (draft == null || !mounted) return;
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final snapshot = List<Activity>.from(planProvider.itineraryActivities);
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
      googlePlaceId: draft.googlePlaceId,
      details: draft.details,
      bookingReference: draft.bookingReference,
      cost: draft.cost,
      costType: draft.costType,
      gate: draft.gate,
      baggageClaim: draft.baggageClaim,
      roomNumber: draft.roomNumber,
      durationMinutes: draft.durationMinutes,
      insertAfter: insertAfter,
      insertBefore: insertBefore,
      insertIndex: insertIndex,
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
      return;
    }
    if (!shiftFollowing || insertIndex == null) return;
    final chainStart = draft.start;
    final chainEnd = draft.end;
    if (chainStart == null || chainEnd == null) return;
    // The inserted start is the end from before a duration was set.
    final added = chainEnd.difference(chainStart);
    if (added <= Duration.zero) return;
    if (insertIndex < 0 || insertIndex > snapshot.length) return;
    await _shiftBackToBackChain(
      following: snapshot.sublist(insertIndex),
      anchor: chainStart,
      added: added,
      planProvider: planProvider,
      userProvider: userProvider,
      messenger: messenger,
      navigator: navigator,
    );
  }

  Future<void> _shiftBackToBackChain({
    required List<Activity> following,
    required DateTime anchor,
    required Duration added,
    required PlanProvider planProvider,
    required UserProvider userProvider,
    required ScaffoldMessengerState messenger,
    required NavigatorState navigator,
  }) async {
    final indexes = backToBackChainIndexes(
      following: [
        for (final activity in following)
          ActivityChainTime(start: activity.startTime, end: activity.endTime),
      ],
      anchor: anchor,
    );
    final planZone = _shownPlan(planProvider).timeZone;
    for (final index in indexes) {
      final activity = following[index];
      final activityId = activity.id;
      final start = activity.startTime;
      if (activityId == null || activityId.isEmpty || start == null) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Could not update activity')),
        );
        return;
      }
      final status = await planProvider.updateActivity(
        activityId: activityId,
        name: activity.name,
        type: _activityTypeName(activity),
        startTime: start.add(added),
        endTime: activity.endTime?.add(added),
        timeZone: _activityStartZone(activity, planZone),
        startTimeZone: _activityStartZone(activity, planZone),
        endTimeZone: _activityEndZone(activity, planZone),
        location: activity.location ?? '',
        googlePlaceId: activity.googlePlaceId,
        details: activity.details ?? '',
        bookingReference: (activity.bookingReference ?? '').trim(),
        cost: activity.cost,
        costType: _storedCostType(activity),
        gate: activity.gate,
        baggageClaim: activity.baggageClaim,
        roomNumber: activity.roomNumber,
        durationMinutes: activity.duration?.inMinutes,
        writeStartTime: true,
        writeEndTime: activity.endTime != null,
        writeDuration: activity.duration != null,
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
    if (newIndex == 0) return;
    final moved = ordered.removeAt(oldIndex);
    ordered.insert(newIndex, moved);
    final target = ordered[newIndex - 1];
    final times = timesAfterTarget(
      targetStart: target.startTime,
      targetEnd: target.endTime,
      durationMinutes: moved.duration?.inMinutes,
    );
    if (times == null || times.start == null) return;
    if (_sameInstant(moved.startTime, times.start) &&
        _sameInstant(moved.endTime, times.end)) {
      return;
    }
    final activityId = moved.id;
    if (activityId == null || activityId.isEmpty) return;
    planProvider.replaceItineraryActivities([
      for (var index = 0; index < ordered.length; index++)
        if (index == newIndex)
          _activityWithTimes(moved, times.start, times.end)
        else
          ordered[index],
    ]);
    _applyingOrder = true;
    final planZone = _shownPlan(planProvider).timeZone;
    try {
      final status = await planProvider.updateActivity(
        activityId: activityId,
        name: moved.name,
        type: _activityTypeName(moved),
        startTime: times.start,
        endTime: times.end,
        timeZone: _activityStartZone(moved, planZone),
        startTimeZone: _activityStartZone(moved, planZone),
        endTimeZone: _activityEndZone(moved, planZone),
        location: moved.location ?? '',
        googlePlaceId: moved.googlePlaceId,
        details: moved.details ?? '',
        bookingReference: (moved.bookingReference ?? '').trim(),
        cost: moved.cost,
        costType: _storedCostType(moved),
        gate: moved.gate,
        baggageClaim: moved.baggageClaim,
        roomNumber: moved.roomNumber,
        durationMinutes: moved.duration?.inMinutes,
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
      }
    } finally {
      _applyingOrder = false;
    }
  }

  Future<void> _printPlan(Plan plan) async {
    final options = await showDialog<_PrintPlanOptions>(
      context: context,
      builder: (context) => const _PrintOrientationDialog(),
    );
    if (options == null || !mounted) return;
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final activities = planProvider.itineraryActivities;
    var progressShown = false;
    if (options.includeMaps) {
      progressShown = true;
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (context) => const Center(child: CircularProgressIndicator()),
      );
    }
    try {
      final mapsByPlace = <String, Uint8List>{};
      if (options.includeMaps) {
        for (final activity in activities) {
          final placeId = activity.googlePlaceId.trim();
          if (placeId.isEmpty || mapsByPlace.containsKey(placeId)) continue;
          final result = await planProvider.fetchPlanPlaceMap(
            planId: plan.id,
            placeId: placeId,
            token: userProvider.token,
          );
          if (!mounted) return;
          if (result.status == 401) {
            if (progressShown) navigator.pop();
            await _endSession(userProvider, planProvider, navigator);
            return;
          }
          final image = result.bytes;
          if (image != null && image.isNotEmpty) {
            mapsByPlace[placeId] = image;
          }
        }
      }
      final shownTimes = _shownActivityTimes(activities);
      final dayHeaders = _dayHeaders(activities, shownTimes, plan.timeZone);
      final rows = <PlanPdfRow>[
        for (var index = 0; index < activities.length; index++)
          _pdfActivityRow(
            activities[index],
            shownTimes[index],
            dayHeaders[index],
            plan.timeZone,
            mapImage: mapsByPlace[activities[index].googlePlaceId.trim()],
          ),
      ];
      final bytes = await buildPlanPdf(
        name: plan.name,
        destination: plan.destination,
        start: formatPlanDate(plan.startDate),
        end: formatPlanDate(plan.endDate),
        rows: rows,
        landscape: options.landscape,
      );
      if (progressShown && mounted) navigator.pop();
      progressShown = false;
      await Printing.sharePdf(
        bytes: bytes,
        filename: planPdfFilename(plan.name),
      );
    } catch (_) {
      if (progressShown && mounted) navigator.pop();
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not print plan')),
      );
    }
  }

  Future<void> _resortByStartTime() async {
    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final status = await planProvider.resortItineraryByStartTime(
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
        const SnackBar(content: Text('Could not re-sort activities')),
      );
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
    final activityId = activity.id;
    final startZone = _activityStartZone(activity, planZone);
    final endZone = _activityEndZone(activity, planZone);
    final lines = _activityCardLines(activity, times, planZone);
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
                        activity.name.trim(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    if (_activityDirectionsUri(activity) != null)
                      IconButton(
                        tooltip: 'Directions',
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.map),
                        onPressed: () => _openDirections(activity),
                      ),
                    if (canChange &&
                        dragIndex != null &&
                        activityId != null &&
                        activityId.isNotEmpty) ...[
                      IconButton(
                        tooltip: 'Insert above',
                        visualDensity: VisualDensity.compact,
                        icon: const _PlusArrowIcon(up: true),
                        onPressed: () {
                          final anchor = _insertAnchorAbove(dragIndex, activity);
                          _addActivity(
                            insertBefore: activityId,
                            insertIndex: dragIndex,
                            initialStart: anchor,
                            initialEnd: anchor,
                            initialZone: startZone,
                            useDefaultStart: false,
                            shiftFollowing: anchor != null,
                          );
                        },
                      ),
                      IconButton(
                        tooltip: 'Insert below',
                        visualDensity: VisualDensity.compact,
                        icon: const _PlusArrowIcon(up: false),
                        onPressed: () {
                          final anchor = activity.endTime ?? activity.startTime;
                          _addActivity(
                            insertAfter: activityId,
                            insertIndex: dragIndex + 1,
                            initialStart: anchor,
                            initialEnd: anchor,
                            initialZone: endZone,
                            useDefaultStart: false,
                            shiftFollowing: anchor != null,
                          );
                        },
                      ),
                      IconButton(
                        tooltip: 'Edit activity',
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.edit),
                        onPressed: () => _openActivityEdit(activity),
                      ),
                    ],
                  ],
                ),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: lines,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _openDirections(Activity activity) async {
    final uri = _activityDirectionsUri(activity);
    if (uri == null) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Could not open directions')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not open directions')),
      );
    }
  }

  Future<void> _openPlanEdit(Plan plan) async {
    final removed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (context) => _PlanEditScreen(plan: plan),
      ),
    );
    if (removed == true && mounted) Navigator.of(context).pop();
  }

  Future<void> _openPeople(Plan plan) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => PlanPeopleScreen(plan: plan),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final planProvider = Provider.of<PlanProvider>(context);
    final shownPlan = _shownPlan(planProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(
          shownPlan.name,
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
        backgroundColor: Colors.blue,
        actions: [
          TextButton(
            onPressed: () => _openPeople(shownPlan),
            child: const Text(
              'People',
              style: TextStyle(color: Colors.white),
            ),
          ),
        ],
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
          final dateLine = planHeaderDateLine(
            activities,
            planTimeZone: shown.timeZone,
          );

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
                          TextButton(
                            onPressed: () => _printPlan(shown),
                            child: const Text('Print'),
                          ),
                          if (canChange)
                            TextButton(
                              onPressed: _resortByStartTime,
                              child: const Text('Re-sort'),
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
                      Text('Budget: ${formatPlanMoney(shown.budget)}'),
                      Text(
                        'Activity costs: ${formatPlanMoney(_planActualCost(activities))}',
                      ),
                      if (dateLine != null) Text(dateLine),
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
                      onPressed: () => _addActivity(),
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

String _pdfCostCell(Activity activity) {
  final cost = activity.cost;
  if (cost == null) return '';
  final money = formatPlanMoney(cost);
  // A missing cost is stored as 0, which formats as $0.00.
  if (money == formatPlanMoney(0)) return '';
  final mark = activity.costType == CostType.actual ? 'act' : 'est';
  return 'Cost($mark):\n$money';
}

PlanPdfRow _pdfActivityRow(
  Activity activity,
  _ShownActivityTimes times,
  String? dayHeader,
  String planZone, {
  Uint8List? mapImage,
}) {
  final storedType = activity.typeLabel.trim().isEmpty
      ? activity.type.name
      : activity.typeLabel.trim();
  return PlanPdfRow(
    dayHeader: dayHeader,
    type: activityTypeLabel(storedType),
    name: activity.name.trim(),
    start: _pdfClock(times.start, _activityStartZone(activity, planZone)),
    end: _pdfClock(times.end, _activityEndZone(activity, planZone)),
    duration: _durationLabel(activity),
    location: activity.location?.trim() ?? '',
    details: _detailsLabel(activity),
    bookingReference: activity.bookingReference?.trim() ?? '',
    cost: _pdfCostCell(activity),
    gate: activity.gate?.trim() ?? '',
    baggageClaim: activity.baggageClaim?.trim() ?? '',
    roomNumber: activity.roomNumber?.trim() ?? '',
    serviceProvider: activity.serviceProvider?.trim() ?? '',
    googlePlaceId: activity.googlePlaceId,
    mapImage: mapImage,
  );
}

String formatPlanMoney(num amount) {
  return NumberFormat.currency(
    locale: 'en_US',
    symbol: r'$',
    decimalDigits: 2,
  ).format(amount);
}

double _planActualCost(List<Activity> activities) {
  var total = 0.0;
  for (final activity in activities) {
    final cost = activity.cost;
    if (cost != null) total += cost;
  }
  return total;
}

String _costBoxText(double? cost) {
  if (cost == null) return '';
  if (cost == cost.roundToDouble()) return cost.round().toString();
  return cost.toString();
}

String _storedCostType(Activity? activity) {
  if (activity?.costType == CostType.actual) return 'actual';
  return 'estimated';
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
  final String googlePlaceId;
  final String details;
  final String bookingReference;
  final double? cost;
  final String costType;
  final String? gate;
  final String? baggageClaim;
  final String? roomNumber;
  final int? durationMinutes;
  final bool writeStart;
  final bool writeEnd;
  final bool writeDuration;

  const _ActivityFields({
    required this.name,
    required this.type,
    required this.start,
    required this.end,
    required this.timeZone,
    required this.startTimeZone,
    required this.endTimeZone,
    required this.location,
    required this.googlePlaceId,
    required this.details,
    required this.bookingReference,
    required this.cost,
    required this.costType,
    this.gate,
    this.baggageClaim,
    this.roomNumber,
    this.durationMinutes,
    this.writeStart = false,
    this.writeEnd = false,
    this.writeDuration = false,
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
  final DateTime? initialEnd;
  final DateTime? chainStart;
  final String? initialZone;

  const _ActivityFormDialog({
    required this.title,
    required this.actionLabel,
    this.activity,
    this.planId,
    this.planTimeZone = '',
    this.initialStart,
    this.initialEnd,
    this.chainStart,
    this.initialZone,
  });

  bool get isScreen => activity != null;

  @override
  State<_ActivityFormDialog> createState() => _ActivityFormDialogState();
}

class _ActivityFormDialogState extends State<_ActivityFormDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _durationController;
  late final TextEditingController _locationController;
  late final TextEditingController _googlePlaceIdController;
  late final TextEditingController _detailsController;
  late final TextEditingController _bookingReferenceController;
  late final TextEditingController _costController;
  late String _costType;
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
    } else if (activity == null) {
      _end = widget.initialEnd;
    }
    _durationController = TextEditingController(text: _storedDurationText(activity));
    _locationController = TextEditingController(text: activity?.location ?? '');
    _googlePlaceIdController = TextEditingController(
      text: activity?.googlePlaceId ?? '',
    );
    _detailsController = TextEditingController(text: activity?.details ?? '');
    _bookingReferenceController = TextEditingController(
      text: (activity?.bookingReference ?? '').trim(),
    );
    _costController = TextEditingController(text: _costBoxText(activity?.cost));
    _costType = _storedCostType(activity);
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
    final copied = widget.initialZone?.trim() ?? '';
    if (copied.isNotEmpty) return copied;
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
    _googlePlaceIdController.dispose();
    _detailsController.dispose();
    _bookingReferenceController.dispose();
    _costController.dispose();
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

  void _clearStart() {
    setState(() {
      _start = null;
      _startChanged = true;
      _error = null;
    });
  }

  void _clearEnd() {
    setState(() {
      _end = null;
      _endChanged = true;
      _durationController.clear();
      _error = null;
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
    final editing = widget.isScreen;
    if (name.isEmpty || (!editing && (start == null || end == null))) {
      setState(() => _error = 'Enter a name, a start, and an end');
      return null;
    }
    if (start != null && end != null && end.isBefore(start)) {
      setState(() => _error = 'End time must not be before the start time');
      return null;
    }
    final costText = _costController.text.trim();
    double? cost;
    if (costText.isNotEmpty) {
      cost = double.tryParse(costText);
      if (cost == null) {
        setState(() => _error = 'Enter cost as a number');
        return null;
      }
      if (cost < 0) {
        setState(() => _error = 'Cost cannot be negative');
        return null;
      }
    }
    if (minutes == null && typedDuration.isEmpty && start != null && end != null) {
      final storedStart = widget.activity?.startTime;
      final storedEnd = widget.activity?.endTime;
      final userSetTimes = !editing || _startChanged || _endChanged;
      if (userSetTimes || (storedStart != null && storedEnd != null)) {
        minutes = end.difference(start).inMinutes;
      }
    }
    var writeDuration = minutes != null;
    if (editing && _endChanged && end == null) {
      minutes = null;
      writeDuration = true;
    }
    return _ActivityFields(
      name: name,
      type: _type,
      start: editing && !_startChanged ? null : start,
      end: editing && !_endChanged ? null : end,
      timeZone: _startZone,
      startTimeZone: _startZone,
      endTimeZone: _endZone,
      location: _locationController.text.trim(),
      googlePlaceId: _googlePlaceIdController.text.trim(),
      details: _detailsController.text.trim(),
      bookingReference: _bookingReferenceController.text.trim(),
      cost: cost,
      costType: _costType,
      gate: _usesFlightFields ? _gateController.text.trim() : null,
      baggageClaim: _usesFlightFields ? _baggageController.text.trim() : null,
      roomNumber: _usesRoom ? _roomController.text.trim() : null,
      durationMinutes: minutes,
      writeStart: !editing || _startChanged,
      writeEnd: !editing || _endChanged,
      writeDuration: writeDuration,
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
      googlePlaceId: fields.googlePlaceId,
      details: fields.details,
      bookingReference: fields.bookingReference,
      cost: fields.cost,
      costType: fields.costType,
      gate: fields.gate,
      baggageClaim: fields.baggageClaim,
      roomNumber: fields.roomNumber,
      durationMinutes: fields.durationMinutes,
      writeStartTime: fields.writeStart,
      writeEndTime: fields.writeEnd,
      writeDuration: fields.writeDuration,
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
    bool decimal = false,
    ValueChanged<String>? onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: TextField(
        controller: controller,
        keyboardType: decimal
            ? const TextInputType.numberWithOptions(decimal: true)
            : number
            ? TextInputType.number
            : null,
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
          onClear: widget.isScreen ? _clearStart : null,
        ),
        _UtcDateTimePicker(
          label: _type == 'flight' ? 'Arrival' : 'End',
          value: _end,
          zone: _endZone,
          onZoneChanged: _onEndZone,
          onChanged: _setEnd,
          onClear: widget.isScreen ? _clearEnd : null,
        ),
        _textField(
          _durationController,
          'Duration (minutes)',
          number: true,
          onChanged: _onDurationChanged,
        ),
        _textField(_locationController, 'Location'),
        _textField(_googlePlaceIdController, 'Google Place ID'),
        _textField(_detailsController, 'Details'),
        _textField(_bookingReferenceController, 'Booking reference'),
        _textField(_costController, 'Cost', decimal: true),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: const [
            ButtonSegment(value: 'estimated', label: Text('Estimated')),
            ButtonSegment(value: 'actual', label: Text('Actual')),
          ],
          selected: {_costType},
          onSelectionChanged: (next) {
            setState(() => _costType = next.first);
          },
        ),
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
              tooltip: 'Save',
              icon: const Icon(Icons.save),
              onPressed: _submit,
            ),
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

class _PrintPlanOptions {
  final bool landscape;
  final bool includeMaps;

  const _PrintPlanOptions({
    required this.landscape,
    required this.includeMaps,
  });
}

class _PrintOrientationDialog extends StatefulWidget {
  const _PrintOrientationDialog();

  @override
  State<_PrintOrientationDialog> createState() =>
      _PrintOrientationDialogState();
}

class _PrintOrientationDialogState extends State<_PrintOrientationDialog> {
  bool _landscape = true;
  bool _includeMaps = false;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Print'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SegmentedButton<bool>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: false, label: Text('Portrait')),
              ButtonSegment(value: true, label: Text('Landscape')),
            ],
            selected: {_landscape},
            onSelectionChanged: (next) {
              setState(() => _landscape = next.first);
            },
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _includeMaps,
            onChanged: (next) {
              setState(() => _includeMaps = next ?? false);
            },
            title: const Text('Include maps'),
            subtitle: const Text(
              'A Google Map around each destination that has a Place ID',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(
            context,
            _PrintPlanOptions(
              landscape: _landscape,
              includeMaps: _includeMaps,
            ),
          ),
          child: const Text('Print'),
        ),
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
