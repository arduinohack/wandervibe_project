import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../utils/logger.dart';
import '../providers/user_provider.dart'; // For update
import '../models/user.dart'; // User model with Address/Preferences

class UserProfileScreen extends StatefulWidget {
  const UserProfileScreen({super.key});

  @override
  State<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends State<UserProfileScreen> {
  final _formKey = GlobalKey<FormState>(); // For validation
  late User _currentUser; // Track edited user
  late TextEditingController _firstNameController;
  late TextEditingController _lastNameController;
  late TextEditingController _emailController;
  late TextEditingController _phoneController;
  late TextEditingController _streetController;
  late TextEditingController _cityController;
  late TextEditingController _stateController;
  late TextEditingController _countryController;
  late TextEditingController _postalCodeController;
  bool _emailNotifications = true; // For preferences
  bool _smsNotifications = false;
  bool _isSaving = false;
  bool _hasChanges = false;

  @override
  void initState() {
    super.initState();
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    _currentUser =
        userProvider.currentUser ??
        User(
          // Load from provider, fallback to stub
          id: 'user123',
          firstName: 'Alex',
          lastName: 'Vander',
          email: 'alex@vandervibe.com',
          phoneNumber: '+1-555-1234',
          address: Address(
            street: '123 Wander St',
            city: 'New York',
            state: 'NY',
            country: 'USA',
            postalCode: '10001',
          ),
          notificationPreferences: NotificationPreferences(
            email: true,
            sms: false,
          ),
          createdAt: DateTime.now(),
        );
    _emailNotifications = _currentUser.notificationPreferences.email;
    _smsNotifications = _currentUser.notificationPreferences.sms;
    // Set controllers from _currentUser
    _firstNameController = TextEditingController(text: _currentUser.firstName);
    _lastNameController = TextEditingController(text: _currentUser.lastName);
    _emailController = TextEditingController(text: _currentUser.email);
    _phoneController = TextEditingController(text: _currentUser.phoneNumber);
    _streetController = TextEditingController(
      text: _currentUser.address.street,
    );
    _cityController = TextEditingController(text: _currentUser.address.city);
    _stateController = TextEditingController(text: _currentUser.address.state);
    _countryController = TextEditingController(
      text: _currentUser.address.country,
    );
    _postalCodeController = TextEditingController(
      text: _currentUser.address.postalCode,
    );
  }

  @override
  void dispose() {
    // Clean up controllers
    _firstNameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _streetController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _countryController.dispose();
    _postalCodeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Added: Intercept back gesture
      canPop: false, // Prevent pop until we handle it
      onPopInvoked: (didPop) async {
        if (didPop) return; // Already popped (e.g., from dialog button)
        if (!_hasChanges) {
          Navigator.pop(context); // No changes: Allow back
          return;
        }
        // Changes made: Show warning dialog
        final shouldSave = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Unsaved Changes'),
            content: const Text(
              'You have unsaved changes. Save before leaving?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false), // Discard
                child: const Text('Discard'),
              ),
              TextButton(
                onPressed: () async {
                  await _saveProfile(); // Save then pop
                  Navigator.of(context).pop(true);
                },
                child: const Text('Save and Return'),
              ),
            ],
          ),
        );
        if (shouldSave == true) {
          // Save done in dialog
        } else if (shouldSave == false) {
          Navigator.pop(context); // Discard and back
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('User Profile'),
          backgroundColor: Colors.blue,
          actions: [
            IconButton(
              icon: Icon(_isSaving ? Icons.hourglass_empty : Icons.save),
              onPressed: (_hasChanges && !_isSaving)
                  ? _saveProfile
                  : null, // Disable until changes
              tooltip: 'Save Profile',
            ),
          ],
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16.0),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Basic Info Section
                const Text(
                  'Basic Info',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                TextFormField(
                  controller: _firstNameController,
                  decoration: const InputDecoration(
                    labelText: 'First Name',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) =>
                      value?.isEmpty ?? true ? 'First name required' : null,
                  onChanged: (value) {
                    print(
                      'FirstName changed: "$value" (different from original: ${value != _currentUser.firstName})',
                    ); // Debug: See change
                    if (value != _currentUser.firstName) {
                      setState(() => _hasChanges = true); // Detect change
                    }
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _lastNameController,
                  decoration: const InputDecoration(
                    labelText: 'Last Name',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) =>
                      value?.isEmpty ?? true ? 'Last name required' : null,
                  onChanged: (value) {
                    if (value != _currentUser.lastName) {
                      setState(() => _hasChanges = true); // Detect change
                    }
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _emailController,
                  decoration: const InputDecoration(
                    labelText: 'Email',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.emailAddress,
                  validator: (value) {
                    if (value == null || value.isEmpty) return 'Email required';
                    if (!RegExp(
                      r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$',
                    ).hasMatch(value)) {
                      return 'Invalid email';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _phoneController,
                  decoration: const InputDecoration(
                    labelText: 'Phone Number',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.phone,
                  validator: (value) =>
                      value?.isEmpty ?? true ? 'Phone required' : null,
                  onChanged: (value) {
                    if (value != _currentUser.phoneNumber) {
                      setState(() => _hasChanges = true); // Detect change
                    }
                  },
                ),
                const SizedBox(height: 24),
                // Address Section
                const Text(
                  'Address',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                TextFormField(
                  controller: _streetController,
                  decoration: const InputDecoration(
                    labelText: 'Street',
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (value) {
                    if (value != _currentUser.address.street) {
                      setState(() => _hasChanges = true);
                    }
                  },
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _cityController,
                        decoration: const InputDecoration(
                          labelText: 'City',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (value) {
                          if (value != _currentUser.address.city) {
                            setState(() => _hasChanges = true);
                          }
                        },
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: TextFormField(
                        controller: _stateController,
                        decoration: const InputDecoration(
                          labelText: 'State',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (value) {
                          if (value != _currentUser.address.state) {
                            setState(() => _hasChanges = true);
                          }
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _countryController,
                        decoration: const InputDecoration(
                          labelText: 'Country',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (value) {
                          if (value != _currentUser.address.country) {
                            setState(() => _hasChanges = true);
                          }
                        },
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: TextFormField(
                        controller: _postalCodeController,
                        decoration: const InputDecoration(
                          labelText: 'Postal Code',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (value) {
                          if (value != _currentUser.address.postalCode) {
                            setState(() => _hasChanges = true);
                          }
                        },
                        keyboardType: TextInputType.number,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Notification Preferences Section
                const Text(
                  'Notifications',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  title: const Text('Email Notifications'),
                  value: _emailNotifications,
                  onChanged: (value) {
                    setState(() => _emailNotifications = value);
                    if (value != _currentUser.notificationPreferences.email) {
                      setState(() => _hasChanges = true); // Detect change
                    }
                  },
                ),
                SwitchListTile(
                  title: const Text('SMS Notifications'),
                  value: _smsNotifications,
                  onChanged: (value) {
                    setState(() => _smsNotifications = value);
                    if (value != _currentUser.notificationPreferences.sms) {
                      setState(() => _hasChanges = true); // Detect change
                    }
                  },
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // Save the profile (async for API call)
  Future<void> _saveProfile() async {
    // Already async from earlier
    if (_formKey.currentState!.validate()) {
      setState(() => _isSaving = true);
      final userProvider = Provider.of<UserProvider>(context, listen: false);
      final updates = <String, dynamic>{}; // Start with empty map

      // Add basic fields if changed
      if (_firstNameController.text.isNotEmpty) {
        updates['firstName'] = _firstNameController.text;
      }
      if (_lastNameController.text.isNotEmpty) {
        updates['lastName'] = _lastNameController.text;
      }

      // Add phone if changed or not empty
      if (_phoneController.text.isNotEmpty &&
          _phoneController.text != _currentUser.phoneNumber) {
        updates['phoneNumber'] = _phoneController.text;
      }

      // Add address if any field changed
      final newAddress = Address(
        street: _streetController.text,
        city: _cityController.text,
        state: _stateController.text,
        country: _countryController.text,
        postalCode: _postalCodeController.text,
      );
      if (newAddress != _currentUser.address) {
        updates['address'] = newAddress.toJson();
      }
      // Prefs
      final newPrefs = NotificationPreferences(
        email: _emailNotifications,
        sms: _smsNotifications,
      );
      if (newPrefs != _currentUser.notificationPreferences) {
        updates['notificationPreferences'] = newPrefs
            .toJson(); // Always add notification preferences (they're toggles)
      }
      if (updates.isNotEmpty) {
        // Only send if changes
        try {
          logger.i('Updating User');
          await userProvider.updateUser(updates);
          if (mounted) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('Profile saved!')));
            Navigator.pop(context);
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
  }
}
