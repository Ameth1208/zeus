import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/provider_info.dart';
import '../../state/zeus_state.dart';
import 'glass_surface.dart';
import 'zeus_icon.dart';

class ProvidersSheet extends ConsumerWidget {
  const ProvidersSheet({super.key});

  static Future<void> show(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black54,
    builder: (_) => const ProvidersSheet(),
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) => Padding(
    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
    child: GlassSurface(
      borderRadius: 34,
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
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
              const Expanded(
                child: Text(
                  'AI providers',
                  style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
                ),
              ),
              CupertinoButton(
                padding: EdgeInsets.zero,
                minimumSize: const Size.square(34),
                onPressed: () => ref.invalidate(providersProvider),
                child: const ZeusIcon(
                  'arrow.clockwise',
                  fallback: CupertinoIcons.refresh,
                  size: 18,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Models stay on the Gateway. Zeus Mobile never receives provider API keys.',
            style: TextStyle(
              color: Color(0x7AFFFFFF),
              fontSize: 12.5,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 16),
          ref
              .watch(providersProvider)
              .when(
                data: (providers) => providers.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Center(
                          child: Text(
                            'No providers enabled on this Gateway.',
                            style: TextStyle(color: Color(0x7AFFFFFF)),
                          ),
                        ),
                      )
                    : ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 420),
                        child: ListView.separated(
                          shrinkWrap: true,
                          itemCount: providers.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
                          itemBuilder: (_, index) =>
                              _ProviderTile(provider: providers[index]),
                        ),
                      ),
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 28),
                  child: Center(child: CircularProgressIndicator.adaptive()),
                ),
                error: (_, __) => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(
                    child: Text(
                      'Could not load providers.',
                      style: TextStyle(color: Color(0x7AFFFFFF)),
                    ),
                  ),
                ),
              ),
        ],
      ),
    ),
  );
}

class _ProviderTile extends StatelessWidget {
  const _ProviderTile({required this.provider});
  final ProviderInfo provider;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: .045),
      borderRadius: BorderRadius.circular(17),
      border: Border.all(color: Colors.white.withValues(alpha: .06)),
    ),
    child: Row(
      children: [
        Container(
          width: 35,
          height: 35,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .06),
            shape: BoxShape.circle,
          ),
          child: Text(
            provider.name.characters.first.toUpperCase(),
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                provider.name,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 2),
              Text(
                [
                  provider.kind,
                  provider.defaultModel,
                ].whereType<String>().where((e) => e.isNotEmpty).join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0x6BFFFFFF),
                  fontSize: 11.5,
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          decoration: BoxDecoration(
            color:
                (provider.configured
                        ? const Color(0xFF62DBA1)
                        : const Color(0xFFFFC857))
                    .withValues(alpha: .10),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            provider.configured ? 'Ready' : 'Needs key',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              color: provider.configured
                  ? const Color(0xFF75E6AD)
                  : const Color(0xFFFFCE73),
            ),
          ),
        ),
      ],
    ),
  );
}
