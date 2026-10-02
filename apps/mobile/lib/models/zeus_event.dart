class ZeusEvent {
  const ZeusEvent({
    required this.sessionId,
    required this.agentId,
    required this.runtime,
    required this.type,
    this.id,
    this.timestamp,
    this.provider,
    this.model,
    this.project,
    this.message,
    this.tool,
    this.path,
    this.command,
    this.metadata = const {},
  });

  final String? id;
  final DateTime? timestamp;
  final String sessionId;
  final String agentId;
  final String runtime;
  final String type;
  final String? provider;
  final String? model;
  final String? project;
  final String? message;
  final String? tool;
  final String? path;
  final String? command;
  final Map<String, dynamic> metadata;

  factory ZeusEvent.fromJson(Map<String, dynamic> json) => ZeusEvent(
        id: json['id'] as String?,
        timestamp: DateTime.tryParse(json['timestamp'] as String? ?? ''),
        sessionId: json['session_id'] as String,
        agentId: json['agent_id'] as String,
        runtime: json['runtime'] as String,
        type: json['type'] as String,
        provider: json['provider'] as String?,
        model: json['model'] as String?,
        project: json['project'] as String?,
        message: json['message'] as String?,
        tool: json['tool'] as String?,
        path: json['path'] as String?,
        command: json['command'] as String?,
        metadata: (json['metadata'] as Map?)?.cast<String, dynamic>() ?? const {},
      );
}
