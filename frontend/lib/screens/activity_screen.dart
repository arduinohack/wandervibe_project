import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/activity.dart';
import '../models/activity_type.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import '../utils/logger.dart';

String _costBoxText(double? cost) {
  if (cost == null) return '';
  return cost == cost.roundToDouble() ? cost.round().toString() : cost.toString();
}

double? _parsedCost(String text) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) return null;
  return double.tryParse(trimmed);
}

// ActivityScreen widget for adding or editing activities
class ActivityScreen extends StatefulWidget {
  final String planId; // Passed from PlanDetailScreen + button
  final Activity? activity; // Optional for edit mode

  const ActivityScreen({super.key, required this.planId, this.activity});

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

// State class for ActivityScreen
class _ActivityScreenState extends State<ActivityScreen> {
  final _formKey = GlobalKey<FormState>(); // For validation

  // Controllers for text fields
  late TextEditingController _nameController;
  late TextEditingController _locationController;
  late TextEditingController _googlePlaceIdController;
  late TextEditingController _costController;
  late TextEditingController _detailsController;
  late TextEditingController _customTypeController;
  late TextEditingController _startTimeController;
  late TextEditingController _endTimeController;
  late TextEditingController _durationController;
  late TextEditingController
  _serviceProviderController; // Generic transit provider
  late TextEditingController _bookingReferenceController; // Generic booking ref

  // State variables
  ActivityType? _type = ActivityType.activity; // Dropdown selection
  CostType? _costType = CostType.estimated; // Default for costType dropdown
  DateTime? _startTime; // DateTime picker
  DateTime? _endTime; // Added: Default to now for end time
  int _durationMinutes = 60; // Default 1 hour

  // Sub-activities & links
  List<SubActivity> _subActivities = [];
  List<UrlLink> _urlLinks = [];

  // Formatting
  final _dateTimeFormat = DateFormat('yyyy-MM-dd HH:mm');

  bool _isSaving = false; // Loading spinner
  final String _linkName = '';
  final String _linkUrl = '';

