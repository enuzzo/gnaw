import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createEventWriter } from "../../src/capture/events";

describe("event writer", () => {
  it("writes one JSON event per stdout line and human logs to stderr", () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        stdoutLines.push(chunk.toString());
        callback();
      }
    });
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        stderrLines.push(chunk.toString());
        callback();
      }
    });

    const writer = createEventWriter({ stdout, stderr });
    writer.event({
      v: 2,
      type: "hello",
      engine: { name: "gnaw-playwright", version: "1.0.0" },
      contract: "2.0"
    });
    writer.log("Starting capture");

    expect(stdoutLines.join("")).toBe(
      '{"v":2,"type":"hello","engine":{"name":"gnaw-playwright","version":"1.0.0"},"contract":"2.0"}\n'
    );
    expect(stderrLines.join("")).toBe("Starting capture\n");
  });
});
