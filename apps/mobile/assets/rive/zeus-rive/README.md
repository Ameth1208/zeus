# Zeus Rive source

This directory is intentionally text-source controlled using Rive's RML format.
`scene.rml` is a minimal original Zeus animation scaffold; `../zeus-base.svg` is the layered black-dog reference used to finish the production mascot.

Build locally with the official Rive CLI:

```bash
./scripts/build-rive.sh
```

The final production file must expose the contract documented in `../README.md` (`working`, `attention`, `error`, `sleeping`, `gazeX`, `gazeY`, and the interaction triggers). Until that richer file is exported, Flutter uses its original animated Zeus PNG fallback.
