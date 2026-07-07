import type { Writable } from "node:stream";
import { redactObject, redactText } from "../redaction/redact.js";

export type GnawEvent = {
  v: 2;
  type: string;
  [key: string]: unknown;
};

export type EventWriter = {
  event(event: GnawEvent): void;
  log(message: string): void;
};

export function createEventWriter({
  stdout = process.stdout,
  stderr = process.stderr
}: {
  stdout?: Writable;
  stderr?: Writable;
} = {}): EventWriter {
  return {
    event(event) {
      stdout.write(`${JSON.stringify(redactObject(event))}\n`);
    },
    log(message) {
      stderr.write(`${redactText(message)}\n`);
    }
  };
}
