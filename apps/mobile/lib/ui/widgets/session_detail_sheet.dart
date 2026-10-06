import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/zeus_event.dart';
import '../../models/zeus_session.dart';
import '../../state/zeus_state.dart';
import 'glass_surface.dart';
import 'zeus_icon.dart';

class SessionDetailSheet extends ConsumerStatefulWidget {
  const SessionDetailSheet({super.key, required this.session});
  final ZeusSession session;

  static Future<void> show(BuildContext context, ZeusSession session) =>
      showModalBottomSheet<void>(
        context: context,
        useSafeArea: true,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        barrierColor: Colors.black54,
        builder: (_) => SessionDetailSheet(session: session),
      );

  @override
  ConsumerState<SessionDetailSheet> createState() => _SessionDetailSheetState();
}

class _SessionDetailSheetState extends ConsumerState<SessionDetailSheet> {
  final message = TextEditingController();
  bool sending = false;

  @override
  void dispose() {
    message.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(10, 0, 10, 10 + bottom),
      child: GlassSurface(
        borderRadius: 38,
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 22),
        interactive: true,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 5,
                  margin: const EdgeInsets.only(bottom: 18),
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          session.project ?? session.runtime,
                          style: Theme.of(context).textTheme.headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          [session.runtime, session.provider, session.model]
                              .whereType<String>()
                              .where((e) => e.isNotEmpty)
                              .join(' · '),
                          style: const TextStyle(
                            color: Colors.white54,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _StatusPill(status: session.status),
                ],
              ),
              const SizedBox(height: 22),
              _InfoRow(label: 'Session', value: session.id),
              _InfoRow(label: 'Agent', value: session.agentId),
              if (session.machineName?.isNotEmpty == true)
                _InfoRow(label: 'Machine', value: session.machineName!),
              _InfoRow(
                label: 'Last event',
                value: session.lastEvent.isEmpty
                    ? 'Connected'
                    : session.lastEvent,
              ),
              if (session.message?.isNotEmpty == true) ...[
                const SizedBox(height: 14),
                Text(
                  session.message!,
                  style: const TextStyle(fontSize: 14, height: 1.35),
                ),
              ],
              const SizedBox(height: 20),
              Text(
                'RECENT ACTIVITY',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: Colors.white38,
                  letterSpacing: 1.0,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              ref
                  .watch(sessionEventsProvider(session.id))
                  .when(
                    data: (events) =>
                        _Timeline(events: events.reversed.take(8).toList()),
                    loading: () => const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: LinearProgressIndicator(minHeight: 2),
                    ),
                    error: (_, _) => const Text(
                      'Activity is temporarily unavailable.',
                      style: TextStyle(color: Colors.white38, fontSize: 12),
                    ),
                  ),
              if (session.needsAttention) ...[
                const SizedBox(height: 22),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.tonal(
                        onPressed: () => _action('deny'),
                        child: const Text('Deny'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton(
                        onPressed: () => _action('approve'),
                        child: const Text('Allow'),
                      ),
                    ),
                  ],
                ),
              ],
              if (session.canSend) ...[
                const SizedBox(height: 24),
                TextField(
                  controller: message,
                  minLines: 1,
                  maxLines: 4,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _send(),
                  decoration: InputDecoration(
                    hintText: 'Send an instruction to the agent',
                    suffixIcon: CupertinoButton(
                      padding: EdgeInsets.zero,
                      onPressed: sending ? null : _send,
                      child: sending
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator.adaptive(
                                strokeWidth: 2,
                              ),
                            )
                          : const ZeusIcon(
                              'arrow.up.circle.fill',
                              fallback: CupertinoIcons.arrow_up_circle_fill,
                              size: 26,
                            ),
                    ),
                  ),
                ),
              ],
              if (session.supports('pause') ||
                  session.supports('resume') ||
                  session.supports('stop')) ...[
                const SizedBox(height: 16),
                Row(
                  children: [
                    if (session.supports('pause'))
                      Expanded(
                        child: _ActionButton(
                          symbol: 'pause.fill',
                          icon: CupertinoIcons.pause_fill,
                          label: 'Pause',
                          onPressed: () => _action('pause'),
                        ),
                      ),
                    if (session.supports('pause') && session.supports('resume'))
                      const SizedBox(width: 8),
                    if (session.supports('resume'))
                      Expanded(
                        child: _ActionButton(
                          symbol: 'play.fill',
                          icon: CupertinoIcons.play_fill,
                          label: 'Resume',
                          onPressed: () => _action('resume'),
                        ),
                      ),
                    if ((session.supports('pause') ||
                            session.supports('resume')) &&
                        session.supports('stop'))
                      const SizedBox(width: 8),
                    if (session.supports('stop'))
                      Expanded(
                        child: _ActionButton(
                          symbol: 'stop.fill',
                          icon: CupertinoIcons.stop_fill,
                          label: 'Stop',
                          destructive: true,
                          onPressed: () => _action('stop'),
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _send() async {
    final value = message.text.trim();
    if (value.isEmpty || sending) return;
    setState(() => sending = true);
    try {
      await ref
          .read(sessionsProvider.notifier)
          .action(widget.session, 'message', payload: {'message': value});
      message.clear();
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  Future<void> _action(String action) async {
    await ref
        .read(sessionsProvider.notifier)
        .action(
          widget.session,
          action,
          payload:
              (action == 'approve' || action == 'deny') &&
                  widget.session.pendingRequestId?.isNotEmpty == true
              ? {'request_id': widget.session.pendingRequestId}
              : null,
        );
    if ((action == 'approve' || action == 'deny') && mounted) {
      Navigator.of(context).pop();
    }
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.events});
  final List<ZeusEvent> events;

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) {
      return const Text(
        'No events yet.',
        style: TextStyle(color: Colors.white38, fontSize: 12),
      );
    }
    return Column(
      children: events
          .map(
            (event) => Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    margin: const EdgeInsets.only(top: 5),
                    decoration: BoxDecoration(
                      color: _eventColor(event.type),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _eventTitle(event),
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (_eventDetail(event).isNotEmpty)
                          Text(
                            _eventDetail(event),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0x73FFFFFF),
                              fontSize: 11.5,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(growable: false),
    );
  }

  Color _eventColor(String type) => switch (type) {
    'permission.requested' => const Color(0xFFFFC857),
    'session.completed' => const Color(0xFF6BE4A7),
    'session.failed' || 'tool.failed' => const Color(0xFFFF6B73),
    _ => const Color(0xFF4CC2FF),
  };

  String _eventTitle(ZeusEvent event) => switch (event.type) {
    'tool.started' => 'Tool started',
    'tool.completed' => 'Tool completed',
    'command.started' => 'Command started',
    'command.completed' => 'Command completed',
    'file.changed' => 'File changed',
    'file.read' => 'File read',
    'permission.requested' => 'Approval requested',
    'permission.resolved' => 'Approval resolved',
    'session.completed' => 'Task completed',
    'session.failed' => 'Task failed',
    _ => event.type,
  };

  String _eventDetail(ZeusEvent event) =>
      event.command ?? event.path ?? event.tool ?? event.message ?? '';
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 86,
          child: Text(
            label,
            style: const TextStyle(color: Colors.white38, fontSize: 12),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(fontSize: 12.5),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    ),
  );
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: .08),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      status,
      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
    ),
  );
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.symbol,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.destructive = false,
  });
  final String symbol;
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  final bool destructive;

  @override
  Widget build(BuildContext context) => CupertinoButton(
    padding: const EdgeInsets.symmetric(vertical: 10),
    color: destructive
        ? Colors.red.withValues(alpha: .18)
        : Colors.white.withValues(alpha: .07),
    borderRadius: BorderRadius.circular(16),
    onPressed: onPressed,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ZeusIcon(
          symbol,
          fallback: icon,
          size: 17,
          color: destructive ? Colors.redAccent : Colors.white,
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 10.5,
            color: destructive ? Colors.redAccent : Colors.white70,
          ),
        ),
      ],
    ),
  );
}
