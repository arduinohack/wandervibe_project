const int aiCommandHistoryUserLimit = 5;

class AiCommandTurn {
  final String role;
  final String content;

  const AiCommandTurn({required this.role, required this.content});

  Map<String, String> toJson() => {'role': role, 'content': content};
}

List<AiCommandTurn> appendAiCommandHistory(
  List<AiCommandTurn> history,
  String instruction,
  String summary,
) {
  final userText = instruction.trim();
  if (userText.isEmpty) return List<AiCommandTurn>.of(history);
  final assistantText = summary.trim().isEmpty ? 'No change.' : summary.trim();
  return trimAiCommandHistory([
    ...history,
    AiCommandTurn(role: 'user', content: userText),
    AiCommandTurn(role: 'assistant', content: assistantText),
  ]);
}

List<AiCommandTurn> trimAiCommandHistory(List<AiCommandTurn> history) {
  final userIndexes = <int>[];
  for (var i = 0; i < history.length; i++) {
    if (history[i].role == 'user') userIndexes.add(i);
  }
  if (userIndexes.length <= aiCommandHistoryUserLimit) {
    return List<AiCommandTurn>.of(history);
  }
  final start = userIndexes[userIndexes.length - aiCommandHistoryUserLimit];
  return history.sublist(start);
}
