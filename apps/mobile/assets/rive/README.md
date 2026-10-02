# Zeus Rive asset contract

Import `zeus-base.svg` into Rive and keep the named layers. Export the final runtime file as `zeus.riv` in this directory.

Recommended artboard: `Zeus`
Recommended state machine: `ZeusStateMachine`

Data-bound properties:
- `working` boolean
- `attention` boolean
- `error` boolean
- `sleeping` boolean
- `gazeX` number (-1..1)
- `gazeY` number (-1..1)

Triggers:
- `success`
- `tap`
- `greet`
- `dizzy`
- `dropFile`

Motion language:
- idle: 3-4 s breathing loop, irregular blink every 2-6 s.
- working: focused gaze, light collar pulse, subtle ear movement.
- attention: ears forward + short collar double-pulse.
- error: ears lower, one head tilt; never aggressive.
- success: one happy bounce and tongue/ear reaction.
- sleeping: slower 5 s breathing loop and closed eyes.
- pointer/touch: gaze follows input with spring damping, not linear tracking.

All Zeus mascot art and animation must remain original; do not copy Mochi's character design, expressions, sound set, or source media.
