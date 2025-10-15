import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as io; // For Socket.IO
import 'dart:convert'; // For JSON

class ChatScreen extends StatefulWidget {
  final String tripId; // For trip-specific chat

  const ChatScreen({super.key, required this.tripId});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late io.Socket socket; // Socket connection
  List<Map<String, dynamic>> _messages = []; // List of messages (mock/stream)
  final TextEditingController _messageController =
      TextEditingController(); // For input
  bool _isConnected = false; // Connection status

  @override
  void initState() {
    super.initState();
    _connectSocket(); // Connect on open
  }

  void _connectSocket() {
    // Connect to backend (replace with production URL)
    socket = io.io(
      'http://localhost:3000',
      io.OptionBuilder().setTransports([
        'websocket',
      ]) // Use WebSocket for real-time
      .build(),
    );

    socket.onConnect((_) {
      setState(() => _isConnected = true);
      print('Connected to chat for trip ${widget.tripId}');
      socket.emit('joinTrip', widget.tripId); // Join trip room
    });

    socket.onDisconnect((_) => setState(() => _isConnected = false));

    // Listen for new messages
    socket.on('newMessage', (data) {
      final message = json.decode(data); // From backend JSON
      setState(() {
        _messages.add(message); // Add to list (live update)
      });
      print('New message: ${message['text']} from ${message['userId']}');
    });

    // Mock initial messages (replace with fetch from backend)
    _messages = [
      {
        'id': 'msg1',
        'userId': 'user123',
        'text': 'Welcome to the trip chat!',
        'timestamp': DateTime.now().toIso8601String(),
      },
      {
        'id': 'msg2',
        'userId': 'user456',
        'text': 'Excited for Paris!',
        'timestamp': DateTime.now()
            .subtract(const Duration(minutes: 5))
            .toIso8601String(),
      },
    ];
  }

  @override
  void dispose() {
    _messageController.dispose();
    socket.disconnect(); // Clean up connection
    super.dispose();
  }

  void _sendMessage() {
    if (_messageController.text.trim().isEmpty) return; // No empty messages

    final message = {
      'tripId': widget.tripId,
      'userId': 'user123', // Stub current user; later from UserProvider
      'text': _messageController.text.trim(),
      'timestamp': DateTime.now().toIso8601String(),
    };

    // Add locally for immediate feedback (optimistic update)
    setState(() {
      _messages.add(message); // Add to list (shows blue bubble right away)
    });

    socket.emit('sendMessage', json.encode(message)); // Send to backend
    _messageController.clear(); // Clear input
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Chat - Trip ${widget.tripId}'),
        backgroundColor: Colors.blue,
        actions: [
          IconButton(
            icon: Icon(_isConnected ? Icons.wifi : Icons.wifi_off),
            onPressed: null, // Status indicator (stub)
          ),
        ],
      ),
      body: Column(
        children: [
          // Message List
          Expanded(
            child: _messages.isEmpty
                ? const Center(child: Text('No messages yet—start chatting!'))
                : ListView.builder(
                    reverse: true, // Newest at bottom
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final message = _messages[index];
                      final isMe =
                          message['userId'] == 'user456'; // Stub current user
                      return Align(
                        alignment: isMe
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.symmetric(
                            vertical: 4,
                            horizontal: 8,
                          ),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: isMe ? Colors.blue : Colors.grey[300],
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                message['text'],
                                style: TextStyle(
                                  color: isMe ? Colors.white : Colors.black,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                message['timestamp']
                                    .toString()
                                    .split('T')[1]
                                    .substring(0, 5), // Time only
                                style: TextStyle(
                                  fontSize: 12,
                                  color: isMe ? Colors.white70 : Colors.black54,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          // Input Field
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.grey[100],
              border: Border(top: BorderSide(color: Colors.grey[300]!)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    decoration: const InputDecoration(
                      hintText: 'Send a vibe...',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.all(Radius.circular(20)),
                      ),
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                    ),
                    onSubmitted: (_) => _sendMessage(), // Send on Enter
                  ),
                ),
                const SizedBox(width: 8),
                FloatingActionButton(
                  mini: true,
                  onPressed: _sendMessage,
                  child: const Icon(Icons.send),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