  @override
  void initState() {
    super.initState();

    // Initialize controllers
    _nameController = TextEditingController();
    _locationController = TextEditingController();
    _googlePlaceIdController = TextEditingController();
    _costController = TextEditingController();
    _detailsController = TextEditingController();
    _customTypeController = TextEditingController();
    _startTimeController = TextEditingController();
    _endTimeController = TextEditingController();
    _durationController = TextEditingController();
    _serviceProviderController = TextEditingController();
    _bookingReferenceController = TextEditingController();

    if (widget.activity != null) {
      // Pre-fill for edit mode
      final e = widget.activity!;
      _nameController.text = e.name;
      _type = e.type;
      _locationController.text = e.location ?? '';
      _googlePlaceIdController.text = e.googlePlaceId;
      _costController.text = _costBoxText(e.cost);
      _detailsController.text = e.details ?? '';
      _customTypeController.text = e.customType ?? '';
      _serviceProviderController.text = e.serviceProvider ?? '';
      _bookingReferenceController.text = e.bookingReference ?? '';
      _startTime = e.startTime;
      _startTimeController.text = _startTime != null
          ? _dateTimeFormat.format(_startTime!)
          : '';
      _endTime = e.endTime;
      _endTimeController.text = _endTime != null
          ? _dateTimeFormat.format(_endTime!)
          : '';
      _durationMinutes = e.duration?.inMinutes ?? 0;
      _durationController.text = _durationMinutes.toString();
      _costType = e.costType ?? CostType.estimated;
      _subActivities = List<SubActivity>.from(e.subActivities);
      _urlLinks = List<UrlLink>.from(e.urlLinks);
    } else {
      // Add mode: Set defaults and auto-add sub-activities
      _type = ActivityType.activity;
      _urlLinks = [];
      _subActivities = []; // Will be populated below if transit type
      if ([
        ActivityType.flight,
        ActivityType.train,
        ActivityType.carRental,
        ActivityType.carService,
      ].contains(_type)) {
        final now = DateTime.now();
        final subTypes =
            {
              ActivityType.flight: ['departure', 'arrival'],
              ActivityType.train: ['departure', 'arrival'],
              ActivityType.carRental: ['pickup', 'dropoff'],
              ActivityType.carService: ['pickup', 'dropoff'],
            }[_type] ??
            [];
        _subActivities = subTypes
            .map(
              (subType) => SubActivity(
                name: capitalize(subType),
                subType: subType,
                startTime: now,
              ),
            )
            .toList();
      }
    }

    _startTimeController.addListener(() {
      if (_startTimeController.text.isEmpty) {
        setState(() => _startTime = null); // Clear to null on empty
      } else {
        try {
          setState(
            () => _startTime = _dateTimeFormat.parse(_startTimeController.text),
          );
        } catch (e) {
          // Invalid format—keep previous
        }
      }
    });

    _endTimeController.addListener(() {
      if (_endTimeController.text.isEmpty) {
        setState(() => _endTime = null); // Clear to null on empty
      } else {
        try {
          setState(
            () => _endTime = _dateTimeFormat.parse(_endTimeController.text),
          );
        } catch (e) {
          // Invalid format—keep previous
        }
      }
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    _locationController.dispose();
    _googlePlaceIdController.dispose();
    _costController.dispose();
    _detailsController.dispose();
    _customTypeController.dispose();
    _startTimeController.dispose();
    _endTimeController.dispose();
    _durationController.dispose();
    _serviceProviderController.dispose();
    _bookingReferenceController.dispose();
    super.dispose();
  }

  // Reusable combo date+time picker
  Future<DateTime?> _showComboDateTimePicker({
    DateTime? initialDateTime,
  }) async {
    if (!mounted) return null; // Check before start
    final date = await showDatePicker(
      context: context,
      initialDate: initialDateTime ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime(2100),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initialDateTime ?? DateTime.now()),
    );
    if (time == null || !mounted) return date; // User picked date only
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  // Save activity (add or update)
  Future<void> _saveActivity() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);

    final planProvider = Provider.of<PlanProvider>(context, listen: false);
    final userProvider = Provider.of<UserProvider>(context, listen: false);

    final newActivity = Activity(
      id: widget.activity?.id,
      planId: widget.planId,
      name: _nameController.text,
      location: _locationController.text.isEmpty
          ? null
          : _locationController.text,
      googlePlaceId: _googlePlaceIdController.text.trim(),
      type: _type ?? ActivityType.activity,
      customType: _customTypeController.text.isEmpty
          ? null
          : _customTypeController.text,
      cost: _parsedCost(_costController.text),
      costType: _costType ?? CostType.estimated,
      startTime: _startTime,
      duration: Duration(minutes: _durationMinutes),
      endTime: _endTime,
      details: _detailsController.text.isEmpty ? null : _detailsController.text,
      serviceProvider: _serviceProviderController.text.isEmpty
          ? null
          : _serviceProviderController.text,
      bookingReference: _bookingReferenceController.text.isEmpty
          ? null
          : _bookingReferenceController.text,
      subActivities: _subActivities,
      urlLinks: _urlLinks,
    );

    try {
      logger.i('Saving activity: ${newActivity.toJson()}'); // Log data sent
      if (widget.activity == null) {
        await planProvider.addActivity(newActivity, userProvider.token);
      } else {
        await planProvider.updateActivityDocument(newActivity, userProvider.token);
      }
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              widget.activity == null ? 'Activity added!' : 'Activity updated!',
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Save error: $e')));
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  // Add sub-activity (simplified for now)
  void _addSubActivity() {
    String? name = '';
    String? subType = '';
    String? location = '';
    DateTime startTime = DateTime.now();
    String? serviceNumber = '';
    String? serviceClass = '';

    final supportedSubTypes =
        {
          ActivityType.flight: ['departure', 'arrival'],
          ActivityType.train: ['departure', 'arrival'],
          ActivityType.carRental: ['pickup', 'dropoff'],
          ActivityType.carService: ['pickup', 'dropoff'],
        }[_type] ??
        ['generic'];

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add Sub-Activity'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: subType?.isNotEmpty == true
                    ? subType
                    : supportedSubTypes.first,
                decoration: const InputDecoration(labelText: 'Sub-Type'),
                items: supportedSubTypes
                    .map(
                      (type) => DropdownMenuItem(
                        value: type,
                        child: Text(
                          capitalize(type.toString().split('.').last),
                        ), // Fixed: Use function with string
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => subType = value),
              ),
              TextFormField(
                initialValue: name,
                decoration: const InputDecoration(labelText: 'Name'),
                onChanged: (value) => name = value,
              ),
              TextFormField(
                initialValue: location,
                decoration: const InputDecoration(labelText: 'Location'),
                onChanged: (value) => location = value,
              ),
              TextFormField(
                initialValue: serviceNumber,
                decoration: const InputDecoration(labelText: 'Service Number'),
                onChanged: (value) =>
                    serviceNumber = value.isEmpty ? null : value,
              ),
              DropdownButtonFormField<String>(
                initialValue: serviceClass,
                decoration: const InputDecoration(labelText: 'Service Class'),
                items: ['Economy', 'Business', 'First', 'Standard']
                    .map(
                      (cls) => DropdownMenuItem(value: cls, child: Text(cls)),
                    )
                    .toList(),
                onChanged: (value) => serviceClass = value,
              ),
              ElevatedButton(
                onPressed: () async {
                  final picked = await _showComboDateTimePicker(
                    initialDateTime: startTime,
                  );
                  if (picked != null) startTime = picked;
                },
                child: Text(
                  'Time: ${DateFormat('yyyy-MM-dd HH:mm').format(startTime)}',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              if ((name?.isNotEmpty ?? false) &&
                  (subType?.isNotEmpty ?? false)) {
                setState(() {
                  _subActivities.add(
                    SubActivity(
                      name: name ?? 'Unnamed',
                      subType: subType ?? 'generic',
                      location: location?.isEmpty == true
                          ? null
                          : location, // Ensure String?
                      startTime: startTime,
                      serviceNumber: serviceNumber,
                      serviceClass: serviceClass,
                    ),
                  );
                });
                Navigator.pop(context);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  // Remove sub-activity
  void _removeSubActivity(int index) {
    setState(() => _subActivities.removeAt(index));
  }

  // Edit sub-activity (placeholder)
  void _editSubActivity(int index) {
    logger.i('Edit sub-activity at index $index');
  }

  // Add URL link
  void _addLink(String url, String name) {
    if (url.isNotEmpty) {
      setState(() {
        _urlLinks.add(UrlLink(linkName: name, linkUrl: url));
      });
    }
  }

  // Helper to capitalize strings
  String capitalize(String str) {
    if (str.isEmpty) return str;
    return str[0].toUpperCase() + str.substring(1).toLowerCase();
  }

  // Recalculate duration when endTime changes
  void updateDuration() {
    if (_startTime != null && _endTime != null) {
      final duration = _endTime!.difference(_startTime!).inMinutes;
      setState(() => _durationMinutes = duration > 0 ? duration : 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.activity == null ? 'Add Activity' : 'Edit Activity'),
        backgroundColor: Colors.blue,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(labelText: 'Name'),
                validator: (value) =>
                    value?.isEmpty ?? true ? 'Name required' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _locationController,
                decoration: const InputDecoration(labelText: 'Location'),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _googlePlaceIdController,
                decoration: const InputDecoration(labelText: 'Google Place ID'),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<ActivityType>(
                initialValue: _type,
                decoration: const InputDecoration(labelText: 'Type'),
                items: ActivityType.values
                    .map(
                      (type) => DropdownMenuItem(
                        value: type,
                        child: Text(type.toString().split('.').last),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => _type = value),
                validator: (value) => value == null ? 'Type is required' : null,
              ),
              const SizedBox(height: 16),
              if (_type?.spPresence ?? false) ...[
                const Text(
                  'Reservation Details',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                TextFormField(
                  controller: _serviceProviderController,
                  decoration: InputDecoration(
                    labelText: _type?.serviceProviderLabel ?? '',
                  ),
                ),
                TextFormField(
                  controller: _bookingReferenceController,
                  decoration: InputDecoration(
                    labelText: _type?.bookingReferenceLabel ?? '',
                  ),
                ),
                const SizedBox(height: 16),
              ],
              TextFormField(
                controller: _detailsController,
                decoration: const InputDecoration(labelText: 'Details'),
                maxLines: 3,
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _startTimeController,
                      decoration: const InputDecoration(
                        labelText: 'Start Date/Time',
                      ),
                      onChanged: (value) {
                        if (value.isEmpty) {
                          setState(() => _startTime = null);
                        } else {
                          try {
                            setState(
                              () => _startTime = _dateTimeFormat.parse(value),
                            );
                          } catch (e) {
                            // Invalid format—keep previous
                          }
                        }
                      },
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.date_range),
                    onPressed: () async {
                      final newDateTime = await _showComboDateTimePicker(
                        initialDateTime: _startTime,
                      );
                      if (newDateTime != null) {
                        setState(() => _startTime = newDateTime);
                        updateDuration();
                      }
                    },
                    tooltip: 'Pick Start Date/Time',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _durationController,
                decoration: const InputDecoration(
                  labelText: 'Duration (minutes)',
                ),
                keyboardType: TextInputType.number,
                onChanged: (value) =>
                    _durationMinutes = int.tryParse(value) ?? 0,
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _endTimeController,
                      decoration: const InputDecoration(
                        labelText: 'End Date/Time',
                      ),
                      onChanged: (value) {
                        if (value.isEmpty) {
                          setState(() => _endTime = null);
                        } else {
                          try {
                            setState(
                              () => _endTime = _dateTimeFormat.parse(value),
                            );
                          } catch (e) {
                            // Invalid format—keep previous
                          }
                        }
                      },
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.date_range),
                    onPressed: () async {
                      final newDateTime = await _showComboDateTimePicker(
                        initialDateTime: _endTime,
                      );
                      if (newDateTime != null) {
                        setState(() => _endTime = newDateTime);
                        updateDuration();
                      }
                    },
                    tooltip: 'Pick End Date/Time',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _costController,
                decoration: const InputDecoration(labelText: 'Cost'),
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                validator: (value) {
                  final text = value?.trim() ?? '';
                  if (text.isEmpty) return null;
                  final cost = double.tryParse(text);
                  if (cost == null) return 'Enter cost as a number';
                  if (cost < 0) return 'Cost cannot be negative';
                  return null;
                },
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<CostType>(
                initialValue: _costType,
                decoration: const InputDecoration(labelText: 'Cost type'),
                items: const [
                  DropdownMenuItem(
                    value: CostType.estimated,
                    child: Text('Estimated'),
                  ),
                  DropdownMenuItem(
                    value: CostType.actual,
                    child: Text('Actual'),
                  ),
                ],
                onChanged: (value) =>
                    setState(() => _costType = value ?? CostType.estimated),
              ),
              const SizedBox(height: 16),
              const Text(
                'Links (optional)',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      decoration: const InputDecoration(labelText: 'Link URL'),
                      onFieldSubmitted: (url) => _addLink(url, _linkName),
                    ),
                  ),
                  Expanded(
                    child: TextFormField(
                      decoration: const InputDecoration(
                        labelText: 'Link Name (optional)',
                      ),
                      onFieldSubmitted: (name) => _addLink(_linkUrl, name),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (_urlLinks.isNotEmpty) ...[
                ..._urlLinks.map(
                  (link) => ListTile(
                    leading: const Icon(Icons.link),
                    title: Text(
                      link.linkName.isEmpty ? link.linkUrl : link.linkName,
                    ),
                    subtitle: Text(link.linkUrl),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete),
                      onPressed: () => setState(() => _urlLinks.remove(link)),
                    ),
                  ),
                ),
              ],
              if (_type == ActivityType.flight) ...[
                const Text(
                  'Sub-Activities',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: _addSubActivity,
                  child: const Text('Add Sub-Activity'),
                ),
                const SizedBox(height: 8),
                if (_subActivities.isNotEmpty) ...[
                  ..._subActivities.asMap().entries.map(
                    (entry) => ListTile(
                      title: Text(entry.value.name),
                      subtitle: Text(
                        '${entry.value.subType}: ${entry.value.startTime}',
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.edit),
                            onPressed: () => _editSubActivity(entry.key),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete),
                            onPressed: () => _removeSubActivity(entry.key),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isSaving ? null : _saveActivity,
                  child: _isSaving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          widget.activity == null
                              ? 'Add Activity'
                              : 'Update Activity',
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
