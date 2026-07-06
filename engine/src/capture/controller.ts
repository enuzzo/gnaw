import type { Readable } from "node:stream";

export type CaptureControlState = "running" | "paused" | "canceled";
export type ControlCommand = "pause" | "resume" | "cancel";

export type ControlStateEvent = {
  v: 2;
  type: "state";
  state: CaptureControlState;
};

export type ControlEventWriter = {
  event(event: ControlStateEvent): void;
};

export type ControlLogger = {
  warn(message: string): void;
};

export class CaptureCanceledError extends Error {
  constructor() {
    super("Capture canceled");
    this.name = "CaptureCanceledError";
  }
}

export type CaptureController = {
  readonly state: CaptureControlState;
  pause(): void;
  resume(): void;
  cancel(): void;
  waitIfPaused(): Promise<void>;
  throwIfCanceled(): void;
};

export function createCaptureController({
  stdin,
  writer,
  logger,
  onCancel
}: {
  stdin?: Readable;
  writer: ControlEventWriter;
  logger: ControlLogger;
  onCancel?: () => void;
}): CaptureController {
  let state: CaptureControlState = "running";
  const waiters = new Set<() => void>();

  function resolveWaiters(): void {
    for (const resolve of waiters) {
      resolve();
    }
    waiters.clear();
  }

  function emitState(): void {
    writer.event({ v: 2, type: "state", state });
  }

  function pause(): void {
    if (state !== "running") {
      return;
    }
    state = "paused";
    emitState();
  }

  function resume(): void {
    if (state !== "paused") {
      return;
    }
    state = "running";
    emitState();
    resolveWaiters();
  }

  function cancel(): void {
    if (state === "canceled") {
      return;
    }
    state = "canceled";
    emitState();
    onCancel?.();
    resolveWaiters();
  }

  function handleCommand(command: ControlCommand): void {
    if (command === "pause") {
      pause();
    } else if (command === "resume") {
      resume();
    } else {
      cancel();
    }
  }

  if (stdin) {
    let buffer = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          parseControlLine(line, logger, handleCommand);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });
  }

  return {
    get state() {
      return state;
    },
    pause,
    resume,
    cancel,
    waitIfPaused() {
      if (state !== "paused") {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        waiters.add(resolve);
      });
    },
    throwIfCanceled() {
      if (state === "canceled") {
        throw new CaptureCanceledError();
      }
    }
  };
}

function parseControlLine(
  line: string,
  logger: ControlLogger,
  handleCommand: (command: ControlCommand) => void
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    logger.warn(`Invalid control channel JSON: ${JSON.stringify(line)}`);
    return;
  }

  if (!isControlCommand(parsed)) {
    logger.warn(`Invalid control channel command: ${JSON.stringify(parsed)}`);
    return;
  }

  handleCommand(parsed.cmd);
}

function isControlCommand(value: unknown): value is { cmd: ControlCommand } {
  if (!value || typeof value !== "object" || !("cmd" in value)) {
    return false;
  }
  const command = (value as { cmd: unknown }).cmd;
  return command === "pause" || command === "resume" || command === "cancel";
}
