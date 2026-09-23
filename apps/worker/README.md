# apps/worker — Stage 1 (Track A) onward

The brain run entrypoint executed by launchd on the Mac 3–4×/day:
discovery → qualification → preparation/submission → inbox → pipeline →
briefing, per the `BrainRunConfig` / `StageResult` contracts in `@cai/core`.
Also hosts the coach relay listener. Local dev queue (BullMQ/Redis) only —
production has no queue server; stages run sequentially inside the process.
