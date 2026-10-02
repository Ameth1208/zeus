import 'dart:io';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../gen/assets.gen.dart';
import '../models/zeus_session.dart';
import '../state/zeus_state.dart';
import 'widgets/agent_island.dart';
import 'widgets/glass_surface.dart';
import 'widgets/session_card.dart';
import 'widgets/session_detail_sheet.dart';
import 'widgets/zeus_icon.dart';
import 'widgets/zeus_mascot.dart';
import 'widgets/providers_sheet.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _island = AgentIslandController();

  @override
  void dispose() {
    _island.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sessions = ref.watch(sessionsProvider);
    final connection = ref.watch(gatewayConnectionProvider);
    final list = sessions.value ?? const <ZeusSession>[];
    final connected = connection.value?.connected == true;
    final active = list.where((s) => s.isWorking || s.needsAttention).length;
    final mascotState = list.any((s) => s.needsAttention)
        ? 'waiting'
        : list.any((s) => s.hasError)
        ? 'failed'
        : list.any((s) => s.isWorking)
        ? 'working'
        : list.any((s) => s.isDone)
        ? 'completed'
        : 'idle';

    return Scaffold(
      body: Stack(
        children: [
          const _Background(),
          ListenableBuilder(
            listenable: _island,
            builder: (context, _) => GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: _island.expanded ? _island.collapse : null,
            ),
          ),
          RefreshIndicator.adaptive(
            onRefresh: () => ref.read(sessionsProvider.notifier).refresh(),
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              slivers: [
                SliverToBoxAdapter(
                  child: SafeArea(
                    bottom: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 84, 20, 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Zeus',
                                  style: Theme.of(context)
                                      .textTheme
                                      .displaySmall
                                      ?.copyWith(
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: -1.4,
                                      ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  active == 0
                                      ? 'Watching your agents'
                                      : '$active agent${active == 1 ? '' : 's'} active',
                                  style: const TextStyle(
                                    color: Colors.white54,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (connection.value?.connected == true)
                            CupertinoButton(
                              padding: EdgeInsets.zero,
                              minimumSize: const Size.square(42),
                              onPressed: () => ProvidersSheet.show(context),
                              child: const ZeusIcon(
                                'square.grid.2x2',
                                fallback: CupertinoIcons.square_grid_2x2,
                                size: 24,
                              ),
                            ),
                          CupertinoButton(
                            padding: EdgeInsets.zero,
                            minimumSize: const Size.square(42),
                            onPressed: connection.value?.connected == true
                                ? () => ref
                                      .read(gatewayConnectionProvider.notifier)
                                      .disconnect()
                                : () => showDialog<void>(
                                    context: context,
                                    builder: (_) => const _PairDialog(),
                                  ),
                            child: ZeusIcon(
                              connection.value?.connected == true
                                  ? 'link'
                                  : 'plus.circle',
                              fallback: connection.value?.connected == true
                                  ? CupertinoIcons.link
                                  : CupertinoIcons.add_circled,
                              size: 26,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 42),
                  sliver: SliverList.list(
                    children: [
                      if (connection.value?.connected != true)
                        _PairCard(mascotState: mascotState)
                      else if (sessions.isLoading && list.isEmpty)
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.all(48),
                            child: CircularProgressIndicator.adaptive(),
                          ),
                        )
                      else if (list.isEmpty)
                        GlassSurface(
                          borderRadius: 32,
                          child: Column(
                            children: [
                              ZeusMascot(status: 'idle', size: 180),
                              const Text(
                                'No agent sessions yet.',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 16,
                                ),
                              ),
                              const SizedBox(height: 7),
                              const Text(
                                'Start Codex, Claude Code, Antigravity or another Zeus adapter.',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: Colors.white54,
                                  height: 1.35,
                                ),
                              ),
                            ],
                          ),
                        )
                      else ...[
                        const Padding(
                          padding: EdgeInsets.only(left: 4, bottom: 10),
                          child: Text(
                            'SESSIONS',
                            style: TextStyle(
                              color: Colors.white38,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.1,
                            ),
                          ),
                        ),
                        ...list.map(
                          (session) => Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: SessionCard(
                              session: session,
                              onOpen: () =>
                                  SessionDetailSheet.show(context, session),
                              onAction: (action) => ref
                                  .read(sessionsProvider.notifier)
                                  .action(session, action),
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 100),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            top: MediaQuery.paddingOf(context).top + 8,
            left: 0,
            right: 0,
            child: IgnorePointer(
              ignoring: !connected,
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 420),
                switchInCurve: Curves.easeOutBack,
                switchOutCurve: Curves.easeInCubic,
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: ScaleTransition(
                    scale: Tween(begin: .82, end: 1.0).animate(animation),
                    child: child,
                  ),
                ),
                child: connected
                    ? Center(
                        key: const ValueKey('island'),
                        child: AgentIsland(
                          controller: _island,
                          sessions: list,
                          onOpenSession: (session) =>
                              SessionDetailSheet.show(context, session),
                        ),
                      )
                    : const SizedBox.shrink(key: ValueKey('island-empty')),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PairCard extends ConsumerWidget {
  const _PairCard({required this.mascotState});
  final String mascotState;

  @override
  Widget build(BuildContext context, WidgetRef ref) => GlassSurface(
    borderRadius: 34,
    padding: const EdgeInsets.fromLTRB(20, 12, 20, 22),
    child: Column(
      children: [
        ZeusMascot(status: mascotState, size: 190),
        Text(
          'Pair this phone',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        Text(
          Platform.isIOS
              ? 'Connect securely to Zeus Gateway. Liquid Glass is used for native iOS surfaces when available.'
              : 'Connect securely to Zeus Gateway running on your VPS or computer.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.white54, height: 1.35),
        ),
        const SizedBox(height: 18),
        FilledButton.icon(
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => const _PairDialog(),
          ),
          icon: const ZeusIcon(
            'qrcode.viewfinder',
            fallback: CupertinoIcons.qrcode_viewfinder,
            size: 20,
          ),
          label: const Text('Pair device'),
        ),
      ],
    ),
  );
}

class _Background extends StatelessWidget {
  const _Background();
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      gradient: RadialGradient(
        center: Alignment(0, -1.15),
        radius: 1.35,
        colors: [Color(0xFF12243A), Color(0xFF07090D), Color(0xFF030405)],
        stops: [0, .42, 1],
      ),
    ),
    child: const SizedBox.expand(),
  );
}

class _PairDialog extends ConsumerStatefulWidget {
  const _PairDialog();

  @override
  ConsumerState<_PairDialog> createState() => _PairDialogState();
}

class _PairDialogState extends ConsumerState<_PairDialog> {
  final gateway = TextEditingController(text: 'https://zeus.example.com');
  final code = TextEditingController();
  bool busy = false;
  String? error;

  @override
  void dispose() {
    gateway.dispose();
    code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400),
        child: GlassSurface(
          borderRadius: 34,
          padding: const EdgeInsets.fromLTRB(24, 26, 24, 22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Assets.images.zeusLogo.image(
                width: 64,
                height: 64,
                fit: BoxFit.contain,
              ),
              const SizedBox(height: 14),
              Text(
                'Pair Zeus',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Connect securely to Zeus Gateway.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white54, fontSize: 13),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: gateway,
                keyboardType: TextInputType.url,
                autocorrect: false,
                style: const TextStyle(color: Colors.white, fontSize: 15),
                decoration: _fieldDecoration(
                  'Gateway URL',
                  'link',
                  CupertinoIcons.link,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  letterSpacing: 6,
                  fontWeight: FontWeight.w600,
                ),
                decoration: _fieldDecoration(
                  'Pairing code',
                  'qrcode',
                  CupertinoIcons.qrcode,
                ).copyWith(counterText: ''),
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.redAccent,
                      fontSize: 12,
                    ),
                  ),
                ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: CupertinoButton(
                      padding: const EdgeInsets.symmetric(vertical: 15),
                      color: Colors.white.withValues(alpha: .09),
                      borderRadius: BorderRadius.circular(18),
                      onPressed: busy ? null : () => Navigator.pop(context),
                      child: const Text(
                        'Cancel',
                        style: TextStyle(
                          color: Colors.white70,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: CupertinoButton(
                      padding: const EdgeInsets.symmetric(vertical: 15),
                      color: theme.colorScheme.primary,
                      borderRadius: BorderRadius.circular(18),
                      onPressed: busy ? null : _pair,
                      child: busy
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                ZeusIcon(
                                  'link',
                                  fallback: CupertinoIcons.link,
                                  size: 18,
                                  color: Colors.white,
                                ),
                                SizedBox(width: 7),
                                Text(
                                  'Pair device',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration(
    String label,
    String symbol,
    IconData fallback,
  ) => InputDecoration(
    labelText: label,
    prefixIcon: Padding(
      padding: const EdgeInsets.only(left: 14, right: 8),
      child: ZeusIcon(
        symbol,
        fallback: fallback,
        size: 20,
        weight: FontWeight.w500,
      ),
    ),
    prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
  );

  Future<void> _pair() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref
          .read(gatewayConnectionProvider.notifier)
          .pair(
            url: gateway.text.trim(),
            code: code.text.trim(),
            deviceName: Platform.isIOS ? 'Zeus iPhone' : 'Zeus Android',
          );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = 'Could not pair with this gateway.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}
