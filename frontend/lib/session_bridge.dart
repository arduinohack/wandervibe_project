/// Callbacks so the HTTP client can update the session without importing
/// the user provider (that import would cycle).
typedef SessionAccessCallback = void Function(String accessToken);
typedef SessionEndedCallback = void Function();

SessionAccessCallback? onSessionRefreshed;
SessionEndedCallback? onSessionEnded;
