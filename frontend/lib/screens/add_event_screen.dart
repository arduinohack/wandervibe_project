import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart'; // For token
import '../models/event.dart';
import '../models/event_type.dart'; // For EventType enum
import 'plan_detail_screen.dart'; // Navigate back after add

class AddEventScreen extends StatefulWidget {
  final String planId; // Passed from PlanDetailScreen + button
  const AddEventScreen({super.key, required this.planId});

  @override
  State<AddEventScreen> createState() => _AddEventScreenState();
}

class _AddEventScreenState extends State<AddEventScreen> {
  final _formKey = GlobalKey<FormState>(); // For validation
  final _nameController = TextEditingController();
  final _locationController = TextEditingController();
  final _costController = TextEditingController();
  final _detailsController = TextEditingController();
  final _customTypeController = TextEditingController();
  EventType? _type = EventType.activity; // Dropdown selection
  final String _customType = 'party';
  CostType? _costType = CostType
      .estimated; // Added: Default for costType dropdown (string or enum)
  DateTime _startTime = DateTime.now(); // DateTime picker
  int _durationMinutes = 60; // Default 1 hour
  DateTime _endTime = DateTime.now(); // Added: Default to now for end time
  List<UrlLink> _urlLinks = []; // Added: Empty list for links
  final List<SubEvent> _subEvents = []; // State variable
  Map<String, dynamic> _extras = {}; // For custom fields
  String _customKey = ''; // Temp for key input
  String _urlLink = '';

  bool _isSaving = false; // Loading spinner

  @override
  void initState() {
    super.initState();
    // ... existing (if any)
    _endTime = DateTime.now(); // Ensure it's set
    _urlLinks = [];
  }

  @override
  void dispose() {
    _nameController.dispose();
    _locationController.dispose();
    _costController.dispose();
    _detailsController.dispose();
    _customTypeController.dispose();
    super.dispose();
  }

  // Local helper for capitalizing strings (avoids extension conflict)
  String capitalize(String str) {
    if (str.isEmpty) return str;
    return str[0].toUpperCase() + str.substring(1).toLowerCase();
  }

