/// A session as the desktop reports it.
///
/// Field names match the engine's `SessionView` and the gateway's `Session`, so
/// there is one vocabulary across all three tiers. The derived getters are the
/// only logic here: a list screen asks "needs attention" and nothing else.
class ZeusSession {
  const ZeusSession({
    required this.id,
    required this.agentId,
    required this.runtime,
    required this.status,
    required this.lastEvent,
    required this.updatedAt,
    this.externalSessionId,
    this.lastSeq = 0,
    this.provider,
    this.model,
    this.project,
    this.machineId,
    this.machineName,
    this.message,
    this.capabilities = const [],
    this.pendingRequestId,
    this.usage = const TokenUsage(),
  });

  final String id;
  final String agentId;
  final String runtime;
  final String? externalSessionId;
  final int lastSeq;
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
  final TokenUsage usage;

  /// The desktop holds the approval, so a request it has not confirmed is not
  /// something this app may answer. An expired one is not a decision at all.
  bool get needsAttention => status == 'waiting' && pendingRequestId != null;

  bool get isWorking => status == 'working';
  bool get isDone => status == 'completed';
  bool get hasError => status == 'failed';
  bool get isRemote => machineId != null && machineId!.isNotEmpty;

  bool supports(String capability) => capabilities.contains(capability);

  /// Whether a control is worth rendering at all. A control the runtime has not
  /// advertised is never shown, rather than shown and then refused.
  bool get canStop => supports('stop');
  bool get canResume => supports('resume') && externalSessionId != null;
  bool get canSend => supports('send');

  factory ZeusSession.fromJson(Map<String, dynamic> json) => ZeusSession(
    id: json['id'] as String,
    agentId: json['agent_id'] as String,
    runtime: json['runtime'] as String,
    externalSessionId: json['external_session_id'] as String?,
    lastSeq: (json['last_seq'] as num?)?.toInt() ?? 0,
    provider: json['provider'] as String?,
    model: json['model'] as String?,
    project: json['project'] as String?,
    machineId: json['machine_id'] as String?,
    machineName: json['machine_name'] as String?,
    status: json['status'] as String? ?? 'idle',
    lastEvent: json['last_event'] as String? ?? '',
    updatedAt:
        DateTime.tryParse(json['updated_at'] as String? ?? '') ??
        DateTime.now(),
    message: json['message'] as String?,
    capabilities: ((json['capabilities'] as List?) ?? const [])
        .whereType<String>()
        .toList(growable: false),
    pendingRequestId: json['pending_request_id'] as String?,
    usage: json['usage'] == null
        ? const TokenUsage()
        : TokenUsage.fromJson((json['usage'] as Map).cast<String, dynamic>()),
  );
}

/// Token counters. [estimated] is carried through rather than dropped: a cost
/// figure the runtime did not report must not read like one it did.
class TokenUsage {
  const TokenUsage({
    this.input = 0,
    this.output = 0,
    this.cached = 0,
    this.thinking = 0,
    this.estimated = false,
    this.costUsd,
  });

  final int input;
  final int output;
  final int cached;
  final int thinking;
  final bool estimated;
  final double? costUsd;

  int get total => input + output + thinking;

  bool get isEmpty => total == 0;

  /// Cache reads are the clearest signal that prompt caching is working, so they
  /// are reported separately from fresh input.
  double get cacheShare => input == 0 ? 0 : cached / input;

  factory TokenUsage.fromJson(Map<String, dynamic> json) => TokenUsage(
    input: (json['input'] as num?)?.toInt() ?? 0,
    output: (json['output'] as num?)?.toInt() ?? 0,
    cached: (json['cached'] as num?)?.toInt() ?? 0,
    thinking: (json['thinking'] as num?)?.toInt() ?? 0,
    estimated: json['estimated'] as bool? ?? false,
    costUsd: (json['cost_usd'] as num?)?.toDouble(),
  );

  String describe() {
    if (isEmpty) return 'No usage reported';
    final parts = <String>[
      '${_compact(input)} in',
      '${_compact(output)} out',
      if (cached > 0) '${_compact(cached)} cached',
    ];
    final cost = costUsd == null ? '' : ' · \$${costUsd!.toStringAsFixed(3)}';
    final body = '${parts.join(' · ')}$cost';
    return estimated ? '$body (estimated)' : body;
  }

  static String _compact(int value) {
    if (value >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
    if (value >= 1000) return '${(value / 1000).toStringAsFixed(1)}k';
    return '$value';
  }
}

/// The short session summary the desktop keeps.
///
/// This is what a phone renders instead of replaying history: a few hundred
/// characters, no file contents, updated in place rather than appended to.
class SessionDigest {
  const SessionDigest({
    required this.sessionId,
    this.goal = '',
    this.constraints = const [],
    this.decisions = const [],
    this.changedFiles = const [],
    this.tests = const [],
    this.pending = const [],
    this.lastSeq = 0,
  });

  final String sessionId;
  final String goal;
  final List<String> constraints;
  final List<String> decisions;
  final List<String> changedFiles;
  final List<String> tests;
  final List<String> pending;
  final int lastSeq;

  bool get isEmpty =>
      goal.isEmpty &&
      constraints.isEmpty &&
      decisions.isEmpty &&
      changedFiles.isEmpty &&
      tests.isEmpty &&
      pending.isEmpty;

  factory SessionDigest.fromJson(Map<String, dynamic> json) => SessionDigest(
    sessionId: json['session_id'] as String,
    goal: json['goal'] as String? ?? '',
    constraints: _strings(json['constraints']),
    decisions: _strings(json['decisions']),
    changedFiles: _strings(json['changed_files']),
    tests: _strings(json['tests']),
    pending: _strings(json['pending']),
    lastSeq: (json['last_seq'] as num?)?.toInt() ?? 0,
  );

  static List<String> _strings(Object? value) => ((value as List?) ?? const [])
      .whereType<String>()
      .toList(growable: false);
}
