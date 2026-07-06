import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CaptureCanceledError, createCaptureController } from "../../src/capture/controller";

describe("capture control channel", () => {
  it("handles pause and resume commands from stdin NDJSON", async () => {
    const stdin = new PassThrough();
    const events: unknown[] = [];
    const warnings: string[] = [];
    const controller = createCaptureController({
      stdin,
      writer: { event: (event) => events.push(event) },
      logger: { warn: (message) => warnings.push(message) }
    });

    stdin.write('{"cmd":"pause"}\n');

    expect(controller.state).toBe("paused");
    expect(events).toEqual([{ v: 2, type: "state", state: "paused" }]);

    let resumed = false;
    const wait = controller.waitIfPaused().then(() => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);

    stdin.write('{"cmd":"resume"}\n');
    await wait;

    expect(controller.state).toBe("running");
    expect(resumed).toBe(true);
    expect(events).toEqual([
      { v: 2, type: "state", state: "paused" },
      { v: 2, type: "state", state: "running" }
    ]);
    expect(warnings).toEqual([]);
  });

  it("logs invalid stdin JSON as warnings through the injected logger", () => {
    const stdin = new PassThrough();
    const events: unknown[] = [];
    const warnings: string[] = [];
    const controller = createCaptureController({
      stdin,
      writer: { event: (event) => events.push(event) },
      logger: { warn: (message) => warnings.push(message) }
    });

    stdin.write("{not json}\n");

    expect(controller.state).toBe("running");
    expect(events).toEqual([]);
    expect(warnings).toEqual(['Invalid control channel JSON: "{not json}"']);
  });

  it("supports cancel from stdin and SIGTERM-style exposed cancellation", async () => {
    const stdin = new PassThrough();
    const fromStdin = createCaptureController({
      stdin,
      writer: { event: () => undefined },
      logger: { warn: () => undefined }
    });

    stdin.write('{"cmd":"cancel"}\n');
    expect(fromStdin.state).toBe("canceled");
    expect(() => fromStdin.throwIfCanceled()).toThrow(CaptureCanceledError);

    const signaled = createCaptureController({
      writer: { event: () => undefined },
      logger: { warn: () => undefined }
    });
    signaled.pause();
    const wait = signaled.waitIfPaused();
    signaled.cancel();

    await wait;
    expect(signaled.state).toBe("canceled");
    expect(() => signaled.throwIfCanceled()).toThrow("Capture canceled");
  });
});