  Future<void> _saveEvent() async {
    if (_formKey.currentState!.validate()) {
      setState(() => _isSaving = true); // Spinner
      final planProvider = Provider.of<PlanProvider>(context, listen: false);
      final userProvider = Provider.of<UserProvider>(context, listen: false);

      final newEvent = Event(
        id: DateTime.now().millisecondsSinceEpoch.toString(), // Temp ID
        name: _nameController.text,
        location: _locationController.text,
        details: _detailsController.text,
        type: _type ?? EventType.activity, // Default if not selected
        customType: _customTypeController.text,
        cost: double.tryParse(_costController.text) ?? 0.0,
        costType: _costType,
        startTime: _startTime,
        duration: Duration(
          minutes: _durationMinutes,
        ), // Fixed: Wrap int as Duration (minutes)
        endTime: _endTime,
        urlLinks: _urlLinks,
        subEvents: _subEvents
            .map((se) => se.copyWith(extras: _extras))
            .toList(),
        planId: widget.planId, // Link to plan
        createdAt: DateTime.now(),
      );

      try {
        await planProvider.addEvent(
          newEvent,
          userProvider.token,
        ); // Backend save
        if (mounted) {
          Navigator.pop(context); // Back to PlanDetailScreen
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(const SnackBar(content: Text('Event added!')));
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text('Save error: $e')));
        }
      } finally {
        setState(() => _isSaving = false);
      }
    }
  }

  // Add sub-event (e.g., on button tap)
  void _addSubEvent(
    String name,
    String subType,
    String location,
    DateTime time,
  ) {
    setState(() {
      _subEvents.add(
        SubEvent(
          name: name,
          location: location,
          time: time,
          subType: subType,
          // gate: subType == 'departure' ? gate : null,
          // baggageClaim: subType == 'arrival' ? baggageClaim : null,
        ),
      );
    });
  }

  void _addLink(String urlName, String url) {
    if (url.isNotEmpty) {
      setState(() {
        _urlLinks.add(UrlLink(linkName: urlName, linkUrl: url));
      });
    }
  }

  Future<void> _pickStartTime() async {
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_startTime),
    );
    if (time != null) {
      setState(() {
        _startTime = DateTime(
          _startTime.year,
          _startTime.month,
          _startTime.day,
          time.hour,
          time.minute,
        );
        _updateDuration();
      });
    }
  }

  // Helper for picking end time (similar to _pickStartTime)
  void _pickEndTime() async {
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(
        _endTime,
      ), // Start with current _endTime
    );
    if (time != null) {
      setState(() {
        _endTime = DateTime(
          _endTime.year,
          _endTime.month,
          _endTime.day,
          time.hour,
          time.minute,
        ); // Update with selected time
        _updateDuration(); // Optional: Recalculate duration if endTime changes
      });
    }
  }

  // Helper to recalculate duration when endTime changes
  void _updateDuration() {
    final duration = _endTime
        .difference(_startTime)
        .inMinutes; // endTime - startTime = minutes
    setState(() {
      _durationMinutes = duration > 0
          ? duration
          : 60; // Min 60 if negative/zero
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Event'),
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
                validator: (value) =>
                    value?.isEmpty ?? true ? 'Location required' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _detailsController, // New controller
                decoration: const InputDecoration(
                  labelText: 'Details/Description',
                ),
                maxLines: 3, // Multi-line
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<EventType>(
                initialValue: _type,
                decoration: const InputDecoration(labelText: 'Type'),
                items: EventType.values
                    .map(
                      (type) => DropdownMenuItem(
                        value: type,
                        child: Text(type.toString().split('.').last),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => _type = value),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _customTypeController, // New controller
                decoration: const InputDecoration(labelText: 'Custom Type'),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _costController,
                decoration: const InputDecoration(labelText: 'Cost'),
                keyboardType: TextInputType.number,
                validator: (value) {
                  final cost = double.tryParse(value ?? '');
                  if (cost == null || cost < 0) return 'Valid cost required';
                  return null;
                },
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<CostType>(
                initialValue: CostType.estimated,
                decoration: const InputDecoration(labelText: 'Cost Type'),
                items: CostType.values
                    .map(
                      (type) => DropdownMenuItem(
                        value: type,
                        child: Text(
                          capitalize(type.toString().split('.').last),
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setState(() => _costType = value ?? CostType.estimated),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: ListTile(
                      title: const Text('Start Time'),
                      subtitle: Text(_startTime.toString().substring(11, 16)),
                      trailing: IconButton(
                        icon: const Icon(Icons.access_time),
                        onPressed: _pickStartTime,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TextFormField(
                decoration: const InputDecoration(
                  labelText: 'Duration (minutes)',
                ),
                keyboardType: TextInputType.number,
                onChanged: (value) =>
                    _durationMinutes = int.tryParse(value) ?? 0,
                validator: (value) {
                  final minutes = int.tryParse(value ?? '');
                  if (minutes == null || minutes < 1)
                    return 'Valid duration required';
                  return null;
                },
              ),
              // Links section
              const Text(
                'Links (optional)',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              TextFormField(
                decoration: const InputDecoration(
                  labelText: 'Link URL (e.g., https://maps.google.com)',
                ),
                onFieldSubmitted: (url) => _addLink(url, ''), // Add on submit
              ),
              TextFormField(
                decoration: const InputDecoration(
                  labelText: 'Link Name (optional)',
                ),
                onFieldSubmitted: (title) => _addLink(
                  title,
                  _urlLink,
                ), // Add on submit (update previous URL)
              ),
              const SizedBox(height: 8),
              if (_urlLinks.isNotEmpty) ...[
                ..._urlLinks.map(
                  (link) => ListTile(
                    leading: Icon(Icons.link),
                    title: Text(
                      link.linkName.isEmpty ? link.linkUrl : link.linkName,
                    ),
                    subtitle: Text(link.linkUrl),
                    trailing: IconButton(
                      icon: Icon(Icons.delete),
                      onPressed: () => setState(() => _urlLinks.remove(link)),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: ListTile(
                      title: const Text('End Time'),
                      subtitle: Text(
                        _endTime.toString().substring(11, 16),
                      ), // Time format
                      trailing: IconButton(
                        icon: const Icon(Icons.access_time),
                        onPressed:
                            _pickEndTime, // New helper for end time picker
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isSaving ? null : _saveEvent,
                  child: _isSaving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Add Event'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
