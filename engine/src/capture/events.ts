import type { Writable } from "node:stream";

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
      stdout.write(`${JSON.stringify(event)}\n`);
    },
    log(message) {
      stderr.write(`${message}\n`);
    }
  };
}
