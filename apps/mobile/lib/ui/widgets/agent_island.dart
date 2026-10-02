import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../models/zeus_session.dart';
import 'glass_surface.dart';
import 'zeus_mascot.dart';

/// Lets a parent collapse the island, e.g. when the user taps elsewhere.
class AgentIslandController extends ChangeNotifier {
  bool _expanded = false;
  bool get expanded => _expanded;

  void collapse() {
    if (!_expanded) return;
    _expanded = false;
    notifyListeners();
  }

  void toggle() {
    _expanded = !_expanded;
    notifyListeners();
  }

  void expand() {
    if (_expanded) return;
    _expanded = true;
    notifyListeners();
  }
}

class AgentIsland extends StatefulWidget {
  const AgentIsland({
    super.key,
    required this.sessions,
    this.controller,
    this.onOpenSession,
  });

  final List<ZeusSession> sessions;
  final AgentIslandController? controller;
  final ValueChanged<ZeusSession>? onOpenSession;

  @override
  State<AgentIsland> createState() => _AgentIslandState();
}

class _AgentIslandState extends State<AgentIsland> {
  late final AgentIslandController _controller =
      widget.controller ?? AgentIslandController();

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onControllerChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onControllerChanged);
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  void _onControllerChanged() {
    if (mounted) setState(() {});
  }

  ZeusSession? get _focus {
    for (final s in widget.sessions) {
      if (s.needsAttention) return s;
    }
    for (final s in widget.sessions) {
      if (s.isWorking) return s;
    }
    return widget.sessions.isEmpty ? null : widget.sessions.first;
  }

  String get _mascotStatus {
    final focus = _focus;
    if (focus == null) return 'idle';
    if (focus.needsAttention) return 'waiting';
    if (focus.hasError) return 'failed';
    if (focus.isDone) return 'completed';
    return focus.isWorking ? 'working' : 'idle';
  }

  @override
  void didUpdateWidget(covariant AgentIsland oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.sessions.any((s) => s.needsAttention) &&
        !oldWidget.sessions.any((s) => s.needsAttention)) {
      _controller.expand();
    }
  }

  @override
  Widget build(BuildContext context) {
    final expanded = _controller.expanded;
    final session = _focus;
    final activeCount = widget.sessions
        .where((s) => s.isWorking || s.needsAttention)
        .length;
    return Semantics(
      button: true,
      label: session == null
          ? 'Zeus, no active agents'
          : 'Zeus, ${session.runtime}, ${session.status}',
      child: GestureDetector(
        onTap: _controller.toggle,
        child: AnimatedSize(
          duration: const Duration(milliseconds: 420),
          curve: Curves.easeOutBack,
          alignment: Alignment.topCenter,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 360),
            curve: Curves.easeOutCubic,
            width: expanded ? 344 : (session == null ? 106 : 226),
            constraints: BoxConstraints(
              minHeight: 54,
              maxHeight: expanded ? 176 : 62,
            ),
            child: GlassSurface(
              borderRadius: expanded ? 32 : 30,
              padding: EdgeInsets.symmetric(
                horizontal: expanded ? 14 : 10,
                vertical: expanded ? 12 : 7,
              ),
              interactive: true,
              child: expanded
                  ? _ExpandedIsland(
                      session: session,
                      sessions: widget.sessions,
                      mascotStatus: _mascotStatus,
                      activeCount: activeCount,
                      onOpen: session == null
                          ? null
                          : () => widget.onOpenSession?.call(session),
                    )
                  : _CompactIsland(
                      session: session,
                      mascotStatus: _mascotStatus,
                      activeCount: activeCount,
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CompactIsland extends StatelessWidget {
  const _CompactIsland({
    required this.session,
    required this.mascotStatus,
    required this.activeCount,
  });
  final ZeusSession? session;
  final String mascotStatus;
  final int activeCount;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      ZeusMascot(status: mascotStatus, size: 42),
      if (session != null) ...[
        const SizedBox(width: 8),
        Flexible(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                session!.project ?? session!.runtime,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _StatusDot(status: session!.status),
                  const SizedBox(width: 5),
                  Flexible(
                    child: Text(
                      session!.needsAttention
                          ? 'Needs you'
                          : '${session!.runtime} · ${_statusText(session!)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white60,
                        fontSize: 10.5,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (activeCount > 1) ...[
          const SizedBox(width: 7),
          Text(
            '+$activeCount',
            style: const TextStyle(color: Colors.white54, fontSize: 10),
          ),
        ],
      ],
    ],
  );
}

class _ExpandedIsland extends StatelessWidget {
  const _ExpandedIsland({
    required this.session,
    required this.sessions,
    required this.mascotStatus,
    required this.activeCount,
    required this.onOpen,
  });
  final ZeusSession? session;
  final List<ZeusSession> sessions;
  final String mascotStatus;
  final int activeCount;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    if (session == null) {
      return Row(
        children: [
          _ShrinkableMascot(status: 'idle', size: 76),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Zeus is ready',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                ),
                SizedBox(height: 4),
                Text(
                  'No agent is working right now.',
                  style: TextStyle(color: Colors.white60, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return Row(
      children: [
        _ShrinkableMascot(status: mascotStatus, size: 84),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  _StatusDot(status: session!.status),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      session!.project ?? session!.runtime,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 5),
              Text(
                '${session!.runtime}${session!.model == null ? '' : ' · ${session!.model}'}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white60, fontSize: 11),
              ),
              const SizedBox(height: 6),
              Text(
                session!.message?.isNotEmpty == true
                    ? session!.message!
                    : _eventText(session!),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, height: 1.25),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Text(
                    activeCount <= 1
                        ? _statusText(session!)
                        : '$activeCount active agents',
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 10.5,
                    ),
                  ),
                  const Spacer(),
                  CupertinoButton(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 2,
                    ),
                    minimumSize: const Size(0, 28),
                    onPressed: onOpen,
                    child: const Text(
                      'Open',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ShrinkableMascot extends StatelessWidget {
  const _ShrinkableMascot({required this.status, required this.size});

  final String status;
  final double size;

  @override
  Widget build(BuildContext context) => Flexible(
    child: FittedBox(
      fit: BoxFit.scaleDown,
      child: ZeusMascot(status: status, size: size),
    ),
  );
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'working' => const Color(0xFF4CC2FF),
      'waiting' => const Color(0xFFFFC857),
      'completed' => const Color(0xFF6BE4A7),
      'failed' => const Color(0xFFFF6B73),
      _ => Colors.white38,
    };
    return Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(color: color.withValues(alpha: .45), blurRadius: 8),
        ],
      ),
    );
  }
}

String _statusText(ZeusSession s) => switch (s.status) {
  'working' => 'Working',
  'waiting' => 'Waiting',
  'completed' => 'Done',
  'failed' => 'Failed',
  _ => s.status,
};

String _eventText(ZeusSession s) => switch (s.lastEvent) {
  'permission.requested' => 'An action is waiting for your approval.',
  'tool.started' => 'Using a tool…',
  'tool.completed' => 'Tool finished. Continuing…',
  'file.changed' => 'Editing project files…',
  'command.started' => 'Running a command…',
  'session.completed' => 'Task completed.',
  _ => s.lastEvent.isEmpty ? 'Connected through Zeus Gateway.' : s.lastEvent,
};
