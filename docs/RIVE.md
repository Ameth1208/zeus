# Zeus mascot / Rive

Zeus owns its black-dog character and does not reuse the upstream Coucou/Mochi character design or media.

## Mobile runtime

Flutter includes the current Rive runtime and first tries to load `assets/rive/zeus.riv`. The production state-machine contract is documented in `apps/mobile/assets/rive/README.md`.

The repository also includes:
- `zeus-base.svg`: layered original dog reference.
- `zeus-rive/scene.rml`: text-source-controlled Rive project scaffold.
- `scripts/build-rive.sh`: verifies/builds the RML project with the official Rive CLI.
- a Flutter animation fallback with breathing, gaze, tap bounce and status reactions, so Zeus remains interactive when the production `.riv` has not been exported yet.

The build environment used for this package could not resolve `releases.rive.app`, so it would be dishonest to include an unverified or fake `.riv` binary. The source and build path are included instead.

## Production contract

Artboard: `Zeus`

State machine: `ZeusStateMachine`

Properties:
- `working` boolean
- `attention` boolean
- `error` boolean
- `sleeping` boolean
- `gazeX` number
- `gazeY` number

Triggers:
- `success`
- `tap`
- `greet`
- `dizzy`
- `dropFile`

These states are intentionally original Zeus behaviors rather than copies of Mochi animation assets.
