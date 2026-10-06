import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../models/zeus_event.dart';

/// Kinds worth interrupting the user for. Mirrors `isPushworthy` in the
/// gateway and `EventKind::is_pushworthy` in the desktop engine.
const _pushworthy = {
  'permission.requested',
  'input.requested',
  'session.completed',
  'session.failed',
};

/// Local notifications raised from the live event stream. This is the interim
/// channel until FCM is wired: it works while the app is alive (foreground or
/// background with the SSE connection up), which is exactly when the gateway
/// stream is running anyway.
class NotificationService {
  NotificationService() : _plugin = FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _ready = false;

  Future<void> init() async {
    if (_ready) return;
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      ),
    );
    await _plugin.initialize(settings);
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
    _ready = true;
  }

  /// Raises a local notification for an event worth attention; everything else
  /// is dropped here, exactly like the gateway's push filter.
  Future<void> maybeNotify(ZeusEvent event) async {
    if (!_ready || !_pushworthy.contains(event.type)) return;
    final title = switch (event.type) {
      'session.completed' => '${event.runtime} finished',
      'session.failed' => '${event.runtime} failed',
      'permission.requested' => '${event.runtime} needs approval',
      'input.requested' => '${event.runtime} needs input',
      _ => event.runtime,
    };
    final body = event.message ?? event.type;
    await _plugin.show(
      event.sessionId.hashCode,
      title,
      body.length > 120 ? '${body.substring(0, 119)}…' : body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'zeus_tasks',
          'Agent tasks',
          channelDescription:
              'Task completion and approval alerts from Zeus agents',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
      payload: event.sessionId,
    );
  }
}
