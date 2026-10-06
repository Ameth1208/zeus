import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/zeus_config.dart';
import '../models/provider_info.dart';
import '../models/zeus_event.dart';
import '../models/zeus_session.dart';
import '../services/credentials_store.dart';
import '../services/gateway_client.dart';

final credentialsStoreProvider = Provider((ref) => CredentialsStore());

class GatewayConnection {
  const GatewayConnection({this.url, this.token});
  final String? url;
  final String? token;
  bool get connected => url != null && token != null && token!.isNotEmpty;
}

class GatewayConnectionNotifier extends AsyncNotifier<GatewayConnection> {
  @override
  Future<GatewayConnection> build() async {
    final store = ref.read(credentialsStoreProvider);
    final url = await store.readGateway() ?? ZeusConfig.defaultGateway;
    final token = await store.readToken();
    return GatewayConnection(url: url, token: token);
  }

  Future<void> pair({required String url, required String code, required String deviceName}) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final pair = await GatewayClient.completePair(baseUrl: url, code: code, deviceName: deviceName);
      await ref.read(credentialsStoreProvider).save(gateway: url, token: pair['token']!);
      return GatewayConnection(url: url, token: pair['token']);
    });
  }

  Future<void> disconnect() async {
    await ref.read(credentialsStoreProvider).clear();
    state = AsyncData(GatewayConnection(url: ZeusConfig.defaultGateway));
  }
}

final gatewayConnectionProvider =
    AsyncNotifierProvider<GatewayConnectionNotifier, GatewayConnection>(GatewayConnectionNotifier.new);

final gatewayClientProvider = Provider<GatewayClient?>((ref) {
  final connection = ref.watch(gatewayConnectionProvider).value;
  if (connection == null || !connection.connected) return null;
  return GatewayClient(baseUrl: connection.url!, token: connection.token!);
});

class SessionsNotifier extends AsyncNotifier<List<ZeusSession>> {
  StreamSubscription? _events;

  @override
  Future<List<ZeusSession>> build() async {
    ref.onDispose(() => _events?.cancel());
    final client = ref.watch(gatewayClientProvider);
    if (client == null) return const [];
    _events?.cancel();
    _events = client.events().listen((_) => refresh(), onError: (_) {});
    return client.sessions();
  }

  Future<void> refresh() async {
    final client = ref.read(gatewayClientProvider);
    if (client == null) return;
    state = const AsyncLoading<List<ZeusSession>>();
    state = await AsyncValue.guard(client.sessions);
  }

  Future<void> action(ZeusSession session, String kind, {Map<String, dynamic>? payload}) async {
    final client = ref.read(gatewayClientProvider);
    if (client == null) return;
    await client.action(session: session, kind: kind, payload: payload);
  }
}

final sessionsProvider = AsyncNotifierProvider<SessionsNotifier, List<ZeusSession>>(SessionsNotifier.new);

final providersProvider = FutureProvider<List<ProviderInfo>>((ref) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return const [];
  return client.providers();
});

final sessionEventsProvider = FutureProvider.family<List<ZeusEvent>, String>((ref, sessionId) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return const [];
  return client.sessionEvents(sessionId);
});

/// The summary a phone shows instead of a history replay.
final sessionDigestProvider = FutureProvider.family<SessionDigest?, String>((ref, sessionId) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return null;
  return client.digest(sessionId);
});

/// Answers an approval. The desktop decides; a refusal here is a real refusal,
/// not a transport hiccup, so the caller must not present it as approved.
Future<void> decideRequest({
  required String requestId,
  required String sessionId,
  required bool allow,
  required Ref ref,
}) async {
  final client = ref.read(gatewayClientProvider);
  if (client == null) {
    throw StateError('Not paired with a gateway.');
  }
  await client.decide(requestId: requestId, sessionId: sessionId, allow: allow);
  await ref.read(sessionsProvider.notifier).refresh();
}
