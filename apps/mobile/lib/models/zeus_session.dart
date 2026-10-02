class ZeusSession {
  const ZeusSession({
    required this.id,
    required this.agentId,
    required this.runtime,
    required this.status,
    required this.lastEvent,
    required this.updatedAt,
    this.provider,
    this.model,
    this.project,
    this.machineId,
    this.machineName,
    this.message,
    this.capabilities = const [],
    this.pendingRequestId,
  });

  final String id;
  final String agentId;
  final String runtime;
  final String? provider;
  final String? model;
  final String? project;
  final String? machineId;
  final String? machineName;
  final String status;
  final String lastEvent;
  final DateTime updatedAt;
  final String? message;
  final List<String> capabilities;
  final String? pendingRequestId;

  bool get needsAttention => status == 'waiting';
  bool get isWorking => status == 'working';
  bool get isDone => status == 'completed';
  bool get hasError => status == 'failed';
  bool supports(String capability) => capabilities.contains(capability);

  factory ZeusSession.fromJson(Map<String, dynamic> json) => ZeusSession(
        id: json['id'] as String,
        agentId: json['agent_id'] as String,
        runtime: json['runtime'] as String,
        provider: json['provider'] as String?,
        model: json['model'] as String?,
        project: json['project'] as String?,
        machineId: json['machine_id'] as String?,
        machineName: json['machine_name'] as String?,
        status: json['status'] as String? ?? 'idle',
        lastEvent: json['last_event'] as String? ?? '',
        updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? '') ?? DateTime.now(),
        message: json['message'] as String?,
        capabilities: ((json['capabilities'] as List?) ?? const []).whereType<String>().toList(growable: false),
        pendingRequestId: json['pending_request_id'] as String?,
      );
}
