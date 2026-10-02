class ProviderInfo {
  const ProviderInfo({
    required this.id,
    required this.name,
    required this.kind,
    required this.configured,
    this.defaultModel,
  });

  final String id;
  final String name;
  final String kind;
  final bool configured;
  final String? defaultModel;

  factory ProviderInfo.fromJson(Map<String, dynamic> json) => ProviderInfo(
        id: json['id'] as String,
        name: json['name'] as String? ?? json['id'] as String,
        kind: json['kind'] as String? ?? 'unknown',
        configured: json['configured'] as bool? ?? false,
        defaultModel: json['default_model'] as String?,
      );
}
