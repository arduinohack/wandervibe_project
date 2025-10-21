import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/trip_provider.dart'; // For addEvent
import '../providers/user_provider.dart'; // For addEvent
import '../models/event.dart'; // Event model
//import '../models/trip.dart'; // For tripId

class AddEventScreen extends StatefulWidget {
  final String tripId; // Passed from TripDetailScreen

  const AddEventScreen({super.key, required this.tripId});

  @override
  State<AddEventScreen> createState() => _AddEventScreenState();
}

class _AddEventScreenState extends State<AddEventScreen> {
  final _formKey = GlobalKey<FormState>(); // For form validation
  final _titleController = TextEditingController(); // For text inputs
  final _locationController = TextEditingController();
  final _detailsController = TextEditingController();
  final _costController = TextEditingController();
  DateTime _startTime = DateTime.now(); // Default times
  DateTime _endTime = DateTime.now().add(const Duration(hours: 2));
  EventType _type = EventType.dining; // Default type
  CostType _costType = CostType.estimated; // Default cost type
  String? _originTimeZone; // Optional for flights
  String? _destinationTimeZone; // Optional for flights
  bool _isFlight = false; // Track if type is flight (show TZ fields)

  @override
  void dispose() {
    _titleController.dispose(); // Clean up controllers
    _locationController.dispose();
    _detailsController.dispose();
    _costController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Event'),
        backgroundColor: Colors.blue,
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            // Scroll for long form
            child: Column(
              children: [
                // Title Field
                TextFormField(
                  controller: _titleController,
                  decoration: const InputDecoration(
                    labelText: 'Title (e.g., Flight to Paris)',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Title is required';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                // Location Field
                TextFormField(
                  controller: _locationController,
                  decoration: const InputDecoration(
                    labelText: 'Location',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),

                // Details Field
                TextFormField(
                  controller: _detailsController,
                  decoration: const InputDecoration(
                    labelText: 'Details',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 3,
                ),
                const SizedBox(height: 16),

                // Type Dropdown
                DropdownButtonFormField<EventType>(
                  initialValue: _type,
                  decoration: const InputDecoration(
                    labelText: 'Type',
                    border: OutlineInputBorder(),
                  ),
                  items: EventType.values.map((type) {
                    return DropdownMenuItem(
                      value: type,
                      child: Text(
                        type
                            .toString()
                            .split('.')
                            .last
                            .replaceAll('EventType.', '')
                            .toUpperCase(),
                      ),
                    );
                  }).toList(),
                  onChanged: (value) {
                    setState(() {
                      _type = value!;
                      _isFlight =
                          value == EventType.flight; // Show TZ if flight
                    });
                  },
                ),
                const SizedBox(height: 16),

                // Cost Field
                TextFormField(
                  controller: _costController,
                  decoration: const InputDecoration(
                    labelText: 'Cost',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Cost is required';
                    }
                    if (double.tryParse(value) == null) {
                      return 'Enter a valid number';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                // Cost Type Dropdown
                DropdownButtonFormField<CostType>(
                  initialValue: _costType,
                  decoration: const InputDecoration(
                    labelText: 'Cost Type',
                    border: OutlineInputBorder(),
                  ),
                  items: CostType.values.map((costType) {
                    return DropdownMenuItem(
                      value: costType,
                      child: Text(
                        costType
                            .toString()
                            .split('.')
                            .last
                            .replaceAll('CostType.', '')
                            .toUpperCase(),
                      ),
                    );
                  }).toList(),
                  onChanged: (value) => setState(() => _costType = value!),
                ),
                const SizedBox(height: 16),

                // Start Time Picker (Date + Time)
                ListTile(
                  title: const Text('Start Time'),
                  subtitle: Text(
                    '${_startTime.toLocal().toString().split(' ')[0]} ${_startTime.toLocal().toString().split(' ')[1].substring(0, 5)}',
                  ),
                  trailing: const Icon(Icons.access_time),
                  onTap: () async {
                    // Pick date
                    final datePicked = await showDatePicker(
                      context: context,
                      initialDate: _startTime,
                      firstDate: DateTime.now().subtract(
                        const Duration(days: 1),
                      ),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (datePicked != null) {
                      // Pick time
                      final timePicked = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay.fromDateTime(_startTime),
                      );
                      if (timePicked != null) {
                        setState(() {
                          _startTime = DateTime(
                            datePicked.year,
                            datePicked.month,
                            datePicked.day,
                            timePicked.hour,
                            timePicked.minute,
                          );
                        });
                      }
                    }
                  },
                ),
                const SizedBox(height: 16),

                // End Time Picker (Date + Time)
                ListTile(
                  title: const Text('End Time'),
                  subtitle: Text(
                    '${_endTime.toLocal().toString().split(' ')[0]} ${_endTime.toLocal().toString().split(' ')[1].substring(0, 5)}',
                  ),
                  trailing: const Icon(Icons.access_time),
                  onTap: () async {
                    // Pick date
                    final datePicked = await showDatePicker(
                      context: context,
                      initialDate: _endTime,
                      firstDate: _startTime, // Can't be before start
                      lastDate: _startTime.add(const Duration(days: 30)),
                    );
                    if (datePicked != null) {
                      // Pick time
                      final timePicked = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay.fromDateTime(_endTime),
                      );
                      if (timePicked != null) {
                        final newEndTime = DateTime(
                          datePicked.year,
                          datePicked.month,
                          datePicked.day,
                          timePicked.hour,
                          timePicked.minute,
                        );
                        if (newEndTime.isAfter(_startTime)) {
                          setState(() => _endTime = newEndTime);
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'End time must be after start time',
                              ),
                            ),
                          );
                        }
                      }
                    }
                  },
                ),
                const SizedBox(height: 16),

                // Time Zone Fields (Show only for flights)
                if (_isFlight) ...[
                  // Origin TZ Dropdown (stub common TZ; later full picker)
                  DropdownButtonFormField<String>(
                    initialValue: _originTimeZone,
                    decoration: const InputDecoration(
                      labelText: 'Origin Time Zone (required for flight)',
                      border: OutlineInputBorder(),
                    ),
                    items: ['America/New_York', 'Europe/Paris', 'Asia/Tokyo']
                        .map((tz) {
                          return DropdownMenuItem(value: tz, child: Text(tz));
                        })
                        .toList(),
                    onChanged: (value) =>
                        setState(() => _originTimeZone = value),
                    validator: (value) =>
                        value == null ? 'Origin TZ required for flights' : null,
                  ),
                  const SizedBox(height: 16),
                  // Destination TZ Dropdown
                  DropdownButtonFormField<String>(
                    initialValue: _destinationTimeZone,
                    decoration: const InputDecoration(
                      labelText: 'Destination Time Zone (required for flight)',
                      border: OutlineInputBorder(),
                    ),
                    items: ['America/New_York', 'Europe/Paris', 'Asia/Tokyo']
                        .map((tz) {
                          return DropdownMenuItem(value: tz, child: Text(tz));
                        })
                        .toList(),
                    onChanged: (value) =>
                        setState(() => _destinationTimeZone = value),
                    validator: (value) => value == null
                        ? 'Destination TZ required for flights'
                        : null,
                  ),
                  const SizedBox(height: 16),
                ],

                // Submit Button
                ElevatedButton(
                  onPressed: _submitForm,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    minimumSize: const Size(double.infinity, 50),
                  ),
                  child: const Text(
                    'Add Event',
                    style: TextStyle(fontSize: 18),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // Submit the form
  void _submitForm() {
    if (_formKey.currentState!.validate()) {
      final tripProvider = Provider.of<TripProvider>(context, listen: false);
      final userProvider = Provider.of<UserProvider>(
        context,
        listen: false,
      ); // Get token
      final newEvent = Event(
        id: DateTime.now().millisecondsSinceEpoch.toString(), // Mock ID
        tripId: widget.tripId,
        title: _titleController.text,
        location: _locationController.text,
        details: _detailsController.text,
        type: _type,
        cost: double.parse(_costController.text),
        costType: _costType,
        startTime: _startTime,
        endTime: _endTime,
        originTimeZone: _isFlight ? _originTimeZone : null,
        destinationTimeZone: _isFlight ? _destinationTimeZone : null,
        resourceLinks: {}, // Add links later
        createdAt: DateTime.now(),
      );

      tripProvider.addEvent(newEvent, userProvider.token); // Fixed: Pass token
      Navigator.pop(
        context,
        newEvent,
      ); // Return to TripDetailScreen (updates list)
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Event added successfully!')),
      );
    }
  }
}
