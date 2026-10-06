import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/zeus_config.dart';
import '../models/media_player.dart';
import '../models/provider_info.dart';
import '../models/zeus_event.dart';
import '../models/zeus_session.dart';
import '../services/credentials_store.dart';
import '../services/gateway_client.dart';
import '../services/notification_service.dart';

final credentialsStoreProvider = Provider((ref) => CredentialsStore());
final notificationServiceProvider = Provider((ref) {
  final service = NotificationService();
  unawaited(service.init());
  return service;
});

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

  Future<void> pair({
    required String url,
    required String code,
    required String deviceName,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final pair = await GatewayClient.completePair(
        baseUrl: url,
        code: code,
        deviceName: deviceName,
      );
      await ref
          .read(credentialsStoreProvider)
          .save(gateway: url, token: pair['token']!);
      return GatewayConnection(url: url, token: pair['token']);
    });
  }

  Future<void> disconnect() async {
    await ref.read(credentialsStoreProvider).clear();
    state = AsyncData(GatewayConnection(url: ZeusConfig.defaultGateway));
  }
}

final gatewayConnectionProvider =
    AsyncNotifierProvider<GatewayConnectionNotifier, GatewayConnection>(
      GatewayConnectionNotifier.new,
    );

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
    final notifications = ref.read(notificationServiceProvider);
    _events = client.events().listen((event) {
      // A pushworthy event interrupts; everything else only refreshes.
      unawaited(notifications.maybeNotify(event));
      refresh();
    }, onError: (_) {});
    return client.sessions();
  }

  Future<void> refresh() async {
    final client = ref.read(gatewayClientProvider);
    if (client == null) return;
    state = const AsyncLoading<List<ZeusSession>>();
    state = await AsyncValue.guard(client.sessions);
  }

  Future<void> action(
    ZeusSession session,
    String kind, {
    Map<String, dynamic>? payload,
  }) async {
    final client = ref.read(gatewayClientProvider);
    if (client == null) return;
    await client.action(session: session, kind: kind, payload: payload);
  }
}

final sessionsProvider =
    AsyncNotifierProvider<SessionsNotifier, List<ZeusSession>>(
      SessionsNotifier.new,
    );

final providersProvider = FutureProvider<List<ProviderInfo>>((ref) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return const [];
  return client.providers();
});

/// Seconds since each desktop's heartbeat. Polled slowly; the derived getter
/// is what the UI reads.
final presenceProvider = FutureProvider<Map<String, int>>((ref) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return const {};
  // A slow self-refresh keeps the badge honest without holding a socket.
  final timer = Timer(const Duration(seconds: 20), () => ref.invalidateSelf());
  ref.onDispose(timer.cancel);
  return client.presence();
});

/// True when at least one desktop beat within the last 30 seconds.
final anyDesktopOnlineProvider = Provider<bool>((ref) {
  final beats = ref.watch(presenceProvider).value ?? const {};
  return beats.values.any((secs) => secs < 30);
});

/// Now-playing from every desktop. Polls slowly while watched.
final mediaProvider = FutureProvider<List<MediaPlayer>>((ref) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return const [];
  final timer = Timer(const Duration(seconds: 8), () => ref.invalidateSelf());
  ref.onDispose(timer.cancel);
  return client.media();
});

/// Sends a transport command to a desktop and refreshes shortly after, since
/// the command lands on the desktop's next drain tick.
Future<void> sendMediaCommand(
  WidgetRef ref,
  MediaPlayer player,
  String command,
) async {
  final client = ref.read(gatewayClientProvider);
  if (client == null) return;
  await client.mediaControl(machineId: player.machineId, command: command);
  await Future<void>.delayed(const Duration(milliseconds: 400));
  ref.invalidate(mediaProvider);
}

final sessionEventsProvider = FutureProvider.family<List<ZeusEvent>, String>((
  ref,
  sessionId,
) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return const [];
  return client.sessionEvents(sessionId);
});

/// The summary a phone shows instead of a history replay.
final sessionDigestProvider = FutureProvider.family<SessionDigest?, String>((
  ref,
  sessionId,
) async {
  final client = ref.watch(gatewayClientProvider);
  if (client == null) return null;
  return client.digest(sessionId);
});

/// Answers an approval. The desktop decides; a refusal here is a real refusal,
/// not a transport hiccup, so the caller must not present it as approved.
Future<void> decideRequest({
  required String requestId,
  required ZeusSession session,
  required bool allow,
  required Ref ref,
}) async {
  final client = ref.read(gatewayClientProvider);
  if (client == null) {
    throw StateError('Not paired with a gateway.');
  }
  await client.decide(
    requestId: requestId,
    sessionId: session.id,
    agentId: session.agentId,
    allow: allow,
  );
  await ref.read(sessionsProvider.notifier).refresh();
}
