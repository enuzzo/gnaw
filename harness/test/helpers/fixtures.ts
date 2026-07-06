import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createStaticServer } from "../../../fixtures/src/server";
import { fixtureRegistry, type FixtureName } from "../../../fixtures/src/registry";

export type RunningFixture = {
  name: FixtureName;
  origin: string;
  close(): Promise<void>;
};

export async function startFixture(name: FixtureName): Promise<RunningFixture> {
  const server = createStaticServer({
    publicDir: fixtureRegistry[name].publicDir
  });
  const port = await listen(server);

  return {
    name,
    origin: `http://127.0.0.1:${port}`,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
